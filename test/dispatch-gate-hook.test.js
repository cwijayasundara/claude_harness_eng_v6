'use strict';

// Exercises the hook the way Claude Code does: a JSON payload on stdin, a
// verdict as an exit code. The pure decideDispatch tests cannot prove the
// wrapper reads the right payload fields or exits 2, and a gate that decides
// correctly but never denies is exactly the inert-control class this branch
// exists to remove.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const HOOK = path.join(__dirname, '..', '.claude', 'hooks', 'dispatch-gate.js');
const CLI = path.join(__dirname, '..', '.claude', 'scripts', 'work-claim.js');
const workClaim = require('../.claude/scripts/work-claim.js');

function projectDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-gate-'));
  fs.mkdirSync(path.join(d, '.claude', 'state'), { recursive: true });
  return d;
}

function runHook(dir, payload) {
  try {
    const stdout = execFileSync('node', [HOOK], {
      input: JSON.stringify(payload), encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

function claims(dir) {
  return workClaim.holders(dir).map((h) => h.key);
}

// A dispatch made INSIDE a subagent: agent_id is set, and transcript_path is
// the PARENT's — the shape captured from live payloads.
const dispatch = (over) => ({
  hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's1',
  agent_id: 'a903f01c6c876463e', agent_type: 'generator',
  transcript_path: '/p/projects/slug/sess.jsonl',
  tool_input: { subagent_type: 'implementer', description: 'Implement E1-S1' }, ...over,
});

/** The same dispatch, made from the main loop: no agent_id. */
const mainLoopDispatch = (over) => {
  const d = dispatch(over);
  delete d.agent_id; delete d.agent_type;
  return d;
};

test('the hook denies a dispatch onto a story ANOTHER session holds', () => {
  const dir = projectDir();
  workClaim.claim(dir, 'story:E1-S1', { session: 'lead-A' });
  const dup = runHook(dir, dispatch({ session_id: 'rogue-B' }));
  assert.equal(dup.status, 2, 'a cross-session duplicate dispatch must exit 2 (deny)');
  assert.match(dup.stderr, /story:E1-S1 is already being implemented by session lead-A/);
  assert.match(dup.stderr, /work-claim\.js release story:E1-S1/, 'a hard block must name its way past');
});

test('the hook lets the /auto lead dispatch the teammate it just claimed for', () => {
  // The whole documented team flow: claim story:{id}, then spawn the teammate.
  // A gate that blocks this stops /auto team mode dead — which the first
  // version of this hook did, for every teammate.
  const dir = projectDir();
  workClaim.claim(dir, 'story:E1-S1', { session: 's1' });
  assert.equal(runHook(dir, dispatch()).status, 0, 'same-session dispatch is the normal path');
  assert.deepEqual(claims(dir), ['story:E1-S1'], 'the check must not touch the ledger');
});

test('the hook claims nothing, so nothing can leak or be mis-released', () => {
  const dir = projectDir();
  assert.equal(runHook(dir, dispatch()).status, 0);
  assert.deepEqual(claims(dir), [], 'the gate is read-only; work-claim owns the lifecycle');
  assert.equal(runHook(dir, dispatch()).status, 0, 'and a retry is never blocked by an invented claim');
});

test('the hook denies a subagent spawning a generator', () => {
  const dir = projectDir();
  const r = runHook(dir, dispatch({
    tool_input: { subagent_type: 'generator', description: 'Implement group A backend skeleton' },
  }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /may not spawn a generator/);
});

test('the MAIN LOOP may still spawn a generator — agent_id is the discriminator', () => {
  // Detection used to read transcript_path for `/subagents/`, which a real
  // subagent payload never contains, so this rule never fired at all.
  const dir = projectDir();
  const r = runHook(dir, mainLoopDispatch({
    tool_input: { subagent_type: 'generator', description: 'Propose Group A sprint contract' },
  }));
  assert.equal(r.status, 0, '/auto dispatches generators and must not be blocked');
});

test('the hook fires for tool_name "Agent" AND "Task"', () => {
  for (const tool_name of ['Agent', 'Task']) {
    const dir = projectDir();
    const r = runHook(dir, dispatch({ tool_name, tool_input: { subagent_type: 'generator', description: 'x' } }));
    assert.equal(r.status, 2, `must deny under tool_name ${tool_name}`);
  }
});

test('the hook ignores an unrelated tool and writes no claim', () => {
  const dir = projectDir();
  workClaim.claim(dir, 'story:E1-S1', { session: 'lead-A' });
  const r = runHook(dir, dispatch({ tool_name: 'Bash', tool_input: { command: 'echo E1-S1' }, session_id: 'rogue-B' }));
  assert.equal(r.status, 0, 'a Bash call naming a story is not a dispatch');
});

test('SubagentStop is a no-op: the gate never releases a claim it did not make', () => {
  // Releasing on stop released the WRONG teammate's live story under parallel
  // fan-out, because a stop event carries no story to correlate with.
  const dir = projectDir();
  workClaim.claim(dir, 'story:E1-S1', { session: 'lead-A' });
  const stop = runHook(dir, { hook_event_name: 'SubagentStop', agent_type: 'implementer' });
  assert.equal(stop.status, 0);
  assert.deepEqual(claims(dir), ['story:E1-S1'],
    'a live claim must survive an unrelated teammate finishing');
});

test('the hook fails open on malformed stdin rather than stalling the loop', () => {
  const dir = projectDir();
  try {
    execFileSync('node', [HOOK], { input: 'not json', encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  } catch (err) {
    assert.fail(`hook must exit 0 on malformed input, got ${err.status}`);
  }
});

test('work-claim.js release unblocks a claimed story', () => {
  const dir = projectDir();
  workClaim.claim(dir, 'story:E1-S1', { session: 'lead-A' });
  const out = execFileSync('node', [CLI, 'release', 'story:E1-S1', '--root', dir], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  assert.match(out, /released story:E1-S1/);
  assert.equal(runHook(dir, dispatch({ session_id: 'rogue-B' })).status, 0,
    'the story must be dispatchable after an explicit release');
});

test('work-claim.js list reports a live claim', () => {
  const dir = projectDir();
  workClaim.claim(dir, 'story:E1-S1', { session: 'lead-A' });
  const out = execFileSync('node', [CLI, 'list', '--root', dir], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  assert.match(out, /story:E1-S1 held by/);
});

// The production path, which none of the tests above exercise: `/auto`'s prose
// (skills/auto/references/section-4-4-agent-team-execution-step-4.md) runs
//   node .claude/scripts/work-claim.js claim story:{id}
// with NO --session. Every test above hands claim() a session programmatically,
// a shape that command line can never produce. Claiming through the CLI is the
// only way to catch a claim that records an owner the gate then skips.
test('a claim made the way /auto actually makes it still blocks a foreign session', () => {
  const dir = projectDir();
  execFileSync('node', [CLI, 'claim', 'story:E1-S1', '--root', dir], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });

  const [held] = workClaim.holders(dir);
  assert.notEqual(held.session, 'unknown',
    'a CLI claim must record a real owner: dispatch-claims skips an "unknown" owner, '
    + 'so an unknown-owner claim is a claim the gate can never enforce');

  const dup = runHook(dir, dispatch({ session_id: 'rogue-B' }));
  assert.equal(dup.status, 2,
    'a foreign session must be denied even when the claim came from the CLI with no --session');
});
