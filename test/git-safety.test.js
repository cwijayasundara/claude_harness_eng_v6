'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  findForbiddenGit,
  isGitSafetyActive,
  checkGitSafety,
} = require('../.claude/hooks/lib/git-safety');

test('findForbiddenGit catches stash, reset --hard, clean -fd, force push', () => {
  assert.equal(findForbiddenGit('git stash').id, 'git-stash');
  assert.equal(findForbiddenGit('git reset --hard HEAD').id, 'git-reset-hard');
  assert.equal(findForbiddenGit('git clean -fd').id, 'git-clean-fd');
  assert.equal(findForbiddenGit('git push --force origin main').id, 'git-push-force');
  assert.equal(findForbiddenGit('git push -f origin main').id, 'git-push-force');
});

test('findForbiddenGit allows path-scoped add and commit', () => {
  assert.equal(findForbiddenGit('git add src/a.ts'), null);
  assert.equal(findForbiddenGit('git commit -m "feat: x"'), null);
  assert.equal(findForbiddenGit('git status'), null);
});

test('isGitSafetyActive respects HARNESS_PARALLEL_AGENTS and escape', () => {
  assert.equal(isGitSafetyActive({ env: { HARNESS_PARALLEL_AGENTS: '1' } }), true);
  assert.equal(
    isGitSafetyActive({ env: { HARNESS_PARALLEL_AGENTS: '1', HARNESS_GIT_SAFETY: 'off' } }),
    false
  );
  assert.equal(isGitSafetyActive({ env: {} }), false);
});

test('isGitSafetyActive detects parallel-implement.lock', () => {
  const projectDir = path.join(__dirname, 'fixtures', 'git-safety-lock');
  // use existsSync stub
  const lockPath = path.join(projectDir, '.claude', 'state', 'parallel-implement.lock');
  assert.equal(
    isGitSafetyActive({
      projectDir,
      env: {},
      existsSync: (p) => p === lockPath,
    }),
    true
  );
});

test('checkGitSafety blocks only when active', () => {
  const inactive = checkGitSafety('git stash', { env: {} });
  assert.equal(inactive.block, false);

  const active = checkGitSafety('git stash', { env: { HARNESS_PARALLEL_AGENTS: '1' } });
  assert.equal(active.block, true);
  assert.match(active.reason, /BLOCKED/);
  assert.match(active.reason, /git stash/);
});
