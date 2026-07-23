'use strict';

// Tests for the v6 partition checker — the single structural rule of the reduction:
// a kernel unit may not hard-reference a pack unit.

const test = require('node:test');
const assert = require('node:assert');
const { hardRefs, checkPartition } = require('./check-partition');

test('hardRefs finds a require() of a lib', () => {
  const refs = hardRefs("const x = require('./lib/story-graph');", { lib: ['story-graph', 'common'] });
  assert.deepStrictEqual(refs, ['lib:story-graph']);
});

test('hardRefs finds a node invocation of a script', () => {
  const refs = hardRefs('run `node .claude/scripts/context-pack.js --diff`', { script: ['context-pack'] });
  assert.deepStrictEqual(refs, ['script:context-pack']);
});

test('hardRefs finds an npm run alias', () => {
  const refs = hardRefs('npm run duplication-gate', { script: ['duplication-gate'] });
  assert.deepStrictEqual(refs, ['script:duplication-gate']);
});

test('hardRefs finds a subagent_type dispatch', () => {
  const refs = hardRefs('Agent(subagent_type=generator)', { agent: ['generator'] });
  assert.deepStrictEqual(refs, ['agent:generator']);
});

test('hardRefs ignores prose routing mentions of a lane', () => {
  const refs = hardRefs('If the change is large, escalate to /design or /auto.', { skill: ['design', 'auto'] });
  assert.deepStrictEqual(refs, [], 'a bare /lane mention is a soft edge, not a hard one');
});

test('hardRefs ignores a bare agent name in prose', () => {
  const refs = hardRefs('the generator hands off to the evaluator', { agent: ['generator', 'evaluator'] });
  assert.deepStrictEqual(refs, []);
});

test('a require guarded by try/catch is optional, not a violation', () => {
  const res = checkPartition({
    assign: { 'skill:change': 'kernel', 'script:nav-index': 'brownfield' },
    texts: {
      'skill:change':
        'function load() {\n  try {\n    return require("./nav-index").loadNavIndex;\n  } catch (_) {\n    return null;\n  }\n}',
    },
    names: { script: ['nav-index'] },
  });
  assert.deepStrictEqual(res.violations, [], 'a guarded load survives the pack being absent');
  assert.strictEqual(res.optional.length, 1);
  assert.strictEqual(res.optional[0].to, 'script:nav-index');
});

test('a packRun declaration is optional, not a violation', () => {
  const res = checkPartition({
    assign: { 'lib:gate-registry': 'kernel', 'lib:gates-legacy': 'legacy-discipline' },
    texts: { 'lib:gate-registry': "run: packRun('gates-legacy', 'checkAtFirstGate', 'legacy-discipline')" },
    names: { lib: ['gates-legacy'] },
  });
  assert.deepStrictEqual(res.violations, []);
  assert.strictEqual(res.optional.length, 1);
});

test('an UNGUARDED require of the same module is still a violation', () => {
  const res = checkPartition({
    assign: { 'skill:change': 'kernel', 'script:nav-index': 'brownfield' },
    texts: { 'skill:change': 'const nav = require("./nav-index");' },
    names: { script: ['nav-index'] },
  });
  assert.strictEqual(res.violations.length, 1, 'a bare top-level require is never optional');
});

test('a guard elsewhere in the file does not exempt an unguarded require', () => {
  const res = checkPartition({
    assign: { 'skill:change': 'kernel', 'script:nav-index': 'brownfield', 'script:context-pack': 'brownfield' },
    texts: {
      'skill:change':
        'try {\n  require("./context-pack");\n} catch (_) {}\nconst nav = require("./nav-index");',
    },
    names: { script: ['nav-index', 'context-pack'] },
  });
  assert.deepStrictEqual(res.violations.map((v) => v.to), ['script:nav-index'],
    'only the module inside the try block is exempt');
});

test('checkPartition reports a kernel -> pack edge as a violation', () => {
  const res = checkPartition({
    assign: { 'skill:change': 'kernel', 'script:context-pack': 'brownfield' },
    texts: { 'skill:change': 'node .claude/scripts/context-pack.js' },
    names: { script: ['context-pack'] },
  });
  assert.strictEqual(res.violations.length, 1);
  assert.deepStrictEqual(res.violations[0], { from: 'skill:change', to: 'script:context-pack', pack: 'brownfield' });
});

test('checkPartition allows a pack -> kernel edge', () => {
  const res = checkPartition({
    assign: { 'skill:design': 'planning', 'lib:common': 'kernel' },
    texts: { 'skill:design': "require('./lib/common')" },
    names: { lib: ['common'] },
  });
  assert.deepStrictEqual(res.violations, []);
});

test('checkPartition reports a pack -> other-pack edge separately', () => {
  const res = checkPartition({
    assign: { 'skill:design': 'planning', 'script:nav-query': 'brownfield' },
    texts: { 'skill:design': 'node .claude/scripts/nav-query.js pack' },
    names: { script: ['nav-query'] },
  });
  assert.deepStrictEqual(res.violations, [], 'cross-pack is not a kernel violation');
  assert.strictEqual(res.crossPack.length, 1);
});

test('checkPartition ignores self-references', () => {
  const res = checkPartition({
    assign: { 'lib:common': 'kernel' },
    texts: { 'lib:common': "require('./lib/common')" },
    names: { lib: ['common'] },
  });
  assert.deepStrictEqual(res.violations, []);
});

test('checkPartition fails loudly on an empty unit set rather than passing vacuously', () => {
  assert.throws(
    () => checkPartition({ assign: {}, texts: {}, names: {} }),
    /no units/i,
    'an empty partition must error, not report a clean bill of health'
  );
});
