const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');
const { makeGitProject, runGitHook } = require('./helpers/hook-fixture');

const HOOK = 'commit-msg';

function stage(projectDir, rel, content) {
  const p = path.join(projectDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  execFileSync('git', ['add', rel], { cwd: projectDir });
  return p;
}

function writeMsgFile(projectDir, message) {
  const msgFile = path.join(projectDir, '.git', 'COMMIT_EDITMSG');
  fs.mkdirSync(path.dirname(msgFile), { recursive: true });
  fs.writeFileSync(msgFile, message);
  return msgFile;
}

// Gap 1 — commit-msg hook: refactor subject + impure files → blocked

test('commit-msg: blocks when subject is "refactor: ..." and test files are staged', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/service/logic.js', 'module.exports = 1;\n');
  stage(projectDir, 'tests/logic.test.js', 'test("x", () => {});\n');
  const msgFile = writeMsgFile(projectDir, 'refactor: extract helper\n');
  const result = await runGitHook(projectDir, HOOK, {}, [msgFile]);
  assert.notStrictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(
    /refactor commit/i.test(result.stdout + result.stderr),
    result.stdout + result.stderr
  );
});

test('commit-msg: blocks when subject is "cleanup: ..." and snapshot files are staged', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/service/logic.py', 'X = 1\n');
  stage(projectDir, 'tests/__snapshots__/logic.snap', '// snapshot\n');
  const msgFile = writeMsgFile(projectDir, 'cleanup: remove dead code\n');
  const result = await runGitHook(projectDir, HOOK, {}, [msgFile]);
  assert.notStrictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(
    /refactor commit/i.test(result.stdout + result.stderr),
    result.stdout + result.stderr
  );
});

test('commit-msg: blocks when subject is "rename: ..." and test files are staged', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/service/foo.ts', 'export const x = 1;\n');
  stage(projectDir, 'src/service/foo.test.ts', 'test("x", () => {});\n');
  const msgFile = writeMsgFile(projectDir, 'rename: foo to bar\n');
  const result = await runGitHook(projectDir, HOOK, {}, [msgFile]);
  assert.notStrictEqual(result.status, 0, result.stdout + result.stderr);
});

test('commit-msg: passes when subject is "refactor: ..." but NO test/snapshot files staged', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/service/logic.js', 'module.exports = 1;\n');
  const msgFile = writeMsgFile(projectDir, 'refactor: simplify handler\n');
  const result = await runGitHook(projectDir, HOOK, {}, [msgFile]);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('commit-msg: passes for non-refactor subjects even when test files are staged', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/service/logic.js', 'module.exports = 1;\n');
  stage(projectDir, 'tests/logic.test.js', 'test("x", () => {});\n');
  const msgFile = writeMsgFile(projectDir, 'feat: add new feature\n');
  const result = await runGitHook(projectDir, HOOK, {}, [msgFile]);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('commit-msg: passes when subject is "fix: ..." (fix is not a refactor prefix)', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/service/logic.js', 'module.exports = 1;\n');
  stage(projectDir, 'tests/logic.test.js', 'test("x", () => {});\n');
  const msgFile = writeMsgFile(projectDir, 'fix: correct off-by-one\n');
  const result = await runGitHook(projectDir, HOOK, {}, [msgFile]);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('commit-msg: skips double-run when HARNESS_COMMIT_KIND=refactor is already set', async () => {
  // When the skill sets HARNESS_COMMIT_KIND=refactor, pre-commit already ran;
  // commit-msg must exit 0 without re-blocking.
  const projectDir = makeGitProject();
  stage(projectDir, 'src/service/logic.js', 'module.exports = 1;\n');
  stage(projectDir, 'tests/logic.test.js', 'test("x", () => {});\n');
  const msgFile = writeMsgFile(projectDir, 'refactor: extract helper\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COMMIT_KIND: 'refactor' }, [msgFile]);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('commit-msg: passes when called with no message file argument (no argv[2])', async () => {
  const projectDir = makeGitProject();
  const result = await runGitHook(projectDir, HOOK, {});
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('commit-msg: passes when message file has only comment lines before subject', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/service/logic.js', 'module.exports = 1;\n');
  // No test files staged — must pass regardless.
  const msgFile = writeMsgFile(projectDir, '# Please enter the commit message\nrefactor: tidy up\n');
  const result = await runGitHook(projectDir, HOOK, {}, [msgFile]);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('commit-msg: blocks for "extract(scope): ..." scoped refactor subject', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/service/logic.py', 'X = 1\n');
  stage(projectDir, 'tests/test_logic.py', 'def test_x(): pass\n');
  const msgFile = writeMsgFile(projectDir, 'extract(auth): split token logic\n');
  const result = await runGitHook(projectDir, HOOK, {}, [msgFile]);
  assert.notStrictEqual(result.status, 0, result.stdout + result.stderr);
});

test('commit-msg: blocks for "move!: ..." breaking-change refactor subject', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/service/logic.py', 'X = 1\n');
  stage(projectDir, 'tests/test_logic.py', 'def test_x(): pass\n');
  const msgFile = writeMsgFile(projectDir, 'move!: relocate helpers\n');
  const result = await runGitHook(projectDir, HOOK, {}, [msgFile]);
  assert.notStrictEqual(result.status, 0, result.stdout + result.stderr);
});

// --- claimsRefactor: widened subject detection ---

const { claimsRefactor } = require(
  path.join(__dirname, '..', '.claude', 'git-hooks', 'lib', 'refactor-purity')
);

test('claimsRefactor: existing prefix forms still match', () => {
  assert.ok(claimsRefactor('refactor: split god module'));
  assert.ok(claimsRefactor('rename(auth): UserService -> AccountService'));
  assert.ok(claimsRefactor('extract!: pull validation into lib'));
});

test('claimsRefactor: chore/style subjects with structural verbs match', () => {
  assert.ok(claimsRefactor('chore: rename UserService to AccountService'));
  assert.ok(claimsRefactor('style(api): tidy up imports and restructure handlers'));
  assert.ok(claimsRefactor('chore: move helpers into utils'));
});

test('claimsRefactor: bare structural verbs match without a prefix', () => {
  assert.ok(claimsRefactor('restructure auth module'));
  assert.ok(claimsRefactor('refactor the billing adapter'));
  assert.ok(claimsRefactor('reorganize folder layout'));
});

test('claimsRefactor: behavior-fix and feature subjects do NOT match', () => {
  assert.ok(!claimsRefactor('fix: rename variable that caused shadowing bug'));
  assert.ok(!claimsRefactor('feat: add move-to-folder action'));
  assert.ok(!claimsRefactor('chore: bump dependencies'));
  assert.ok(!claimsRefactor('docs: explain extract pipeline'));
  assert.ok(!claimsRefactor('move button to header on mobile'));
});

test('hook blocks a chore-prefixed rename that stages test files', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/svc.js', 'module.exports = 1;\n');
  stage(projectDir, 'src/svc.test.js', 'test("x", () => {});\n');
  const msgFile = writeMsgFile(projectDir, 'chore: rename svc helpers\n');
  const result = await runGitHook(projectDir, HOOK, {}, [msgFile]);
  assert.notStrictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(/refactor commit/i.test(result.stdout), result.stdout);
});

test('hook allows a plain chore commit that stages test files', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/svc.js', 'module.exports = 1;\n');
  stage(projectDir, 'src/svc.test.js', 'test("x", () => {});\n');
  const msgFile = writeMsgFile(projectDir, 'chore: update dev tooling\n');
  const result = await runGitHook(projectDir, HOOK, {}, [msgFile]);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});
