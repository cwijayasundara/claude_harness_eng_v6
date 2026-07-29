const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { extractWriteTargets } = require(path.join(
  __dirname, '..', '.claude', 'hooks', 'lib', 'bash-targets.js'
));

function has(cmd, target) {
  return extractWriteTargets(cmd).includes(target);
}

test('extracts simple redirection targets', () => {
  assert.ok(has('echo hi > out.txt', 'out.txt'));
  assert.ok(has('echo hi >> log.txt', 'log.txt'));
  assert.ok(has('cmd 2> err.log', 'err.log'));
  assert.ok(has('cmd &> all.log', 'all.log'));
});

test('ignores fd duplications, not real files', () => {
  assert.deepStrictEqual(extractWriteTargets('cmd 2>&1'), []);
  assert.ok(!has('run 2>&1 > out.txt', '&1'));
  assert.ok(has('run 2>&1 > out.txt', 'out.txt'));
});

test('extracts quoted redirection targets', () => {
  assert.ok(has('echo x > "my file.txt"', 'my file.txt'));
  assert.ok(has("printf y >> '.claude/state/coverage-baseline.txt'", '.claude/state/coverage-baseline.txt'));
});

test('extracts tee targets including -a and multiple files', () => {
  assert.ok(has('echo x | tee a.txt', 'a.txt'));
  assert.ok(has('echo x | tee -a b.txt', 'b.txt'));
  const t = extractWriteTargets('echo x | tee one.txt two.txt');
  assert.ok(t.includes('one.txt') && t.includes('two.txt'));
});

test('extracts sed -i targets', () => {
  assert.ok(has("sed -i 's/a/b/' file.js", 'file.js'));
  assert.ok(has("sed -i '' 's/a/b/' file.js", 'file.js')); // BSD two-arg form -> first non-flag is '', file follows
  assert.ok(has('sed --in-place=.bak s/a/b/ data.txt', 'data.txt'));
});

test('extracts dd of= targets', () => {
  assert.ok(has('dd if=/dev/zero of=disk.img bs=1M', 'disk.img'));
});

test('extracts cp/mv/install destination (last operand)', () => {
  assert.ok(has('cp a.txt b.txt dest/', 'dest/'));
  assert.ok(has('mv old.js .claude/hooks/pre-write-gate.js', '.claude/hooks/pre-write-gate.js'));
  assert.ok(has('install -m 755 src bin/tool', 'bin/tool'));
});

test('splits compound commands and finds targets in each segment', () => {
  const t = extractWriteTargets('echo a > x.txt && echo b >> y.txt; cp z .claude/settings.json');
  assert.ok(t.includes('x.txt'));
  assert.ok(t.includes('y.txt'));
  assert.ok(t.includes('.claude/settings.json'));
});

test('returns empty for read-only commands', () => {
  assert.deepStrictEqual(extractWriteTargets('cat file.txt'), []);
  assert.deepStrictEqual(extractWriteTargets('grep -r foo src/'), []);
  assert.deepStrictEqual(extractWriteTargets('ls -la'), []);
  assert.deepStrictEqual(extractWriteTargets(''), []);
  assert.deepStrictEqual(extractWriteTargets(undefined), []);
});

test('finds the machinery target an agent would use to disable a gate', () => {
  // The whole point: every plausible shell write to a protected path is surfaced.
  assert.ok(has('echo "" > .claude/hooks/pre-write-gate.js', '.claude/hooks/pre-write-gate.js'));
  assert.ok(has('tee .claude/git-hooks/pre-commit < /dev/null', '.claude/git-hooks/pre-commit'));
  assert.ok(has("sed -i 's/.*/return/' .claude/hooks/lib/tdd.js", '.claude/hooks/lib/tdd.js'));
});

