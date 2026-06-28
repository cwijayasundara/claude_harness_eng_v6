'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceManager, safeWorkspaceKey } = require('../src/orchestrator/workspace-manager');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'symphony-ws-rec-'));
}

function recordingRunner(handlers = {}) {
  const calls = [];
  const runner = async (cmd, args, options = {}) => {
    calls.push({ cmd, args, cwd: options.cwd });
    const sub = args[0] === '-c' ? args[2] : args[0];
    const key = `${cmd} ${sub || ''}`;
    if (handlers[key]) return handlers[key]({ cmd, args, cwd: options.cwd, calls });
    return { stdout: '', stderr: '' };
  };
  return { calls, runner };
}

function makeWm(workspaceRoot, runner) {
  return new WorkspaceManager({
    workspaceRoot,
    repoUrl: 'git@example.com:org/repo.git',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  }, runner);
}

function seedExistingWorkspace(workspaceRoot, key = 'ENG-101') {
  const workspacePath = path.join(workspaceRoot, key);
  fs.mkdirSync(path.join(workspacePath, '.git'), { recursive: true });
  return workspacePath;
}

test('recovery tag includes a random suffix to prevent ms-level collisions', async () => {
  const handlers = {
    'git show-ref': async () => ({ stdout: '', stderr: '' }),
    'git rev-list': async () => ({ stdout: '1\n', stderr: '' })
  };
  const rootA = makeTempRoot(); seedExistingWorkspace(rootA);
  const rootB = makeTempRoot(); seedExistingWorkspace(rootB);
  const { runner: rA } = recordingRunner(handlers);
  const { runner: rB } = recordingRunner(handlers);

  const a = await makeWm(rootA, rA).prepare({ key: 'ENG-101' }, { id: 'A' }, { attempt: 2 });
  const b = await makeWm(rootB, rB).prepare({ key: 'ENG-101' }, { id: 'A' }, { attempt: 2 });

  assert.match(a.backupRef, /^recovery\/agent\/ENG-101\/attempt-2-\d+-[0-9a-f]{8}$/);
  assert.match(b.backupRef, /^recovery\/agent\/ENG-101\/attempt-2-\d+-[0-9a-f]{8}$/);
  assert.notEqual(a.backupRef, b.backupRef, 'two retries at the same ms must produce different tag names');
});

test('recovery tag preserves attempt=0 instead of rendering "unknown"', async () => {
  const root = makeTempRoot();
  seedExistingWorkspace(root);
  const { runner } = recordingRunner({
    'git show-ref': async () => ({ stdout: '', stderr: '' }),
    'git rev-list': async () => ({ stdout: '1\n', stderr: '' })
  });
  const result = await makeWm(root, runner).prepare({ key: 'ENG-101' }, { id: 'A' }, { attempt: 0 });
  assert.match(result.backupRef, /attempt-0-/, 'attempt=0 must render as "attempt-0-"');
});

test('prepare with no runMeta still renders attempt-unknown gracefully', async () => {
  const root = makeTempRoot();
  seedExistingWorkspace(root);
  const { runner } = recordingRunner({
    'git show-ref': async () => ({ stdout: '', stderr: '' }),
    'git rev-list': async () => ({ stdout: '1\n', stderr: '' })
  });
  const result = await makeWm(root, runner).prepare({ key: 'ENG-101' }, { id: 'A' });
  assert.match(result.backupRef, /attempt-unknown-/);
});

test('prepare on resume checks out branch BEFORE tagging (no orphan tag if checkout fails)', async () => {
  const root = makeTempRoot();
  seedExistingWorkspace(root);
  const { calls, runner } = recordingRunner({
    'git show-ref': async () => ({ stdout: '', stderr: '' }),
    'git rev-list': async () => ({ stdout: '2\n', stderr: '' })
  });
  await makeWm(root, runner).prepare({ key: 'ENG-101' }, { id: 'A' }, { attempt: 2 });

  const checkoutIdx = calls.findIndex((c) => c.args.includes('checkout') && !c.args.includes('-B'));
  const tagIdx = calls.findIndex((c) => c.args.includes('tag'));
  assert.ok(checkoutIdx > -1 && tagIdx > -1, 'both checkout and tag must run');
  assert.ok(checkoutIdx < tagIdx, `checkout (idx ${checkoutIdx}) must run before tag (idx ${tagIdx})`);
});

test('show-ref uses --verify/--quiet and rev-list uses --end-of-options to harden against config drift', async () => {
  const root = makeTempRoot();
  seedExistingWorkspace(root);
  const { calls, runner } = recordingRunner({
    'git show-ref': async () => ({ stdout: '', stderr: '' }),
    'git rev-list': async () => ({ stdout: '1\n', stderr: '' })
  });
  await makeWm(root, runner).prepare({ key: 'ENG-101' }, { id: 'A' }, { attempt: 2 });

  const showRef = calls.find((c) => c.args.includes('show-ref'));
  const revList = calls.find((c) => c.args.includes('rev-list'));
  assert.ok(showRef.args.includes('--verify'), 'show-ref must use --verify');
  assert.ok(showRef.args.includes('--quiet'), 'show-ref must use --quiet');
  const refIdx = showRef.args.findIndex((a) => a.startsWith('refs/heads/'));
  assert.ok(refIdx > -1, 'show-ref must target a refs/heads/ ref');
  assert.ok(revList.args.includes('--end-of-options'), 'rev-list must use --end-of-options');
});

test('safeWorkspaceKey collapses .. and strips leading/trailing dots', () => {
  assert.equal(safeWorkspaceKey('..'), 'group');
  assert.equal(safeWorkspaceKey('.git'), 'git');
  assert.equal(safeWorkspaceKey('...'), 'group');
  assert.equal(safeWorkspaceKey('foo..bar'), 'foo.bar');
  assert.equal(safeWorkspaceKey('.foo.'), 'foo');
  assert.equal(safeWorkspaceKey('a..b..c'), 'a.b.c');
  assert.equal(safeWorkspaceKey('ENG-101'), 'ENG-101');
  assert.equal(safeWorkspaceKey('valid.name_v2'), 'valid.name_v2');
});

test('safeWorkspaceKey rejects malformed-ref outputs (VULN-003)', () => {
  // '-..-' previously walked through to '.', a malformed git ref + cwd alias
  assert.equal(safeWorkspaceKey('-..-'), 'group');
  // .lock suffix is forbidden by git check-ref-format
  assert.equal(safeWorkspaceKey('foo.lock'), 'group');
  assert.equal(safeWorkspaceKey('a.lock'), 'group');
  // pure-punctuation must fall back
  assert.equal(safeWorkspaceKey('.'), 'group');
  assert.equal(safeWorkspaceKey('._-._-'), 'group');
  assert.equal(safeWorkspaceKey('---'), 'group');
});
