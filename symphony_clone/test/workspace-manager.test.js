'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceManager, safeWorkspaceKey, runCommand } = require('../src/orchestrator/workspace-manager');

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
    const sub = args[0] === '-c' ? args[2] : args[0];
    const key = `${cmd} ${sub || ''}`;
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

  const cloneCall = calls.find((c) => c.args.includes('clone'));
  assert.ok(cloneCall, 'should call git clone on fresh workspace');

  const checkoutCall = calls.find((c) => c.args.includes('checkout') && c.args.includes('-B'));
  assert.ok(checkoutCall, 'fresh prepare should reset branch via checkout -B');
});

test('prepare on retry preserves local branch commits and creates recovery tag', async () => {
  const workspaceRoot = makeTempRoot();
  const workspacePath = path.join(workspaceRoot, 'ENG-101');
  fs.mkdirSync(path.join(workspacePath, '.git'), { recursive: true });

  const { calls, runner } = recordingRunner({
    'git show-ref': async () => ({ stdout: '', stderr: '' }),
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

  const tagCall = calls.find((c) => c.cmd === 'git' && c.args.includes('tag'));
  assert.ok(tagCall, 'retry with commits should create a recovery tag');
  assert.equal(tagCall.args[tagCall.args.indexOf('tag') + 1], result.backupRef);

  const destructiveCheckout = calls.find((c) => c.args.includes('checkout') && c.args.includes('-B'));
  assert.equal(destructiveCheckout, undefined, 'retry with commits MUST NOT call git checkout -B (destructive)');

  const cloneCall = calls.find((c) => c.args.includes('clone'));
  assert.equal(cloneCall, undefined, 'retry should not re-clone over existing workspace');
});

test('prepare on retry with no local commits resets branch as on first attempt', async () => {
  const workspaceRoot = makeTempRoot();
  const workspacePath = path.join(workspaceRoot, 'ENG-101');
  fs.mkdirSync(path.join(workspacePath, '.git'), { recursive: true });

  const { calls, runner } = recordingRunner({
    'git show-ref': async () => ({ stdout: '', stderr: '' }),
    'git rev-list': async () => ({ stdout: '0\n', stderr: '' })
  });

  const wm = new WorkspaceManager({
    workspaceRoot,
    repoUrl: 'git@example.com:org/repo.git',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  }, runner);

  const result = await wm.prepare({ key: 'ENG-101' }, { id: 'A' }, { attempt: 2 });

  assert.equal(result.resumed, false);
  const checkoutCall = calls.find((c) => c.args.includes('checkout') && c.args.includes('-B'));
  assert.ok(checkoutCall, 'empty branch on retry should still be reset to base');
  const tagCall = calls.find((c) => c.cmd === 'git' && c.args.includes('tag'));
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

  const checkoutCall = calls.find((c) => c.args.includes('checkout') && c.args.includes('-B'));
  assert.ok(checkoutCall, 'missing branch should be created via checkout -B');
});

test('runCommand rejects with the exit code on the error', async () => {
  await assert.rejects(
    () => runCommand('node', ['-e', 'process.exit(3)']),
    (err) => err.code === 3 && /failed with 3/.test(err.message),
  );
});

test('every symphony git command disables hooks via -c core.hooksPath=/dev/null', async () => {
  const workspaceRoot = makeTempRoot();
  const { calls, runner } = recordingRunner();
  const wm = new WorkspaceManager({
    workspaceRoot,
    repoUrl: 'git@example.com:org/repo.git',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  }, runner);

  await wm.prepare({ key: 'ENG-1' }, { id: 'A' }, { attempt: 1 });

  const gitCalls = calls.filter((c) => c.cmd === 'git');
  assert.ok(gitCalls.length > 0, 'expected git calls');
  for (const c of gitCalls) {
    assert.deepEqual(
      c.args.slice(0, 2), ['-c', 'core.hooksPath=/dev/null'],
      `git call missing hook-disable prefix: ${c.args.join(' ')}`,
    );
  }
});

function gitError(code, message) {
  const e = new Error(message || `git failed with ${code}`);
  e.code = code;
  return e;
}

test('prepare treats branch-absent (show-ref exit 1) as a fresh reset', async () => {
  const workspaceRoot = makeTempRoot();
  const workspacePath = path.join(workspaceRoot, 'ENG-7');
  fs.mkdirSync(path.join(workspacePath, '.git'), { recursive: true });
  const { calls, runner } = recordingRunner({
    'git show-ref': async () => { throw gitError(1, 'absent'); },
  });
  const wm = new WorkspaceManager({
    workspaceRoot, repoUrl: 'git@example.com:org/repo.git',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  }, runner);

  const result = await wm.prepare({ key: 'ENG-7' }, { id: 'A' }, { attempt: 2 });
  assert.equal(result.resumed, false);
  assert.ok(calls.find((c) => c.args.includes('checkout') && c.args.includes('-B')), 'absent branch resets to base');
});

test('prepare propagates a real branchExists failure instead of resetting', async () => {
  const workspaceRoot = makeTempRoot();
  const workspacePath = path.join(workspaceRoot, 'ENG-8');
  fs.mkdirSync(path.join(workspacePath, '.git'), { recursive: true });
  const { calls, runner } = recordingRunner({
    'git show-ref': async () => { throw gitError(128, 'fatal: not a git repository'); },
  });
  const wm = new WorkspaceManager({
    workspaceRoot, repoUrl: 'git@example.com:org/repo.git',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  }, runner);

  await assert.rejects(() => wm.prepare({ key: 'ENG-8' }, { id: 'A' }, { attempt: 2 }), /128|not a git/);
  assert.equal(calls.find((c) => c.args.includes('checkout') && c.args.includes('-B')), undefined, 'must NOT reset on a real error');
});

test('prepare propagates a countCommitsAhead failure instead of resetting', async () => {
  const workspaceRoot = makeTempRoot();
  const workspacePath = path.join(workspaceRoot, 'ENG-9');
  fs.mkdirSync(path.join(workspacePath, '.git'), { recursive: true });
  const { calls, runner } = recordingRunner({
    'git show-ref': async () => ({ stdout: '', stderr: '' }),     // branch exists
    'git rev-list': async () => { throw gitError(128, 'fatal: bad revision'); },
  });
  const wm = new WorkspaceManager({
    workspaceRoot, repoUrl: 'git@example.com:org/repo.git',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  }, runner);

  await assert.rejects(() => wm.prepare({ key: 'ENG-9' }, { id: 'A' }, { attempt: 2 }), /128|bad revision/);
  assert.equal(calls.find((c) => c.args.includes('checkout') && c.args.includes('-B')), undefined, 'must NOT reset on a real error');
});