// ---------------------------------------------------------- removal targets
//
// The write-target extractor answers "what does this command WRITE". It never
// answered "what does this command REMOVE", so the single cheapest way to defeat
// a state-backed gate was invisible to pre-bash-gate:
//
//   rm .claude/state/task-lifecycle.jsonl
//   rm -rf .claude/git-hooks
//   git checkout -- .claude/git-hooks/pre-commit
//   mv .claude/state/task-envelope.json /tmp/elsewhere      (only /tmp/elsewhere was seen)
//
// Deleting the evidence a gate reads is equivalent to rewriting it, and for a
// ledger-backed control it is strictly better: an absent ledger reads as "nothing
// to check" rather than as tampering.
//
// Kept SEPARATE from write targets on purpose. Write targets are also checked for
// project scope, and routing removals through that would start blocking
// `rm -rf /tmp/scratch` — enormous new friction for no security gain. Removals are
// checked only against protected machinery.

const { extractRemoveTargets } = require('../.claude/hooks/lib/bash-targets');

test('extractRemoveTargets finds rm operands', () => {
  assert.deepStrictEqual(extractRemoveTargets('rm .claude/state/task-lifecycle.jsonl'), ['.claude/state/task-lifecycle.jsonl']);
  assert.deepStrictEqual(extractRemoveTargets('rm -f a.txt b.txt'), ['a.txt', 'b.txt']);
  assert.deepStrictEqual(extractRemoveTargets('rm -rf .claude/git-hooks'), ['.claude/git-hooks']);
});

test('extractRemoveTargets finds the SOURCE of a move, which the write path misses', () => {
  assert.deepStrictEqual(
    extractRemoveTargets('mv .claude/state/task-envelope.json /tmp/elsewhere'),
    ['.claude/state/task-envelope.json']
  );
});

// Content-restoring git verbs overwrite a file from the index/stash without any
// shell redirection, so they leave no write target either.
test('extractRemoveTargets finds git restore/checkout paths', () => {
  assert.deepStrictEqual(extractRemoveTargets('git checkout -- .claude/git-hooks/pre-commit'), ['.claude/git-hooks/pre-commit']);
  assert.deepStrictEqual(extractRemoveTargets('git restore .claude/state/coverage-baseline.txt'), ['.claude/state/coverage-baseline.txt']);
});

test('extractRemoveTargets ignores git subcommands that do not overwrite a path', () => {
  assert.deepStrictEqual(extractRemoveTargets('git checkout -b feature/x'), []);
  assert.deepStrictEqual(extractRemoveTargets('git checkout main'), []);
  assert.deepStrictEqual(extractRemoveTargets('git status'), []);
  assert.deepStrictEqual(extractRemoveTargets('git commit -m "rm the thing"'), []);
});

test('extractRemoveTargets returns nothing for commands that remove nothing', () => {
  for (const cmd of ['echo hi > out.txt', 'cp a b', 'ls -la', 'npm test']) {
    assert.deepStrictEqual(extractRemoveTargets(cmd), [], cmd);
  }
});

test('extractRemoveTargets is quote-aware and handles multiple segments', () => {
  assert.deepStrictEqual(
    extractRemoveTargets('echo "rm not-a-file" && rm real-file'),
    ['real-file']
  );
});

// Removing the DIRECTORY that holds machinery is a bigger hammer than removing one
// file, and it was invisible: the patterns match paths INSIDE `.claude/hooks/`, so
// `.claude/hooks` itself matched nothing. `rm -rf .claude` defeated every
// file-level guard at once.
test('machineryAncestor catches removing a directory that CONTAINS machinery', () => {
  const { machineryAncestor } = require('../.claude/hooks/lib/trust-boundary');
  const root = '/proj';
  for (const dir of ['.claude', '.claude/hooks', '.claude/git-hooks', '.claude/state', '.claude/authority']) {
    assert.ok(machineryAncestor(root, `${root}/${dir}`), `${dir} contains machinery and must be protected`);
  }
});

test('machineryAncestor leaves ordinary directories alone', () => {
  const { machineryAncestor } = require('../.claude/hooks/lib/trust-boundary');
  const root = '/proj';
  for (const dir of ['src', 'tests', 'node_modules', '.claude/skills', 'build', '.']) {
    assert.strictEqual(machineryAncestor(root, `${root}/${dir}`), null, `${dir} must not be protected`);
  }
});
