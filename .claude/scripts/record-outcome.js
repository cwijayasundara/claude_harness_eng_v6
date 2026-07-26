#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { contextFields } = require('../hooks/lib/run-context');

const OUTCOME_KINDS = new Set([
  'intent_approved', 'implementation_started', 'gate_completed', 'pr_opened',
  'merged', 'deployed', 'outcome_confirmed', 'rework_started', 'reverted',
  'incident_linked',
]);

function parseArgs(argv) {
  const opts = { metadata: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--kind') opts.kind = argv[++i];
    else if (arg === '--task') opts.taskId = argv[++i];
    else if (arg === '--reference') opts.reference = argv[++i];
    else if (arg === '--attention-minutes') opts.attentionMinutes = Number(argv[++i]);
    else if (arg === '--model-cost-usd') opts.modelCostUsd = Number(argv[++i]);
    else if (arg === '--accepted') opts.accepted = argv[++i] === 'true';
    else if (arg === '--production-survived') opts.productionSurvived = argv[++i] === 'true';
    else if (arg === '--study') opts.metadata.study_id = argv[++i];
    else if (arg === '--comparison') opts.metadata.comparison_id = argv[++i];
    else if (arg === '--cohort') opts.metadata.cohort = argv[++i];
    else if (arg === '--work-class') opts.metadata.work_class = argv[++i];
    else if (arg === '--size-bucket') opts.metadata.size_bucket = argv[++i];
    else if (arg === '--evidence-reference') opts.metadata.evidence_reference = argv[++i];
    else if (arg === '--evidence-hash') opts.metadata.evidence_hash = argv[++i];
    else if (arg === '--meta') {
      const [key, ...rest] = String(argv[++i] || '').split('=');
      if (key && rest.length) opts.metadata[key] = rest.join('=');
    }
  }
  return opts;
}

function buildOutcomeRecord(stateDir, opts, now = Date.now()) {
  if (!OUTCOME_KINDS.has(opts.kind)) throw new Error(`unknown lifecycle outcome kind: ${opts.kind || '(missing)'}`);
  const context = contextFields(stateDir, null);
  const record = {
    schema_version: 1,
    kind: opts.kind,
    ts: now,
    ...context,
    task_id: opts.taskId || context.task_id,
    reference: opts.reference || null,
    metadata: opts.metadata || {},
  };
  if (Number.isFinite(opts.attentionMinutes)) record.attention_minutes = opts.attentionMinutes;
  if (Number.isFinite(opts.modelCostUsd)) record.model_cost_usd = opts.modelCostUsd;
  if (typeof opts.accepted === 'boolean') record.accepted = opts.accepted;
  if (typeof opts.productionSurvived === 'boolean') record.production_survived = opts.productionSurvived;
  return record;
}

function appendRecord(root, record) {
  const dir = path.join(root, '.claude', 'runs');
  fs.mkdirSync(dir, { recursive: true });
  const date = new Date(record.ts).toISOString().slice(0, 10);
  const file = path.join(dir, `${date}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  return file;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    const record = buildOutcomeRecord(path.join(root, '.claude', 'state'), opts);
    appendRecord(root, record);
    process.stdout.write(`record-outcome: ${record.kind} task=${record.task_id} run=${record.run_id}\n`);
  } catch (err) {
    process.stderr.write(`record-outcome: ${err.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { OUTCOME_KINDS, appendRecord, buildOutcomeRecord, parseArgs };

if (require.main === module) main();
