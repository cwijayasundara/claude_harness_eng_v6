#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readRecords } = require('./outcome-report');

const CONFIG_REL = '.claude/config/productivity-study.json';
const REPORT_REL = '.claude/evidence/productivity-study.json';

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function seededRandom(seed) {
  let state = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function validateConfig(config) {
  if (!Number.isInteger(config.minimum_pairs) || config.minimum_pairs < 2) {
    throw new Error('minimum_pairs must be an integer >= 2');
  }
  if (!Number.isInteger(config.bootstrap_samples) || config.bootstrap_samples < 100) {
    throw new Error('bootstrap_samples must be an integer >= 100');
  }
  if (!(config.confidence_level > 0.5 && config.confidence_level < 1)) {
    throw new Error('confidence_level must be between 0.5 and 1');
  }
  if (!(config.claim_threshold > 1)) throw new Error('claim_threshold must be greater than 1');
}

function lowerBootstrapBound(values, samples, confidence, seed) {
  if (!values.length) return null;
  const random = seededRandom(seed);
  const estimates = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const draw = Array.from({ length: values.length }, () =>
      values[Math.floor(random() * values.length)]);
    estimates.push(median(draw));
  }
  estimates.sort((a, b) => a - b);
  return estimates[Math.floor(((1 - confidence) / 2) * estimates.length)];
}

function evidenceMatches(root, reference, expectedHash) {
  if (!root || !reference || !/^[a-f0-9]{64}$/i.test(expectedHash || '')) return false;
  const target = path.resolve(root, reference);
  const relative = path.relative(path.resolve(root), target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  try {
    const realRoot = fs.realpathSync(root);
    const realTarget = fs.realpathSync(target);
    const realRelative = path.relative(realRoot, realTarget);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) return false;
    const actual = crypto.createHash('sha256').update(fs.readFileSync(realTarget)).digest('hex');
    return actual === expectedHash.toLowerCase();
  } catch (_) {
    return false;
  }
}

