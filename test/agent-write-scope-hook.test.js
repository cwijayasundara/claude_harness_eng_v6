'use strict';

// The runtime half of the agent write-scope contract: a PreToolUse gate that
// refuses a Write/Edit outside the acting agent's contract.
//
// The payloads below are the shapes captured from live runs on 2026-08-22
// (see subagent-payload-shape.test.js): a subagent's call carries `agent_id`
// AND `agent_type`; the main loop carries neither. Deciding from anything else
// — `transcript_path`, a "Task" tool name — is exactly how the last two hooks
// shipped inert, so these tests pin the discriminator to what the runtime sends.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const HOOK = path.join(__dirname, '..', '.claude', 'hooks', 'agent-write-scope.js');
const REPO = path.join(__dirname, '..');

// Run the hook from a DIFFERENT working directory than the project it governs.
// With cwd === projectDir, a hook that forgot to resolve a relative file_path
// against the project would still land on the right file by accident, and every
// path test would pass for the wrong reason.
function run(payload, env = {}) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: os.tmpdir(),
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO, ...env },
  });
  return { code: r.status, stderr: r.stderr || '' };
}

/** A subagent Write, exactly as the runtime sends it. */
function subagentWrite(agentType, filePath, tool = 'Write') {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: tool,
    agent_id: 'a903f01c6c876463e',
    agent_type: agentType,
    session_id: '69ed6c91-8b77-4a34-93e5-3a5bd2c3a0fe',
    transcript_path: '/Users/x/.claude/projects/p/69ed6c91.jsonl',
    tool_input: { file_path: filePath, content: 'x' },
    cwd: REPO,
  };
}

test('the code-reviewer is refused a write to production code', () => {
  const r = run(subagentWrite('code-reviewer', path.join(REPO, 'backend/app/auth.py')));
  assert.equal(r.code, 2, 'a contract violation must BLOCK (exit 2)');
  assert.match(r.stderr, /code-reviewer/);
  assert.match(r.stderr, /specs\/reviews\//, 'the block must say where it MAY write');
});

test('the code-reviewer is allowed its own review surface', () => {
  const r = run(subagentWrite('code-reviewer', path.join(REPO, 'specs/reviews/code-review.md')));
  assert.equal(r.code, 0, `expected pass, got ${r.code}: ${r.stderr}`);
});

test('Edit is gated too — a reviewer that cannot Write must not simply Edit instead', () => {
  const payload = subagentWrite('code-reviewer', path.join(REPO, 'backend/app/auth.py'), 'Edit');
  payload.tool_input = { file_path: path.join(REPO, 'backend/app/auth.py'), old_string: 'a', new_string: 'b' };
  assert.equal(run(payload).code, 2);
});

test('the MAIN LOOP is never scoped — no agent_id means the human is driving', () => {
  const both = subagentWrite('code-reviewer', path.join(REPO, 'backend/app/auth.py'));
  delete both.agent_id;
  delete both.agent_type;
  assert.equal(run(both).code, 0, 'a real main-loop payload carries neither key');

  // agent_id is THE discriminator (subagent-payload-shape.test.js). Pin it on its
  // own: without this case, dropping the agent_id guard entirely still passes,
  // because the payload above has no agent_type either.
  const idOnly = subagentWrite('code-reviewer', path.join(REPO, 'backend/app/auth.py'));
  delete idOnly.agent_id;
  assert.equal(run(idOnly).code, 0, 'no agent_id means not a subagent, whatever else the payload says');
});

test('an agent with no contract passes — over-blocking stalls the build loop', () => {
  assert.equal(run(subagentWrite('general-purpose', path.join(REPO, 'backend/app/auth.py'))).code, 0);
  assert.equal(run(subagentWrite('Explore', path.join(REPO, 'src/x.ts'))).code, 0);
});

test('the generator may build, but not rewrite the contract it is judged against', () => {
  assert.equal(run(subagentWrite('generator', path.join(REPO, 'backend/app/auth.py'))).code, 0);
  const blocked = run(subagentWrite('generator', path.join(REPO, 'sprint-contracts/A.json')));
  assert.equal(blocked.code, 2);
  assert.match(blocked.stderr, /sprint-contracts\//);
});

test('a builder cannot write the review verdict that judges it', () => {
  const r = run(subagentWrite('implementer', path.join(REPO, 'specs/reviews/code-review-verdict.json')));
  assert.equal(r.code, 2, 'evaluator-side tampering is the failure this closes');
});

test('a write outside the project is not this gate\'s business (scratch, /tmp)', () => {
  const scratch = path.join(os.tmpdir(), 'scratch-probe.md');
  assert.equal(run(subagentWrite('code-reviewer', scratch)).code, 0);
});

test('a non-write tool is ignored', () => {
  const payload = subagentWrite('code-reviewer', path.join(REPO, 'backend/app/auth.py'), 'Bash');
  payload.tool_input = { command: 'ls' };
  assert.equal(run(payload).code, 0);
});

test('HARNESS_AGENT_SCOPE=off disables the gate', () => {
  const r = run(subagentWrite('code-reviewer', path.join(REPO, 'backend/app/auth.py')),
    { HARNESS_AGENT_SCOPE: 'off' });
  assert.equal(r.code, 0);
});

test('malformed input fails open rather than wedging the session', () => {
  const r = spawnSync('node', [HOOK], {
    input: 'not json', encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: REPO },
  });
  assert.equal(r.status, 0);
});

test('a relative file_path is resolved against the project, not silently skipped', () => {
  const payload = subagentWrite('code-reviewer', 'backend/app/auth.py');
  assert.equal(run(payload).code, 2,
    'a relative path must be judged — skipping it would be a trivial bypass');
});

test('the gate reads contracts from the PROJECT, so a scaffolded repo governs its own agents', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoped-project-'));
  fs.mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'agents', 'code-reviewer.md'),
    '---\nname: code-reviewer\ndescription: t\ntools:\n  - Read\n---\n');
  fs.writeFileSync(path.join(dir, '.claude', 'agents', 'code-reviewer.contract.json'),
    JSON.stringify({ agent: 'code-reviewer', may_spawn: false, artifact_roots: ['audit/'], why: 'local' }));

  const payload = subagentWrite('code-reviewer', path.join(dir, 'audit/report.md'));
  payload.cwd = dir;
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  assert.equal(r.status, 0, 'the project\'s own contract must be the one that applies');

  const denied = subagentWrite('code-reviewer', path.join(dir, 'specs/reviews/x.md'));
  denied.cwd = dir;
  const r2 = spawnSync('node', [HOOK], {
    input: JSON.stringify(denied), encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  assert.equal(r2.status, 2, 'this harness\'s roots must not leak into a project that declared its own');
});
