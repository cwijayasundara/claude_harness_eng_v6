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

const SUB = '/p/projects/slug/sess/subagents/agent-a1.jsonl';
const MAIN = '/p/projects/slug/sess.jsonl';

const dispatch = (over) => ({
  hook_event_name: 'PreToolUse', tool_name: 'Agent', session_id: 's1',
  transcript_path: SUB, tool_input: { subagent_type: 'implementer', description: 'Implement E1-S1' }, ...over,
});

test('the hook denies a duplicate in-flight story with exit 2 and an actionable reason', () => {
  const dir = projectDir();
  assert.equal(runHook(dir, dispatch()).status, 0, 'first dispatch must pass');
  assert.deepEqual(claims(dir), ['story:E1-S1']);

  const dup = runHook(dir, dispatch({
    tool_input: { subagent_type: 'implementer', description: 'Implement E1-S1 auth backend skeleton' },
  }));
  assert.equal(dup.status, 2, 'a duplicate dispatch must exit 2 (deny)');
  assert.match(dup.stderr, /story:E1-S1 is already being implemented/);
  assert.match(dup.stderr, /work-claim\.js release story:E1-S1/, 'a hard block must name its way past');
});

test('the hook denies a subagent spawning a generator', () => {
  const dir = projectDir();
  const r = runHook(dir, dispatch({
    tool_input: { subagent_type: 'generator', description: 'Implement group A backend skeleton' },
  }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /may not spawn a generator/);
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
  const r = runHook(dir, dispatch({ tool_name: 'Bash', tool_input: { command: 'echo E1-S1' } }));
  assert.equal(r.status, 0);
  assert.deepEqual(claims(dir), [], 'an unrelated tool must claim nothing');
});

test('SubagentStop releases the claim so the retry path is not stalled', () => {
  const dir = projectDir();
  runHook(dir, dispatch());
  const stop = runHook(dir, { hook_event_name: 'SubagentStop', agent_type: 'implementer' });
  assert.equal(stop.status, 0);
  assert.deepEqual(claims(dir), [], 'the claim must be released on stop');
  assert.equal(runHook(dir, dispatch()).status, 0, 'the retry must pass after release');
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
  runHook(dir, dispatch());
  const out = execFileSync('node', [CLI, 'release', 'story:E1-S1', '--root', dir], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  assert.match(out, /released story:E1-S1/);
  assert.equal(runHook(dir, dispatch()).status, 0, 'the story must be dispatchable after an explicit release');
});

test('work-claim.js list reports a claim the gate made', () => {
  const dir = projectDir();
  runHook(dir, dispatch());
  const out = execFileSync('node', [CLI, 'list', '--root', dir], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  assert.match(out, /story:E1-S1 held by/);
});