function taskObservations(records, studyId, verifyEvidence = () => false) {
  const tasks = new Map();
  for (const event of records.filter((item) => item && item.task_id)) {
    const task = tasks.get(event.task_id) || { events: [], metadata: {}, attention: 0, rework: 0 };
    task.events.push(event);
    Object.assign(task.metadata, event.metadata || {});
    task.attention += Number(event.attention_minutes) || 0;
    if (event.kind === 'rework_started') task.rework += 1;
    tasks.set(event.task_id, task);
  }
  const observations = [];
  for (const [taskId, task] of tasks) {
    const meta = task.metadata;
    if (meta.study_id !== studyId) continue;
    const started = task.events.filter((event) => event.kind === 'implementation_started')
      .map((event) => Number(event.ts)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    const confirmed = task.events.filter((event) => event.kind === 'outcome_confirmed')
      .sort((a, b) => Number(a.ts) - Number(b.ts)).at(-1);
    const gate = task.events.some((event) =>
      event.kind === 'gate_completed' && ['pass', 'passed'].includes(String(event.metadata?.verdict).toLowerCase()));
    const failures = [];
    for (const field of ['comparison_id', 'cohort', 'work_class', 'size_bucket', 'evidence_reference', 'evidence_hash']) {
      if (!meta[field]) failures.push(`missing-${field}`);
    }
    if (meta.evidence_hash && !/^[a-f0-9]{64}$/i.test(meta.evidence_hash)) failures.push('invalid-evidence-hash');
    if (meta.evidence_reference && meta.evidence_hash && !verifyEvidence(meta.evidence_reference, meta.evidence_hash)) {
      failures.push('evidence-hash-mismatch');
    }
    if (!['baseline', 'agentic'].includes(meta.cohort)) failures.push('invalid-cohort');
    if (!Number.isFinite(started) || !confirmed || !Number.isFinite(Number(confirmed.ts)) || Number(confirmed.ts) <= started) {
      failures.push('invalid-cycle-time');
    }
    if (!(task.attention > 0)) failures.push('missing-attention');
    if (!gate) failures.push('missing-passing-gate');
    if (!confirmed || confirmed.accepted !== true) failures.push('not-accepted');
    if (!confirmed || confirmed.production_survived !== true) failures.push('production-survival-unconfirmed');
    observations.push({
      task_id: taskId,
      comparison_id: meta.comparison_id,
      cohort: meta.cohort,
      risk_tier: confirmed?.risk_tier || task.events.find((event) => event.risk_tier)?.risk_tier,
      work_class: meta.work_class,
      size_bucket: meta.size_bucket,
      evidence_reference: meta.evidence_reference,
      evidence_hash: meta.evidence_hash,
      attention_minutes: task.attention,
      cycle_minutes: Number.isFinite(started) && confirmed ? (Number(confirmed.ts) - started) / 60000 : null,
      rework_events: task.rework,
      eligible: failures.length === 0,
      exclusions: failures,
    });
  }
  return observations;
}

function pairObservations(observations) {
  const groups = new Map();
  for (const observation of observations.filter((item) => item.eligible)) {
    const group = groups.get(observation.comparison_id) || [];
    group.push(observation);
    groups.set(observation.comparison_id, group);
  }
  const pairs = [];
  const exclusions = [];
  for (const [comparisonId, group] of groups) {
    const baseline = group.filter((item) => item.cohort === 'baseline');
    const agentic = group.filter((item) => item.cohort === 'agentic');
    if (baseline.length !== 1 || agentic.length !== 1) {
      exclusions.push({ comparison_id: comparisonId, reason: 'requires-exactly-one-observation-per-cohort' });
      continue;
    }
    const left = baseline[0];
    const right = agentic[0];
    if (['risk_tier', 'work_class', 'size_bucket'].some((field) => left[field] !== right[field])) {
      exclusions.push({ comparison_id: comparisonId, reason: 'matching-dimensions-differ' });
      continue;
    }
    pairs.push({
      comparison_id: comparisonId,
      risk_tier: left.risk_tier,
      work_class: left.work_class,
      size_bucket: left.size_bucket,
      attention_speedup: left.attention_minutes / right.attention_minutes,
      cycle_speedup: left.cycle_minutes / right.cycle_minutes,
      baseline_rework_events: left.rework_events,
      agentic_rework_events: right.rework_events,
      baseline_task_id: left.task_id,
      agentic_task_id: right.task_id,
    });
  }
  return { pairs, exclusions };
}

function analyze(records, studyId, config, options = {}) {
  validateConfig(config);
  const verifyEvidence = options.verifyEvidence || ((reference, hash) =>
    evidenceMatches(options.root, reference, hash));
  const observations = taskObservations(records, studyId, verifyEvidence);
  const paired = pairObservations(observations);
  const attentionRatios = paired.pairs.map((item) => item.attention_speedup);
  const cycleRatios = paired.pairs.map((item) => item.cycle_speedup);
  const attentionMedian = median(attentionRatios);
  const attentionLower = lowerBootstrapBound(
    attentionRatios, config.bootstrap_samples, config.confidence_level, `${studyId}:attention`);
  const sufficient = paired.pairs.length >= config.minimum_pairs;
  const exclusions = [
    ...observations.filter((item) => !item.eligible)
      .map((item) => ({ task_id: item.task_id, reason: item.exclusions.join(',') })),
    ...paired.exclusions,
  ];
  const report = {
    schema_version: 1,
    study_id: studyId,
    generated_at: new Date().toISOString(),
    methodology: 'matched-pair-median-with-deterministic-bootstrap',
    observations,
    pairs: paired.pairs,
    exclusions,
    summary: {
      eligible_pairs: paired.pairs.length,
      minimum_pairs: config.minimum_pairs,
      median_attention_speedup: attentionMedian,
      median_cycle_speedup: median(cycleRatios),
      attention_speedup_lower_confidence_bound: attentionLower,
      confidence_level: config.confidence_level,
      baseline_rework_events: paired.pairs.reduce((sum, item) => sum + item.baseline_rework_events, 0),
      agentic_rework_events: paired.pairs.reduce((sum, item) => sum + item.agentic_rework_events, 0),
      evidence_sufficient: sufficient,
      study_complete: exclusions.length === 0,
      claim_threshold: config.claim_threshold,
      claim_supported: sufficient && exclusions.length === 0 && attentionLower >= config.claim_threshold,
    },
  };
  report.input_hash = crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex');
  report.config_hash = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
  return report;
}

function writeReport(root, report) {
  const target = path.join(root, REPORT_REL);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  return target;
}

function comparableReport(report) {
  if (!report) return null;
  const value = { ...report };
  delete value.generated_at;
  return value;
}

function verifyReport(root) {
  let stored;
  let config;
  try {
    stored = JSON.parse(fs.readFileSync(path.join(root, REPORT_REL), 'utf8'));
    config = JSON.parse(fs.readFileSync(path.join(root, CONFIG_REL), 'utf8'));
  } catch (_) {
    return { pass: false, failures: ['productivity-report-missing-or-invalid'] };
  }
  try {
    const recomputed = analyze(readRecords(root), stored.study_id, config, { root });
    const pass = canonicalizeComparable(stored) === canonicalizeComparable(recomputed);
    return {
      pass,
      failures: pass ? [] : ['productivity-report-live-recomputation-mismatch'],
      report: recomputed,
    };
  } catch (error) {
    return { pass: false, failures: [`productivity-report-verification:${error.message}`] };
  }
}

function canonicalizeComparable(report) {
  const value = comparableReport(report);
  if (Array.isArray(value?.observations)) value.observations = [...value.observations]
    .sort((left, right) => left.task_id.localeCompare(right.task_id));
  if (Array.isArray(value?.pairs)) value.pairs = [...value.pairs]
    .sort((left, right) => left.comparison_id.localeCompare(right.comparison_id));
  return JSON.stringify(value);
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const studyIndex = process.argv.indexOf('--study');
  const studyId = studyIndex === -1 ? null : process.argv[studyIndex + 1];
  if (!studyId) {
    process.stderr.write('usage: productivity-study --study <id>\n');
    process.exitCode = 2;
    return;
  }
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, CONFIG_REL), 'utf8'));
    const report = analyze(readRecords(root), studyId, config, { root });
    const target = writeReport(root, report);
    process.stdout.write(`productivity-study: ${report.summary.claim_supported ? 'CLAIM SUPPORTED' : 'INSUFFICIENT EVIDENCE'} pairs=${report.summary.eligible_pairs} → ${target}\n`);
  } catch (error) {
    process.stderr.write(`productivity-study: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  analyze, comparableReport, evidenceMatches, lowerBootstrapBound, median, pairObservations,
  taskObservations, validateConfig, verifyReport, writeReport,
};

if (require.main === module) main();
