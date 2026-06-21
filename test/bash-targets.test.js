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
