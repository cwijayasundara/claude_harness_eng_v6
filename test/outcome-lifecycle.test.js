'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { buildOutcomeRecord, parseArgs } = require('../.claude/scripts/record-outcome');
const { summarize } = require('../.claude/scripts/outcome-report');

function stateFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-lifecycle-'));
  const state = path.join(root, '.claude', 'state');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'current-run-id'), 'run-1\n');
  fs.writeFileSync(path.join(state, 'current-task'), 'TASK-1\n');
  fs.writeFileSync(path.join(state, 'current-risk-tier'), 'R2\n');
  return state;
}

test('buildOutcomeRecord binds an event to canonical run, task, and risk context', () => {
  const record = buildOutcomeRecord(stateFixture(), {
    kind: 'outcome_confirmed',
    accepted: true,
    productionSurvived: true,
    attentionMinutes: 30,
    modelCostUsd: 4,
    metadata: { source: 'human' },
  }, 1234);
  assert.strictEqual(record.schema_version, 1);
  assert.strictEqual(record.run_id, 'run-1');
  assert.strictEqual(record.task_id, 'TASK-1');
  assert.strictEqual(record.risk_tier, 'R2');
  assert.strictEqual(record.accepted, true);
});

test('buildOutcomeRecord rejects unknown lifecycle kinds', () => {
  assert.throws(
    () => buildOutcomeRecord(stateFixture(), { kind: 'tool_was_busy' }),
    /unknown lifecycle outcome kind/
  );
});

test('record-outcome accepts explicit productivity-study matching metadata', () => {
  const opts = parseArgs([
    '--kind', 'outcome_confirmed', '--study', 'STUDY-1', '--comparison', 'PAIR-1',
    '--cohort', 'agentic', '--work-class', 'feature', '--size-bucket', 'medium',
    '--evidence-reference', 'receipt:TASK-1', '--evidence-hash', 'a'.repeat(64),
  ]);
  assert.deepStrictEqual(opts.metadata, {
    study_id: 'STUDY-1',
    comparison_id: 'PAIR-1',
    cohort: 'agentic',
    work_class: 'feature',
    size_bucket: 'medium',
    evidence_reference: 'receipt:TASK-1',
    evidence_hash: 'a'.repeat(64),
  });
});

test('outcome report measures accepted production-surviving outcomes, not tool activity', () => {
  const records = [
    { schema_version: 1, kind: 'tool', task_id: 'TASK-1' },
    {
      schema_version: 1, kind: 'outcome_confirmed', task_id: 'TASK-1',
      accepted: true, production_survived: true, attention_minutes: 30, model_cost_usd: 4,
    },
    { schema_version: 1, kind: 'outcome_confirmed', task_id: 'TASK-2', accepted: true, attention_minutes: 30 },
    { schema_version: 1, kind: 'reverted', task_id: 'TASK-2' },
    { schema_version: 1, kind: 'gate_completed', task_id: 'TASK-3' },
  ];
  const result = summarize(records);
  assert.strictEqual(result.tasks_observed, 3);
  assert.strictEqual(result.accepted_outcomes, 2);
  assert.strictEqual(result.production_surviving_outcomes, 1);
  assert.strictEqual(result.production_survival_rate, 0.5);
  assert.strictEqual(result.accepted_outcomes_per_attention_hour, 2);
  assert.strictEqual(result.model_cost_per_accepted_outcome, 2);
});
