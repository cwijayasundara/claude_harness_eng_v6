'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceManager, scrubbedGitEnv } = require('../src/orchestrator/workspace-manager');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'symphony-ws-sec-'));
}

function recordingRunner(handlers = {}) {
  const calls = [];
  const runner = async (cmd, args, options = {}) => {
    calls.push({ cmd, args, cwd: options.cwd, env: options.env });
    const sub = args[0] === '-c' ? args[2] : args[0];
    const key = `${cmd} ${sub || ''}`;
    if (handlers[key]) return handlers[key]({ cmd, args, cwd: options.cwd, calls });
    return { stdout: '', stderr: '' };
  };
  return { calls, runner };
}

test('scrubbedGitEnv keeps git-safe vars and drops orchestrator secrets', () => {
  const out = scrubbedGitEnv({
    PATH: '/usr/bin', HOME: '/home/x', SSH_AUTH_SOCK: '/tmp/ssh',
    GIT_SSH_COMMAND: 'ssh', LANG: 'en_US.UTF-8', HTTPS_PROXY: 'http-proxy',
    GITHUB_TOKEN: 'fake-gh-token', LINEAR_API_KEY: 'lin_secret',
    ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-oai', RANDOM_SECRET: 'x',
  });
  assert.equal(out.PATH, '/usr/bin');
  assert.equal(out.HOME, '/home/x');
  assert.equal(out.SSH_AUTH_SOCK, '/tmp/ssh');
  assert.equal(out.GIT_SSH_COMMAND, 'ssh');
  assert.equal(out.LANG, 'en_US.UTF-8');
  assert.equal(out.HTTPS_PROXY, 'http-proxy');
  assert.equal(out.GITHUB_TOKEN, undefined);
  assert.equal(out.LINEAR_API_KEY, undefined);
  assert.equal(out.ANTHROPIC_API_KEY, undefined);
  assert.equal(out.OPENAI_API_KEY, undefined);
  assert.equal(out.RANDOM_SECRET, undefined);
});

test('runGit hands git a scrubbed env (no orchestrator secrets reach git)', async () => {
  process.env.LINEAR_API_KEY = 'lin_secret_test';
  try {
    const workspaceRoot = makeTempRoot();
    const { calls, runner } = recordingRunner();
    const wm = new WorkspaceManager({
      workspaceRoot, repoUrl: 'git@example.com:org/repo.git',
      github: { branchPrefix: 'agent', baseBranch: 'main' }
    }, runner);
    await wm.prepare({ key: 'ENG-1' }, { id: 'A' }, { attempt: 1 });
    const gitCall = calls.find((c) => c.cmd === 'git');
    assert.ok(gitCall.env, 'git call must pass an explicit env');
    assert.equal(gitCall.env.LINEAR_API_KEY, undefined, 'secret must not reach git env');
    assert.ok(gitCall.env.PATH, 'PATH must survive scrubbing');
  } finally {
    delete process.env.LINEAR_API_KEY;
  }
});
