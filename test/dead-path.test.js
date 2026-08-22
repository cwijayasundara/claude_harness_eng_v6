'use strict';

// "Delete with each task" (SwarmForge pickup #4).
//
// From the swarm-forge `squad` redo plan, verbatim: "When a path dies, delete
// its functions, templates, config lines, and tests in that same commit... grep
// the old name. If the only remaining refs are the `defn` and tests, delete
// both." Banned there: `(defn foo [_ _] [])` stubs, and inverting a dead test
// into "does not mention merger" instead of deleting it.
//
// This harness has the matching disease on record: 132 registered controls, a
// cut-to-half proposal partially executed and then overwhelmed by accretion in
// five weeks, and a rewrite abandoned because it accreted 6x faster. The
// control-budget ratchet counts controls; nothing counted orphaned CODE.
//
// The rule implemented here is precise, which is what keeps it usable: a symbol
// that HAD live production callers before this change and has NONE after it,
// while its definition is still in the tree. Not "unused code" in general —
// this commit is what orphaned it, so this commit is where it gets deleted.

const assert = require('assert');
const { test } = require('node:test');

const {
  classifyOrphans,
  definesSymbol,
  isKeepMarked,
  removedIdentifiers,
} = require('../.claude/hooks/lib/dead-path.js');

// ---- what the diff removed ----

test('an identifier dropped from a call site is a candidate', () => {
  const before = 'function run() {\n  return formatLegacyRow(x);\n}\n';
  const after = 'function run() {\n  return x;\n}\n';
  assert.ok(removedIdentifiers(before, after).has('formatLegacyRow'));
});

test('an identifier still used elsewhere in the same file is NOT a candidate', () => {
  const before = 'gone(); helper(); helper();\n';
  const after = 'helper();\n';
  const removed = removedIdentifiers(before, after);
  assert.ok(!removed.has('helper'), 'still called in the new content');
  assert.ok(removed.has('gone'));
});

test('language keywords and short noise are not candidates', () => {
  const before = 'if (x) { return doThing(); }\n';
  const after = 'return 1;\n';
  const removed = removedIdentifiers(before, after);
  for (const noise of ['if', 'return', 'x']) {
    assert.ok(!removed.has(noise), `${noise} must not be a candidate`);
  }
  assert.ok(removed.has('doThing'));
});

// ---- where it is defined ----

test('a definition is recognised across the shapes this repo actually uses', () => {
  assert.ok(definesSymbol('function formatRow(a) {}', 'formatRow'));
  assert.ok(definesSymbol('const formatRow = (a) => a;', 'formatRow'));
  assert.ok(definesSymbol('class FormatRow {}', 'FormatRow'));
  assert.ok(definesSymbol('  async formatRow(a) {', 'formatRow'));
  assert.ok(definesSymbol('def format_row(a):', 'format_row'));
  assert.ok(!definesSymbol('  return formatRow(a);', 'formatRow'), 'a call is not a definition');
  assert.ok(!definesSymbol('const formatRowLater = 1;', 'formatRow'), 'prefix match is not a definition');
});

test('a keep marker exempts a symbol that is deliberately callerless', () => {
  const src = '// harness:keep-dead public CLI entry point\nfunction main() {}\n';
  assert.equal(isKeepMarked(src, 'main'), true);
  assert.equal(isKeepMarked('function main() {}\n', 'main'), false);
  assert.equal(isKeepMarked('// harness:keep-dead other\nfunction main() {}\n', 'other'), true);
});

// ---- the finding ----

const orphan = {
  symbol: 'formatLegacyRow',
  definedIn: '.claude/scripts/report.js',
  refsBefore: 3,
  refsAfter: 0,
  keepMarked: false,
};

test('a symbol that lost its last production caller and is still defined is a finding', () => {
  const found = classifyOrphans([orphan]);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /formatLegacyRow/);
  assert.match(found[0].message, /report\.js/, 'the finding must name where to delete from');
});

test('a symbol that still has callers is not a finding', () => {
  assert.deepEqual(classifyOrphans([{ ...orphan, refsAfter: 1 }]), []);
});

test('a symbol that never had production callers is not a finding — this commit did not orphan it', () => {
  assert.deepEqual(classifyOrphans([{ ...orphan, refsBefore: 0 }]), [],
    'pre-existing dead code is the drift report\'s job, not this gate\'s');
});

test('a symbol whose definition went with it is not a finding — that is the correct outcome', () => {
  assert.deepEqual(classifyOrphans([{ ...orphan, definedIn: null }]), []);
});

test('a keep-marked symbol is exempt', () => {
  assert.deepEqual(classifyOrphans([{ ...orphan, keepMarked: true }]), []);
});

test('the finding says what to do, not just that something is wrong', () => {
  const [finding] = classifyOrphans([orphan]);
  assert.match(finding.message, /delete/i,
    'an LLM-legible signal names the correction — the highest-leverage sensor technique (G5)');
});

test('tests-only survival is still a finding — the dead test dies with the dead function', () => {
  // refsAfter counts PRODUCTION references only. A symbol referenced solely by
  // its own tests is exactly the swarm-forge rule: "if the only remaining refs
  // are the defn and tests, delete both."
  const [finding] = classifyOrphans([{ ...orphan, refsAfter: 0, testRefsAfter: 4 }]);
  assert.match(finding.message, /test/i, 'the finding must mention the tests that also die');
});
