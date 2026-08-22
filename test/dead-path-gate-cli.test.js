'use strict';

// The dead-path gate driven through a REAL git repository — real commits, a
// real index, real `git grep`. Hand-built fixtures would encode my assumption
// about what `git grep --cached` prints, which is exactly the class of bug this
// harness keeps finding: a gate that read a flat contract while real contracts
// nest, green the whole time because the fixture agreed with the reader.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const GATE = path.join(__dirname, '..', '.claude', 'scripts', 'dead-path-gate.js');

function git(args, cwd) {
  return String(execFileSync('git', args, { cwd, encoding: 'utf8' }));
}

/** A repo whose HEAD has a helper with two live callers. */
function repoWithLiveHelper() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-path-'));
  git(['init', '-q'], dir);
  git(['config', 'user.email', 't@example.com'], dir);
  git(['config', 'user.name', 'T'], dir);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'src/helpers.js'),
    'function formatLegacyRow(row) {\n  return row.join(",");\n}\n\nmodule.exports = { formatLegacyRow };\n');
  fs.writeFileSync(path.join(dir, 'src/report.js'),
    'const { formatLegacyRow } = require("./helpers");\n'
    + 'function render(rows) {\n  return rows.map(formatLegacyRow);\n}\n'
    + 'module.exports = { render };\n');
  fs.writeFileSync(path.join(dir, 'test/helpers.test.js'),
    'const { formatLegacyRow } = require("../src/helpers");\n'
    + 'test("formats", () => { formatLegacyRow([1]); });\n');

  git(['add', '-A'], dir);
  git(['commit', '-qm', 'base'], dir);
  return dir;
}

