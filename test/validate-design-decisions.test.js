/**
 * The decisions gate for the /design shaping→rendering split.
 *
 * Shares the spine with /spec's gate (a human chose it, the record says so
 * honestly) and adds one rule of its own: a load-bearing architecture decision
 * must say what it RULES OUT.
 *
 * That rule is taken from what the audited design got right. Its §1 table is
 * literally "| Decision | What it rules out |" and §10 is "Design decisions and
 * the alternatives rejected" — the most useful content in 632 KB of output. A
 * decision that forecloses nothing was not a decision; it was a preference, and
 * it will not survive contact with the first implementer who prefers otherwise.
 */
'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { validateDesignDecisions } = require('../.claude/scripts/validate-design-decisions.js');

const decision = (over = {}) => ({
  id: 'D-A',
  question: 'How is engagement isolation enforced?',
  chosen: 'Neo4j Community, one shared database; isolation is the repository contract.',
  rules_out: 'Database-per-engagement provisioning.',
  rationale: 'Provisioning per engagement cannot be operated by one part-time person.',
  basis: 'human',
  load_bearing: true,
  ...over,
});

const doc = (over = {}) => ({
  version: 1,
  phase: 'design',
  source: 'specs/stories/stories.json',
  confirmed_at: '2026-08-05T10:00:00.000Z',
  stack: { backend: 'Python 3.12 / FastAPI', frontend: 'Next.js / TypeScript', datastores: ['Postgres', 'Neo4j'] },
  decisions: [decision()],
  ...over,
});

test('a well-formed, human-confirmed design record passes', () => {
  const res = validateDesignDecisions(doc());
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.ok, true);
});

test('a load-bearing decision that rules nothing out is refused', () => {
  const res = validateDesignDecisions(doc({ decisions: [decision({ rules_out: '' })] }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /rules?[ _]out/i.test(e)));
});

test('a non-load-bearing decision need not rule anything out', () => {
  const res = validateDesignDecisions(doc({
    decisions: [decision(), decision({ id: 'D-B', load_bearing: false, rules_out: '' })],
  }));
  assert.deepStrictEqual(res.errors, []);
});

test('placeholder text does not satisfy rules_out', () => {
  for (const filler of ['n/a', 'N/A', 'none', 'TBD', 'nothing']) {
    const res = validateDesignDecisions(doc({ decisions: [decision({ rules_out: filler })] }));
    assert.strictEqual(res.ok, false, `"${filler}" must not count as a foreclosed alternative`);
  }
});

test('the stack must be named — it governs every later module choice', () => {
  assert.strictEqual(validateDesignDecisions(doc({ stack: {} })).ok, false);
  assert.strictEqual(validateDesignDecisions(doc({ stack: undefined })).ok, false);
});

test('the shared spine still applies: a model-authored record is refused', () => {
  const res = validateDesignDecisions(doc({
    decisions: [decision({ basis: 'default-accepted' })],
  }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /human/i.test(e)));
});

test('headless waives the human rule but never the design-specific ones', () => {
  const headless = doc({ decisions: [decision({ basis: 'headless-default' })] });
  assert.strictEqual(validateDesignDecisions(headless, { lane: '--auto' }).ok, true);

  const noRulesOut = doc({ decisions: [decision({ basis: 'headless-default', rules_out: '' })] });
  const res = validateDesignDecisions(noRulesOut, { lane: '--auto' });
  assert.strictEqual(res.ok, false, 'rules_out is a structural rule, not a human-shaping one');
});

test('a claimed headless lane is refused when the session lane disagrees', () => {
  const res = validateDesignDecisions(
    doc({ decisions: [decision({ basis: 'headless-default' })] }),
    { lane: '--auto', sessionLane: 'design' },
  );
  assert.strictEqual(res.ok, false);
});

test('a spec decisions file is refused by the design gate', () => {
  assert.strictEqual(validateDesignDecisions(doc({ phase: 'spec' })).ok, false);
});
