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

// --- the render checkpoint ----------------------------------------------------
//
// Same control as /spec's, on the same reasoning: once this gate passes,
// design-decisions.json IS the state, and Step 0.9 §3 onward (dispatch the
// renderer, the grounding/canvas/vocabulary gates, the evaluator) reads the file
// rather than the architecture dialogue that produced it. /design was excluded
// from the first cut only because it had no `--render-only` to re-enter with.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'validate-design-decisions.js');

function designRoot(sessionId, docOver = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-decisions-'));
  fs.mkdirSync(path.join(dir, 'specs/decisions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs/decisions/design-decisions.json'),
    JSON.stringify(doc(docOver), null, 2));
  fs.mkdirSync(path.join(dir, '.claude/runs'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude/runs/2026-08-10.jsonl'),
    `${JSON.stringify({ kind: 'tool', session_id: sessionId })}\n`);
  return dir;
}

const gate = (dir, extra = []) =>
  execFileSync('node', [SCRIPT, '--root', dir, ...extra], { encoding: 'utf8' });

const verdictOf = (dir) => JSON.parse(
  fs.readFileSync(path.join(dir, 'specs/reviews/design-decisions-verdict.json'), 'utf8'),
);

test('the shaping session is stamped into the design verdict', () => {
  const dir = designRoot('SESSION-A');
  gate(dir);
  assert.strictEqual(verdictOf(dir).session_id, 'SESSION-A');
  assert.strictEqual(verdictOf(dir).in_session, false);
});

test('passing the gate prints the clear-and-render-only checkpoint', () => {
  const out = gate(designRoot('SESSION-A'));
  assert.match(out, /OK/);
  assert.match(out, /\/clear/);
  assert.match(out, /\/design --render-only/);
  assert.match(out, /design-decisions\.json/);
});

test('--in-session suppresses the checkpoint and records why', () => {
  const dir = designRoot('SESSION-A');
  const out = gate(dir, ['--in-session']);
  assert.doesNotMatch(out, /\/clear/);
  assert.strictEqual(verdictOf(dir).in_session, true);
});

test('a waived headless lane gets no checkpoint', () => {
  const dir = designRoot('SESSION-A', {
    decisions: [decision({ basis: 'headless-default' })],
  });
  const out = gate(dir, ['--lane', '--autonomous']);
  assert.match(out, /waived/);
  assert.doesNotMatch(out, /\/clear/);
});

// The bug that shipped in the /spec version and was caught pre-merge:
// design-render re-runs this gate at its own Step 0, and restamping there would
// block the very session the clear just created.
test('design-render re-running the gate does not claim to have shaped the decisions', () => {
  const dir = designRoot('SESSION-SHAPING');
  gate(dir);
  fs.appendFileSync(path.join(dir, '.claude/runs/2026-08-10.jsonl'),
    `${JSON.stringify({ kind: 'tool', session_id: 'SESSION-FRESH' })}\n`);
  gate(dir);
  assert.strictEqual(verdictOf(dir).session_id, 'SESSION-SHAPING');
});

test('changed design decisions re-stamp — a new shaping dialogue happened', () => {
  const dir = designRoot('SESSION-SHAPING');
  gate(dir);
  fs.appendFileSync(path.join(dir, '.claude/runs/2026-08-10.jsonl'),
    `${JSON.stringify({ kind: 'tool', session_id: 'SESSION-SECOND' })}\n`);
  const file = path.join(dir, 'specs/decisions/design-decisions.json');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  d.decisions.push(decision({ id: 'D-B', question: 'Resolve the unresolved call?' }));
  fs.writeFileSync(file, JSON.stringify(d, null, 2));
  gate(dir);
  assert.strictEqual(verdictOf(dir).session_id, 'SESSION-SECOND');
});

test('a failing gate prints no checkpoint — there is nothing durable yet', () => {
  const dir = designRoot('SESSION-A', { decisions: [] });
  assert.throws(() => gate(dir), (err) => {
    assert.doesNotMatch(String(err.stdout || ''), /\/clear/);
    return err.status === 1;
  });
});
