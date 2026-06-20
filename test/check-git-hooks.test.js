const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { REPO_ROOT, makeHookProject, makeGitProject, runHook } = require('./helpers/hook-fixture');

const HOOK = 'check-git-hooks.js';

// makeGitProject copies git-hooks into .claude/git-hooks but NOT into .git/hooks
// (that is /scaffold's job). It also does not copy the SessionStart hook, so add it.
function gitProjectWithHook() {
  const projectDir = makeGitProject();
  fs.copyFileSync(
    path.join(REPO_ROOT, '.claude', 'hooks', HOOK),
    path.join(projectDir, '.claude', 'hooks', HOOK)
  );
  return projectDir;
}

function installPreCommit(projectDir, content) {
  const dest = path.join(projectDir, '.git', 'hooks', 'pre-commit');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}

test('warns when a git repo has no pre-commit hook installed', async () => {
  const projectDir = gitProjectWithHook();
  const result = await runHook(projectDir, HOOK, {});
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('not installed'), result.stdout);
  assert.ok(/coverage ratchet/.test(result.stdout), result.stdout);
});

test('is silent when the harness pre-commit hook is installed', async () => {
  const projectDir = gitProjectWithHook();
  // The real hook carries the marker the check looks for.
  const real = fs.readFileSync(path.join(projectDir, '.claude', 'git-hooks', 'pre-commit'), 'utf8');
  installPreCommit(projectDir, real);
  const result = await runHook(projectDir, HOOK, {});
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '', result.stdout);
});

test('warns when a foreign (non-harness) pre-commit is present', async () => {
  const projectDir = gitProjectWithHook();
  installPreCommit(projectDir, '#!/bin/sh\necho "my own hook"\n');
  const result = await runHook(projectDir, HOOK, {});
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('not installed'), result.stdout);
});

test('is silent when this is not a git repository', async () => {
  const projectDir = makeHookProject([HOOK]); // no .git
  const result = await runHook(projectDir, HOOK, {});
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '', result.stdout);
});

test('is silent inside the harness repo itself (hooks intentionally absent)', async () => {
  const projectDir = gitProjectWithHook();
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'claude-harness-eng-v5' }));
  const result = await runHook(projectDir, HOOK, {});
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '', result.stdout);
});