function runGate(dir, args = []) {
  const r = require('child_process').spawnSync('node', [GATE, ...args], {
    cwd: dir, encoding: 'utf8',
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('a clean tree passes', () => {
  const dir = repoWithLiveHelper();
  assert.equal(runGate(dir).code, 0);
});

test('removing the last caller while keeping the function BLOCKS', () => {
  const dir = repoWithLiveHelper();
  // The change that orphans it: report.js stops calling the helper.
  fs.writeFileSync(path.join(dir, 'src/report.js'),
    'function render(rows) {\n  return rows;\n}\n\nmodule.exports = { render };\n');
  git(['add', '-A'], dir);

  const r = runGate(dir);
  assert.equal(r.code, 1, `expected a block, got ${r.code}: ${r.out}`);
  assert.match(r.out, /formatLegacyRow/);
  assert.match(r.out, /src\/helpers\.js/, 'must name the file to delete from');
  assert.match(r.out, /test/i, 'the surviving test reference must be called out');
});

test('deleting the function WITH its caller passes — that is the correct outcome', () => {
  const dir = repoWithLiveHelper();
  fs.writeFileSync(path.join(dir, 'src/report.js'),
    'function render(rows) {\n  return rows;\n}\n\nmodule.exports = { render };\n');
  fs.rmSync(path.join(dir, 'src/helpers.js'));
  fs.rmSync(path.join(dir, 'test/helpers.test.js'));
  git(['add', '-A'], dir);

  const r = runGate(dir);
  assert.equal(r.code, 0, `deleting with the task must pass, got: ${r.out}`);
});

test('a keep-dead marker exempts a deliberately callerless definition', () => {
  const dir = repoWithLiveHelper();
  fs.writeFileSync(path.join(dir, 'src/helpers.js'),
    '// harness:keep-dead public API, called by downstream projects\n'
    + 'function formatLegacyRow(row) {\n  return row.join(",");\n}\n\n'
    + 'module.exports = { formatLegacyRow };\n');
  fs.writeFileSync(path.join(dir, 'src/report.js'),
    'function render(rows) {\n  return rows;\n}\n\nmodule.exports = { render };\n');
  git(['add', '-A'], dir);

  assert.equal(runGate(dir).code, 0);
});

test('moving a call site does not fire — the symbol did not die', () => {
  const dir = repoWithLiveHelper();
  fs.writeFileSync(path.join(dir, 'src/report.js'),
    'const { formatLegacyRow } = require("./helpers");\n'
    + 'function render(rows) {\n  const f = formatLegacyRow;\n  return rows.map(f);\n}\n'
    + 'module.exports = { render };\n');
  git(['add', '-A'], dir);

  assert.equal(runGate(dir).code, 0, 'still referenced in production — not an orphan');
});

test('pre-existing dead code is not this gate\'s business', () => {
  const dir = repoWithLiveHelper();
  // A function with no callers at HEAD, and an unrelated staged edit.
  fs.appendFileSync(path.join(dir, 'src/helpers.js'),
    '\nfunction neverCalledAnywhere(x) { return x; }\n');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'add already-dead helper'], dir);

  fs.writeFileSync(path.join(dir, 'src/report.js'),
    'const { formatLegacyRow } = require("./helpers");\n'
    + 'function render(rows) {\n  return rows.map(formatLegacyRow);\n}\n'
    + '// touched\nmodule.exports = { render };\n');
  git(['add', '-A'], dir);

  assert.equal(runGate(dir).code, 0, 'the drift report owns standing dead code, not this gate');
});

test('a surviving import is not a caller — the orphaned require still BLOCKS', () => {
  const dir = repoWithLiveHelper();
  // The import stays; only the call goes. Counting the require line as a use
  // would hide every orphan whose importer was not also cleaned up.
  fs.writeFileSync(path.join(dir, 'src/report.js'),
    'const { formatLegacyRow } = require("./helpers");\n'
    + 'function render(rows) {\n  return rows;\n}\n'
    + 'module.exports = { render };\n');
  git(['add', '-A'], dir);

  const r = runGate(dir);
  assert.equal(r.code, 1, `an import is not a use, got ${r.code}: ${r.out}`);
});

test('a symbol with no production caller to begin with does not fire', () => {
  const dir = repoWithLiveHelper();
  fs.appendFileSync(path.join(dir, 'src/helpers.js'),
    '\nfunction helperOnlyUsedInTests(x) { return x; }\n');
  fs.writeFileSync(path.join(dir, 'test/helpers.test.js'),
    'const { formatLegacyRow, helperOnlyUsedInTests } = require("../src/helpers");\n'
    + 'test("a", () => { formatLegacyRow([1]); });\n'
    + 'test("b", () => { helperOnlyUsedInTests(1); });\n');
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'test-only helper'], dir);

  // The staged change drops the only call — but it was a TEST call, so no
  // production caller was ever lost. Standing dead code is the drift report's.
  fs.writeFileSync(path.join(dir, 'test/helpers.test.js'),
    'const { formatLegacyRow } = require("../src/helpers");\n'
    + 'test("a", () => { formatLegacyRow([1]); });\n');
  git(['add', '-A'], dir);

  assert.equal(runGate(dir).code, 0, 'this commit orphaned nothing in production');
});

test('the symbol cap is reported, never silently applied', () => {
  const dir = repoWithLiveHelper();
  const defs = Array.from({ length: 12 }, (_, i) => `function droppedHelper${i}() { return ${i}; }`);
  const calls = Array.from({ length: 12 }, (_, i) => `  droppedHelper${i}();`);
  fs.writeFileSync(path.join(dir, 'src/many.js'), `${defs.join('\n')}\nmodule.exports = {};\n`);
  fs.writeFileSync(path.join(dir, 'src/bulk.js'), `function runAll() {\n${calls.join('\n')}\n}\nmodule.exports = { runAll };\n`);
  git(['add', '-A'], dir);
  git(['commit', '-qm', 'bulk'], dir);

  // Every call goes at once; the twelve definitions stay behind.
  fs.writeFileSync(path.join(dir, 'src/bulk.js'), 'function runAll() {\n  return 0;\n}\nmodule.exports = { runAll };\n');
  git(['add', '-A'], dir);

  const r = runGate(dir, ['--max-symbols', '3']);
  assert.match(r.out, /not checked/, 'a bounded gate must say what it did not cover');
});
