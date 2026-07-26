#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { defaultBudget, parseBudgetSpec } = require('./budget-state');
const { ENVELOPE_REL, loadEnvelope, stampEnvelope } = require('../hooks/lib/task-envelope');
const { appendEvent, lifecycleStatus } = require('../hooks/lib/task-lifecycle');
const { consumeCapability, findCapability } = require('../hooks/lib/authority-receipt');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function parseArgs(argv) {
  const opts = { allow: [], budget: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === 'create' || arg === 'verify' || arg === 'amend') opts.command = arg;
    else if (arg === '--task') opts.taskId = argv[++i];
    else if (arg === '--intent') opts.intent = argv[++i];
    else if (arg === '--intent-file') opts.intentFile = argv[++i];
    else if (arg === '--allow') opts.allow.push(argv[++i]);
    else if (arg === '--budget') opts.budget.push(argv[++i]);
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--expires-minutes') opts.expiresMinutes = Number(argv[++i]);
  }
  return opts;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (err) {
    try { fs.unlinkSync(temp); } catch (_) { /* best effort */ }
    throw err;
  }
}

function resolveIntent(opts) {
  if (opts.intentFile) return fs.readFileSync(opts.intentFile, 'utf8');
  return opts.intent || '';
}

function budgetConfig(specs, tier) {
  if (!specs.length) return defaultBudget(tier === 'R0' ? 'cost' : tier === 'R1' ? 'balanced' : 'max-quality');
  const dimensions = specs.map(parseBudgetSpec);
  if (dimensions.some((d) => !d)) throw new Error('every --budget must be a time, agents, or USD cap');
  return { warn_at_pct: 80, dimensions };
}

function buildEnvelope({ risk, intent, allowedPaths, budgets, now = new Date(), expiresMinutes = 480 }) {
  if (!risk || !/^R[0-4]$/.test(risk.tier || '')) throw new Error('valid risk envelope is required');
  const paths = [...new Set([...(allowedPaths || []), ...(risk.allowed_paths || [])])].filter(Boolean);
  if (!paths.length) throw new Error('at least one --allow path is required when risk envelope has no paths');
  return stampEnvelope({
    schema_version: 2,
    version: 1,
    task_id: risk.task_id,
    risk_tier: risk.tier,
    intent_hash: sha256(intent),
    risk_envelope_hash: sha256(JSON.stringify(risk)),
    allowed_paths: paths,
    forbidden_actions: [...new Set(risk.forbidden_actions || [])],
    required_evidence: [...new Set(risk.required_evidence || [])],
    required_approvals: risk.required_approvals || 0,
    budgets,
    stopping_conditions: ['required_evidence_present', 'gate_pass', 'no_block_findings'],
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + expiresMinutes * 60_000).toISOString(),
    previous_envelope_hash: null,
    amendments: [],
  });
}

function create(root, opts) {
  const current = loadEnvelope(root);
  if (current.state === 'invalid') throw new Error(`current task envelope is invalid: ${current.errors.join('; ')}`);
  if (current.state === 'valid') {
    const lifecycle = lifecycleStatus(root, current.envelope);
    if (!['completed', 'aborted'].includes(lifecycle.state)) {
      throw new Error(`current task ${current.envelope.task_id} is ${lifecycle.state}; complete or abort it before rotation`);
    }
    const archive = path.join(root, '.claude', 'state', 'task-envelope-history', `${current.envelope.integrity.hash}.json`);
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(archive, `${JSON.stringify(current.envelope, null, 2)}\n`);
  }
  const riskFile = path.join(root, '.claude', 'state', 'risk-envelope.json');
  if (!fs.existsSync(riskFile)) throw new Error('risk-envelope.json is missing; classify risk first');
  const risk = readJson(riskFile);
  if (opts.taskId && opts.taskId !== risk.task_id) throw new Error('task id does not match risk envelope');
  const envelope = buildEnvelope({
    risk,
    intent: resolveIntent(opts),
    allowedPaths: opts.allow,
    budgets: budgetConfig(opts.budget, risk.tier),
    expiresMinutes: opts.expiresMinutes || 480,
  });
  const out = opts.out || path.join(root, ENVELOPE_REL);
  if (out === path.join(root, ENVELOPE_REL)) appendEvent(root, envelope, 'created');
  writeJsonAtomic(out, envelope);
  return { envelope, out };
}

function amend(root, opts, now = new Date()) {
  const loaded = loadEnvelope(root);
  if (loaded.state !== 'valid') throw new Error(`task envelope is ${loaded.state}`);
  const status = lifecycleStatus(root, loaded.envelope, now);
  if (status.state !== 'active') throw new Error(`task lifecycle is ${status.state}, expected active`);
  const authority = findCapability(root, loaded.envelope, 'amend_task', now);
  if (!authority.valid) throw new Error(authority.errors.join('; '));
  const consumed = consumeCapability(root, authority.receipt, 'amend_task', now);
  if (!consumed.consumed) throw new Error(consumed.error);
  appendEvent(root, loaded.envelope, 'amended', {
    authorization_receipt_id: authority.receipt.receipt_id,
  }, now);
  const envelope = stampEnvelope({
    ...loaded.envelope,
    version: (loaded.envelope.version || 1) + 1,
    allowed_paths: [...new Set([...loaded.envelope.allowed_paths, ...opts.allow])],
    expires_at: opts.expiresMinutes
      ? new Date(now.getTime() + opts.expiresMinutes * 60_000).toISOString()
      : loaded.envelope.expires_at,
    previous_envelope_hash: loaded.envelope.integrity.hash,
    amendments: [...(loaded.envelope.amendments || []), {
      at: now.toISOString(), authorization_receipt_id: authority.receipt.receipt_id,
      added_paths: opts.allow,
    }],
    integrity: undefined,
  });
  writeJsonAtomic(path.join(root, ENVELOPE_REL), envelope);
  appendEvent(root, envelope, 'active', { reason: 'authorized amendment applied' }, now);
  return envelope;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    if (opts.command === 'verify') {
      const loaded = loadEnvelope(root);
      if (loaded.state !== 'valid') throw new Error(`${loaded.state}: ${loaded.errors.join('; ')}`);
      process.stdout.write(`task-envelope: VALID task=${loaded.envelope.task_id} tier=${loaded.envelope.risk_tier}\n`);
      return;
    }
    if (opts.command === 'amend') {
      const envelope = amend(root, opts);
      process.stdout.write(`task-envelope: AMENDED task=${envelope.task_id} version=${envelope.version}\n`);
      return;
    }
    if (opts.command !== 'create') throw new Error('usage: task-envelope.js create|verify [options]');
    const { envelope, out } = create(root, opts);
    process.stdout.write(`task-envelope: CREATED ${out} task=${envelope.task_id} tier=${envelope.risk_tier}\n`);
  } catch (err) {
    process.stderr.write(`task-envelope: ${err.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { amend, budgetConfig, buildEnvelope, create, parseArgs, sha256, writeJsonAtomic };

if (require.main === module) main();
