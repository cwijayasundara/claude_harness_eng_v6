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

// A hard reference is one that would BREAK if the target were absent. The harness is
// full of references that merely mention a pack unit — remediation strings, doc
// cross-references, prose descriptions. Those go stale, they do not crash.
test('a code unit naming a script inside a remediation string is soft', () => {
  const refs = hardRefs(
    'fix: `re-negotiate the contract (node .claude/scripts/validate-contract.js x).`',
    { script: ['validate-contract'] }, new Set(), 'lib'
  );
  assert.deepStrictEqual(refs, [], 'a path in a message is inert if the pack is gone');
});

test('a code unit requiring the same script IS hard', () => {
  const refs = hardRefs("const v = require('../scripts/validate-contract');",
    { script: ['validate-contract'] }, new Set(), 'lib');
  assert.deepStrictEqual(refs, ['script:validate-contract']);
});

test('a prose unit invoking a script with node IS hard', () => {
  const refs = hardRefs('2. **Quality card:** `node .claude/scripts/quality-card.js --range <r>`',
    { script: ['quality-card'] }, new Set(), 'skill');
  assert.deepStrictEqual(refs, ['script:quality-card'], 'for a skill, a command line is the invocation');
});

test('a doc cross-reference to another skill is soft', () => {
  const refs = hardRefs('see `.claude/skills/test/references/test-design.md` for the boundary triples',
    { skill: ['test'] }, new Set(), 'skill');
  assert.deepStrictEqual(refs, [], 'a link to SKILL.md/references is documentation, not execution');
});

test('executing a script inside another skill IS hard', () => {
  const refs = hardRefs('node .claude/skills/code-map/scripts/code_wiki.js query --callers x',
    { skill: ['code-map'] }, new Set(), 'skill');
  assert.deepStrictEqual(refs, ['skill:code-map']);
});

test('an agent named in prose near "subagent_type" is soft', () => {
  const refs = hardRefs(
    'Implementation worker spawned by the generator (lead). Use as the subagent_type when the generator fans out one teammate per story.',
    { agent: ['generator'] }, new Set(), 'agent'
  );
  assert.deepStrictEqual(refs, [], 'a description is not a dispatch');
});

test('an actual subagent dispatch IS hard', () => {
  const refs = hardRefs('Agent(subagent_type=generator)', { agent: ['generator'] }, new Set(), 'skill');
  assert.deepStrictEqual(refs, ['agent:generator']);
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

// These use a CODE unit (lib) as the caller: require() semantics only apply there.
// A skill is prose, so its hard form is a `node ...` command line, not a require.
test('an UNGUARDED require of the same module is still a violation', () => {
  const res = checkPartition({
    assign: { 'lib:common': 'kernel', 'script:nav-index': 'brownfield' },
    texts: { 'lib:common': 'const nav = require("../scripts/nav-index");' },
    names: { script: ['nav-index'] },
  });
  assert.strictEqual(res.violations.length, 1, 'a bare top-level require is never optional');
});

test('a guard elsewhere in the file does not exempt an unguarded require', () => {
  const res = checkPartition({
    assign: { 'lib:common': 'kernel', 'script:nav-index': 'brownfield', 'script:context-pack': 'brownfield' },
    texts: {
      'lib:common':
        'try {\n  require("../scripts/context-pack");\n} catch (_) {}\nconst nav = require("../scripts/nav-index");',
    },
    names: { script: ['nav-index', 'context-pack'] },
  });
  assert.deepStrictEqual(res.violations.map((v) => v.to), ['script:nav-index'],
    'only the module inside the try block is exempt');
});

// A justified exception must be a decision on the record, not an erosion of the rule.
const ACCEPT_FIXTURE = {
  assign: { 'skill:refactor': 'kernel', 'skill:code-map': 'brownfield' },
  texts: { 'skill:refactor': 'node .claude/skills/code-map/scripts/code_wiki.js query --callers x' },
  names: { skill: ['code-map'] },
};

test('an accepted edge is not a violation but is still reported', () => {
  const res = checkPartition({
    ...ACCEPT_FIXTURE,
    accepted: [{ from: 'skill:refactor', to: 'skill:code-map', why: 'conditional on the code graph' }],
  });
  assert.deepStrictEqual(res.violations, []);
  assert.strictEqual(res.accepted.length, 1, 'an exception must stay visible, never silently dropped');
  assert.match(res.accepted[0].why, /conditional/);
});

test('an accepted entry without a reason is rejected', () => {
  assert.throws(
    () => checkPartition({ ...ACCEPT_FIXTURE, accepted: [{ from: 'a', to: 'b' }] }),
    /needs from, to and why/,
    'an unexplained exception is indistinguishable from a silent waiver'
  );
});

test('an accepted entry that no longer matches a real edge is reported stale', () => {
  const res = checkPartition({
    ...ACCEPT_FIXTURE,
    accepted: [
      { from: 'skill:refactor', to: 'skill:code-map', why: 'real' },
      { from: 'skill:vibe', to: 'script:gone', why: 'long since fixed' },
    ],
  });
  assert.deepStrictEqual(res.staleAccepted, ['skill:vibe -> script:gone'],
    'the allowlist must not outlive the coupling it excused');
});

test('an accepted edge does not exempt a DIFFERENT edge', () => {
  const res = checkPartition({
    assign: { 'lib:common': 'kernel', 'script:a': 'brownfield', 'script:b': 'brownfield' },
    texts: { 'lib:common': "require('../scripts/a'); require('../scripts/b');" },
    names: { script: ['a', 'b'] },
    accepted: [{ from: 'lib:common', to: 'script:a', why: 'justified' }],
  });
  assert.deepStrictEqual(res.violations.map((v) => v.to), ['script:b']);
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
