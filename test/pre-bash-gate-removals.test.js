'use strict';

// Removal guarding, driven through the REAL pre-bash-gate binary.
//
// WHY THIS FILE EXISTS: the removal guard was first "verified" with a throwaway
// shell probe in a temp dir. The probe passed, the unit tests passed, and NOTHING
// in the repo asserted the behaviour — so a later refactor of the hook could
// silently unwire it and every test would stay green. That is the exact failure
// this branch's sibling work hit twice (a `sed -i` lock that was inert, and a
// path-form bypass), both times because the units tested a pure function while
// the wiring went unexercised.
//
// So this drives the hook over its real stdin contract, in a fixture laid out like
// a SCAFFOLDED project (package.json name != the harness, so machinery protection
// is active — inside the harness repo itself checkTrustBoundary deliberately
// returns early for self-development).
//
// The must-NOT-block list matters as much as the must-block list: this guard sits
// in a kernel hook on the path of every Bash command, so a false positive is
// expensive and permanent.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', '.claude', 'hooks', 'pre-bash-gate.js');

function scaffoldedProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-guard-'));
  // NOT the harness package name: machinery protection only applies to a
  // scaffolded product, since the harness edits its own hooks by design.
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"some-product"}\n');
  for (const dir of ['.claude/state', '.claude/git-hooks', 'src/generated', 'scratch', 'node_modules']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(root, '.claude/state/task-lifecycle.jsonl'), '');
  fs.writeFileSync(path.join(root, '.claude/state/coverage-baseline.txt'), '80\n');
  fs.writeFileSync(path.join(root, '.claude/git-hooks/pre-commit'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(root, 'scratch/junk'), 'x');
  fs.writeFileSync(path.join(root, 'src/generated/out.js'), 'x');
  return root;
}

function runGate(root, command) {
  const res = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    cwd: root,
  });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

// Deleting the evidence a gate reads is equivalent to rewriting it — and for a
// state-backed gate it is strictly better for the attacker, because an absent file
// reads as "nothing to check" rather than as tampering.
const MUST_BLOCK = [
  'rm .claude/state/task-lifecycle.jsonl',
  'rm -f .claude/state/coverage-baseline.txt',
  'rm -rf .claude/git-hooks',
  'rm -rf .claude/state',
  'rm -rf .claude',                                  // the container case
  'git restore .claude/state/task-lifecycle.jsonl',  // restore takes paths positionally
  'git checkout -- .claude/git-hooks/pre-commit',    // checkout needs the -- separator
  'mv .claude/state/task-lifecycle.jsonl /tmp/stash', // the SOURCE is removed
  'echo x && rm .claude/state/task-lifecycle.jsonl',  // later segment still counts
];

for (const command of MUST_BLOCK) {
  test(`BLOCKS: ${command}`, () => {
    const { status, out } = runGate(scaffoldedProject(), command);
    assert.strictEqual(status, 2, `expected a block (exit 2), got ${status}\n${out}`);
    assert.match(out, /BLOCKED/, out);
  });
}

// A kernel hook on every Bash command: a false positive here is expensive, and
// `rm -rf` of build output or scratch space is ordinary work.
const MUST_PASS = [
  'rm scratch/junk',
  'rm -rf src/generated',
  'rm -rf node_modules',
  'rm -rf /tmp/some-scratch-dir',   // outside the project is cleanup, not an escape
  'git checkout -b feature/x',      // a branch, not a path
  'git checkout main',              // a branch, not a path
  'git commit -m "rm the old thing"',
  'git status',
  'npm test',
  'echo "rm .claude/state/task-lifecycle.jsonl"',  // quoted text is not a command
];

for (const command of MUST_PASS) {
  test(`allows: ${command}`, () => {
    const { status, out } = runGate(scaffoldedProject(), command);
    assert.strictEqual(status, 0, `expected pass (exit 0), got ${status}\n${out}`);
  });
}

// The harness repo edits its own hooks by design, so machinery protection is off
// there. Without this the guard would make the harness undevelopable.
test('the harness repo itself is exempt from machinery removal blocking', () => {
  const root = scaffoldedProject();
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"claude-harness-eng-v5"}\n');
  const { status } = runGate(root, 'rm .claude/state/task-lifecycle.jsonl');
  assert.strictEqual(status, 0, 'harness self-development must not be blocked');
});

test('HARNESS_PROTECT=off is honoured for removals, as it is for writes', () => {
  const res = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm .claude/state/task-lifecycle.jsonl' } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: scaffoldedProject(), HARNESS_PROTECT: 'off' },
  });
  assert.strictEqual(res.status, 0);
});
