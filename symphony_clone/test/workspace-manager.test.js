'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceManager, safeWorkspaceKey } = require('../src/orchestrator/workspace-manager');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'symphony-ws-'));
}

test('cleanup removes workspace directory when retention=delete', async () => {
  const workspaceRoot = makeTempRoot();
  const target = path.join(workspaceRoot, 'ENG-101');
  fs.mkdirSync(path.join(target, '.git'), { recursive: true });
  fs.writeFileSync(path.join(target, 'file.txt'), 'data');

  const wm = new WorkspaceManager({
    workspaceRoot,
    workspaceRetention: 'delete',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  });

  await wm.cleanup(target);

  assert.equal(fs.existsSync(target), false);
});

test('cleanup leaves workspace directory intact when retention=keep', async () => {
  const workspaceRoot = makeTempRoot();
  const target = path.join(workspaceRoot, 'ENG-101');
  fs.mkdirSync(target, { recursive: true });

  const wm = new WorkspaceManager({
    workspaceRoot,
    workspaceRetention: 'keep',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  });

  await wm.cleanup(target);

  assert.equal(fs.existsSync(target), true);
});

test('cleanup refuses paths outside workspaceRoot', async () => {
  const workspaceRoot = makeTempRoot();
  const outside = makeTempRoot();
  const target = path.join(outside, 'rogue');
  fs.mkdirSync(target, { recursive: true });

  const wm = new WorkspaceManager({
    workspaceRoot,
    workspaceRetention: 'delete',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  });

  await assert.rejects(() => wm.cleanup(target), /workspaceRoot/);
  assert.equal(fs.existsSync(target), true);
});

test('cleanup is a no-op when path does not exist', async () => {
  const workspaceRoot = makeTempRoot();
  const target = path.join(workspaceRoot, 'never-existed');

  const wm = new WorkspaceManager({
    workspaceRoot,
    workspaceRetention: 'delete',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  });

  await wm.cleanup(target);
  assert.equal(fs.existsSync(target), false);
});

function recordingRunner(handlers = {}) {
  const calls = [];
  const runner = async (cmd, args, options = {}) => {
    calls.push({ cmd, args, cwd: options.cwd });
    const key = `${cmd} ${args[0] || ''}`;
    if (handlers[key]) return handlers[key]({ cmd, args, cwd: options.cwd, calls });
    return { stdout: '', stderr: '' };
  };
  return { calls, runner };
}

test('prepare on fresh clone uses git clone + checkout -B (current behavior)', async () => {
  const workspaceRoot = makeTempRoot();
  const { calls, runner } = recordingRunner();
  const wm = new WorkspaceManager({
    workspaceRoot,
    repoUrl: 'git@example.com:org/repo.git',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  }, runner);

  const result = await wm.prepare({ key: 'ENG-101' }, { id: 'A' }, { attempt: 1 });

  assert.equal(result.workspaceKey, 'ENG-101');
  assert.equal(result.branchName, 'agent/ENG-101');
  assert.equal(result.resumed, false);

  const cloneCall = calls.find((c) => c.args[0] === 'clone');
  assert.ok(cloneCall, 'should call git clone on fresh workspace');

  const checkoutCall = calls.find((c) => c.args[0] === 'checkout' && c.args.includes('-B'));
  assert.ok(checkoutCall, 'fresh prepare should reset branch via checkout -B');
});

test('prepare on retry preserves local branch commits and creates recovery tag', async () => {
  const workspaceRoot = makeTempRoot();
  const workspacePath = path.join(workspaceRoot, 'ENG-101');
  fs.mkdirSync(path.join(workspacePath, '.git'), { recursive: true });

  const { calls, runner } = recordingRunner({
    'git rev-parse': async () => ({ stdout: 'abc123\n', stderr: '' }),
    'git rev-list': async () => ({ stdout: '3\n', stderr: '' })
  });

  const wm = new WorkspaceManager({
    workspaceRoot,
    repoUrl: 'git@example.com:org/repo.git',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  }, runner);

  const result = await wm.prepare({ key: 'ENG-101' }, { id: 'A' }, { attempt: 2 });

  assert.equal(result.resumed, true);
  assert.equal(result.commitsAhead, 3);
  assert.match(result.backupRef, /^recovery\/agent\/ENG-101\/attempt-2-/);

  const tagCall = calls.find((c) => c.cmd === 'git' && c.args[0] === 'tag');
  assert.ok(tagCall, 'retry with commits should create a recovery tag');
  assert.equal(tagCall.args[1], result.backupRef);

  const destructiveCheckout = calls.find((c) => c.args[0] === 'checkout' && c.args.includes('-B'));
  assert.equal(destructiveCheckout, undefined, 'retry with commits MUST NOT call git checkout -B (destructive)');

  const cloneCall = calls.find((c) => c.args[0] === 'clone');
  assert.equal(cloneCall, undefined, 'retry should not re-clone over existing workspace');
});

test('prepare on retry with no local commits resets branch as on first attempt', async () => {
  const workspaceRoot = makeTempRoot();
  const workspacePath = path.join(workspaceRoot, 'ENG-101');
  fs.mkdirSync(path.join(workspacePath, '.git'), { recursive: true });

  const { calls, runner } = recordingRunner({
    'git rev-parse': async () => ({ stdout: 'abc123\n', stderr: '' }),
    'git rev-list': async () => ({ stdout: '0\n', stderr: '' })
  });

  const wm = new WorkspaceManager({
    workspaceRoot,
    repoUrl: 'git@example.com:org/repo.git',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  }, runner);

  const result = await wm.prepare({ key: 'ENG-101' }, { id: 'A' }, { attempt: 2 });

  assert.equal(result.resumed, false);
  const checkoutCall = calls.find((c) => c.args[0] === 'checkout' && c.args.includes('-B'));
  assert.ok(checkoutCall, 'empty branch on retry should still be reset to base');
  const tagCall = calls.find((c) => c.cmd === 'git' && c.args[0] === 'tag');
  assert.equal(tagCall, undefined, 'no commits to preserve → no recovery tag');
});

test('prepare on retry with no local branch (branch was deleted) resets normally', async () => {
  const workspaceRoot = makeTempRoot();
  const workspacePath = path.join(workspaceRoot, 'ENG-101');
  fs.mkdirSync(path.join(workspacePath, '.git'), { recursive: true });

  const { calls, runner } = recordingRunner({
    'git rev-parse': async () => { throw new Error('fatal: ambiguous argument'); }
  });

  const wm = new WorkspaceManager({
    workspaceRoot,
    repoUrl: 'git@example.com:org/repo.git',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  }, runner);

  const result = await wm.prepare({ key: 'ENG-101' }, { id: 'A' }, { attempt: 2 });
  assert.equal(result.resumed, false);

  const checkoutCall = calls.find((c) => c.args[0] === 'checkout' && c.args.includes('-B'));
  assert.ok(checkoutCall, 'missing branch should be created via checkout -B');
});
