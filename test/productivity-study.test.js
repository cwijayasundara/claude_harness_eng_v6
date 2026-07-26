'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const {
  analyze, evidenceMatches, pairObservations, taskObservations, validateConfig,
  verifyReport, writeReport,
} = require('../.claude/scripts/productivity-study');

const CONFIG = {
  minimum_pairs: 3,
  bootstrap_samples: 500,
  confidence_level: 0.95,
  claim_threshold: 8,
};

function events(pair, cohort, attention, cycle, overrides = {}) {
  const task = `${pair}-${cohort}`;
  const metadata = {
    study_id: 'STUDY-1', comparison_id: pair, cohort,
    work_class: 'feature', size_bucket: 'medium',
    evidence_reference: `receipt:${task}`,
    evidence_hash: 'a'.repeat(64),
    ...overrides.metadata,
  };
  return [
    { schema_version: 1, kind: 'implementation_started', task_id: task, risk_tier: 'R2', ts: 0, metadata },
    { schema_version: 1, kind: 'gate_completed', task_id: task, risk_tier: 'R2', ts: cycle - 1, metadata: { verdict: 'pass' } },
    {
      schema_version: 1, kind: 'outcome_confirmed', task_id: task, risk_tier: overrides.risk_tier || 'R2',
      ts: cycle, attention_minutes: attention, accepted: true, production_survived: true, metadata,
    },
  ];
}

test('matched accepted and surviving outcomes support a claim only above the confidence threshold', () => {
  const records = [];
  for (const pair of ['A', 'B', 'C']) {
    records.push(...events(pair, 'baseline', 90, 600000));
    records.push(...events(pair, 'agentic', 10, 100000));
  }
  const report = analyze(records, 'STUDY-1', CONFIG, { verifyEvidence: () => true });
  assert.strictEqual(report.summary.eligible_pairs, 3);
  assert.strictEqual(report.summary.median_attention_speedup, 9);
  assert.strictEqual(report.summary.claim_supported, true);
});

test('small samples remain insufficient even when the observed multiplier is large', () => {
  const records = [
    ...events('A', 'baseline', 100, 600000),
    ...events('A', 'agentic', 5, 60000),
  ];
  const report = analyze(records, 'STUDY-1', CONFIG, { verifyEvidence: () => true });
  assert.strictEqual(report.summary.evidence_sufficient, false);
  assert.strictEqual(report.summary.claim_supported, false);
});

test('missing gates, attention, survival, or evidence are excluded rather than counted as wins', () => {
  const records = events('A', 'agentic', 10, 100000, { metadata: { evidence_reference: '' } });
  records.splice(1, 1);
  records.at(-1).production_survived = false;
  records.at(-1).attention_minutes = 0;
  const observations = taskObservations(records, 'STUDY-1', () => true);
  assert.strictEqual(observations[0].eligible, false);
  assert.ok(observations[0].exclusions.includes('missing-passing-gate'));
  assert.ok(observations[0].exclusions.includes('missing-attention'));
  assert.ok(observations[0].exclusions.includes('production-survival-unconfirmed'));
  assert.ok(observations[0].exclusions.includes('missing-evidence_reference'));
});

test('pairs fail closed when matching dimensions differ or cohorts are duplicated', () => {
  const mismatched = [
    ...events('A', 'baseline', 90, 600000),
    ...events('A', 'agentic', 10, 100000, { risk_tier: 'R3' }),
  ];
  const duplicate = events('B', 'baseline', 90, 600000);
  duplicate.forEach((event) => { event.task_id = 'B-baseline-2'; });
  const observations = taskObservations([
    ...mismatched,
    ...events('B', 'baseline', 90, 600000),
    ...duplicate,
    ...events('B', 'agentic', 10, 100000),
  ], 'STUDY-1', () => true);
  const result = pairObservations(observations);
  assert.strictEqual(result.pairs.length, 0);
  assert.strictEqual(result.exclusions.length, 2);
});

test('evidence verification binds project-local bytes and rejects traversal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'productivity-evidence-'));
  const receipt = path.join(root, 'receipt.json');
  fs.writeFileSync(receipt, '{"pass":true}\n');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(receipt)).digest('hex');
  assert.strictEqual(evidenceMatches(root, 'receipt.json', hash), true);
  assert.strictEqual(evidenceMatches(root, 'receipt.json', 'b'.repeat(64)), false);
  assert.strictEqual(evidenceMatches(root, '../receipt.json', hash), false);
});

test('any excluded study observation prevents a positive claim', () => {
  const records = [];
  for (const pair of ['A', 'B', 'C']) {
    records.push(...events(pair, 'baseline', 90, 600000));
    records.push(...events(pair, 'agentic', 10, 100000));
  }
  const failed = events('D', 'agentic', 10, 100000);
  failed.at(-1).accepted = false;
  records.push(...failed);
  const report = analyze(records, 'STUDY-1', CONFIG, { verifyEvidence: () => true });
  assert.strictEqual(report.summary.eligible_pairs, 3);
  assert.strictEqual(report.summary.study_complete, false);
  assert.strictEqual(report.summary.claim_supported, false);
});

test('invalid statistical configuration fails closed', () => {
  assert.throws(
    () => validateConfig({ ...CONFIG, minimum_pairs: 1 }),
    /minimum_pairs/
  );
  assert.throws(
    () => validateConfig({ ...CONFIG, confidence_level: 1 }),
    /confidence_level/
  );
});

test('stored reports are live-recomputed and tampering is rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'productivity-report-'));
  fs.mkdirSync(path.join(root, '.claude', 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'runs'), { recursive: true });
  const config = { ...CONFIG, minimum_pairs: 2 };
  fs.writeFileSync(
    path.join(root, '.claude', 'config', 'productivity-study.json'),
    JSON.stringify(config)
  );
  const receipt = path.join(root, 'receipt.json');
  fs.writeFileSync(receipt, '{"pass":true}\n');
  const receiptHash = crypto.createHash('sha256').update(fs.readFileSync(receipt)).digest('hex');
  const records = [];
  for (const pair of ['A', 'B']) {
    records.push(...events(pair, 'baseline', 90, 600000));
    records.push(...events(pair, 'agentic', 10, 100000));
  }
  for (const event of records) {
    event.metadata.evidence_reference = 'receipt.json';
    event.metadata.evidence_hash = receiptHash;
  }
  fs.writeFileSync(
    path.join(root, '.claude', 'runs', '2026-07-26.jsonl'),
    `${records.map(JSON.stringify).join('\n')}\n`
  );
  writeReport(root, analyze(records, 'STUDY-1', config, { root }));
  assert.strictEqual(verifyReport(root).pass, true);
  const reportFile = path.join(root, '.claude', 'evidence', 'productivity-study.json');
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  report.summary.median_attention_speedup = 80;
  fs.writeFileSync(reportFile, JSON.stringify(report));
  assert.strictEqual(verifyReport(root).pass, false);
});
