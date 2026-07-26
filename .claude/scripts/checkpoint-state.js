#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { canonicalize, loadEnvelope } = require('../hooks/lib/task-envelope');
const { lifecycleStatus } = require('../hooks/lib/task-lifecycle');
const { computeBudget, gatherSpend } = require('./budget-state');

const SNAPSHOT_PATHS = [
  'claude-progress.txt',
  'features.json',
  '.claude/state/task-envelope.json',
  '.claude/state/task-lifecycle.jsonl',
  '.claude/state/budget-start',
];

function hashValue(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function hashFile(root, rel) {
  const file = path.join(root, rel);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? hashValue(fs.readFileSync(file)) : null;
}
function checkpointHash(checkpoint) {
  const body = { ...checkpoint };
  delete body.checkpoint_hash;
  return hashValue(canonicalize(body));
}
function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (_) { return null; }
}
function atomicWrite(file, text, io = fs) {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  io.mkdirSync(path.dirname(file), { recursive: true });
  try {
    io.writeFileSync(temp, text, { mode: 0o600 });
    io.renameSync(temp, file);
  } catch (err) {
    try { io.unlinkSync(temp); } catch (_) { /* best effort */ }
    throw err;
  }
}
function checkpointFiles(root) {
  const dir = path.join(root, '.claude', 'state', 'checkpoints');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /^\d{6}\.json$/.test(name)).sort()
    .map((name) => path.join(dir, name));
}
function loadCheckpoints(root) {
  const checkpoints = [];
  const errors = [];
  for (const [index, file] of checkpointFiles(root).entries()) {
    try {
      const checkpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
      const previous = checkpoints[index - 1];
      if (checkpoint.sequence !== index + 1) errors.push(`sequence mismatch at ${index + 1}`);
      if (checkpoint.previous_checkpoint_hash !== (previous ? previous.checkpoint_hash : null)) errors.push(`chain mismatch at ${index + 1}`);
      if (checkpoint.checkpoint_hash !== checkpointHash(checkpoint)) errors.push(`hash mismatch at ${index + 1}`);
      checkpoints.push(checkpoint);
    } catch (err) { errors.push(`unreadable checkpoint ${index + 1}: ${err.message}`); }
  }
  return { checkpoints, errors };
}

function currentBudget(root, envelope, nowMs = Date.now()) {
  const start = Number(fs.existsSync(path.join(root, '.claude', 'state', 'budget-start'))
    ? fs.readFileSync(path.join(root, '.claude', 'state', 'budget-start'), 'utf8').trim() : 0) || null;
  const runs = path.join(root, '.claude', 'runs');
  let receipts = [];
  try {
    receipts = fs.readdirSync(runs).filter((name) => name.endsWith('.jsonl')).flatMap((name) =>
      fs.readFileSync(path.join(runs, name), 'utf8').split('\n').filter(Boolean)
        .flatMap((line) => { try { return [JSON.parse(line)]; } catch (_) { return []; } }));
  } catch (_) { receipts = []; }
  return computeBudget(gatherSpend(receipts, start, nowMs, 'balanced'), envelope.budgets);
}

function createCheckpoint(root, details = {}, now = new Date(), io = fs) {
  const chain = loadCheckpoints(root);
  if (chain.errors.length) throw new Error(chain.errors.join('; '));
  const previous = chain.checkpoints[chain.checkpoints.length - 1] || null;
  const checkpoint = {
    schema_version: 1, sequence: chain.checkpoints.length + 1,
    checkpoint_id: crypto.randomUUID(), created_at: now.toISOString(),
    previous_checkpoint_hash: previous ? previous.checkpoint_hash : null,
    git_head: git(root, ['rev-parse', 'HEAD']),
    git_status: git(root, ['status', '--porcelain=v1']) || '',
    artifacts: Object.fromEntries(SNAPSHOT_PATHS.map((rel) => [rel, hashFile(root, rel)])),
    next_action: details.nextAction || null,
    current_group: details.currentGroup || null,
    reason: details.reason || 'iteration-boundary',
  };
  checkpoint.checkpoint_hash = checkpointHash(checkpoint);
  const dir = path.join(root, '.claude', 'state', 'checkpoints');
  const file = path.join(dir, `${String(checkpoint.sequence).padStart(6, '0')}.json`);
  atomicWrite(file, `${JSON.stringify(checkpoint, null, 2)}\n`, io);
  atomicWrite(path.join(root, '.claude', 'state', 'current-checkpoint.json'), `${JSON.stringify(checkpoint, null, 2)}\n`, io);
  return { checkpoint, file };
}

function resumeDecision(root, nowMs = Date.now()) {
  const chain = loadCheckpoints(root);
  if (chain.errors.length) return { state: 'blocked_corrupt_checkpoint', failures: chain.errors };
  const checkpoint = chain.checkpoints[chain.checkpoints.length - 1];
  if (!checkpoint) return { state: 'fresh_start', checkpoint: null };
  const loaded = loadEnvelope(root);
  if (loaded.state !== 'valid') return { state: 'blocked_task_contract', failures: [`task-envelope:${loaded.state}`] };
  const lifecycle = lifecycleStatus(root, loaded.envelope);
  if (!lifecycle.allowed) return { state: `blocked_task_${lifecycle.state}`, failures: lifecycle.errors };
  const budget = currentBudget(root, loaded.envelope, nowMs);
  if (budget && budget.exhausted) return { state: 'blocked_budget_exhausted', budget };
  const changedArtifacts = Object.entries(checkpoint.artifacts)
    .filter(([rel, digest]) => hashFile(root, rel) !== digest).map(([rel]) => rel);
  const head = git(root, ['rev-parse', 'HEAD']);
  const status = git(root, ['status', '--porcelain=v1']) || '';
  if (head !== checkpoint.git_head) {
    return { state: 'diverged_after_checkpoint', checkpoint, head, changed_artifacts: changedArtifacts };
  }
  if (status !== checkpoint.git_status || changedArtifacts.length) {
    return { state: 'repair_partial_iteration', checkpoint, changed_artifacts: changedArtifacts };
  }
  return { state: 'resume_exact', checkpoint, next_action: checkpoint.next_action };
}

function main() {
  const argv = process.argv.slice(2);
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    if (argv[0] === 'create') {
      const option = (name) => {
        const index = argv.indexOf(name);
        return index === -1 ? null : argv[index + 1];
      };
      const result = createCheckpoint(root, {
        nextAction: option('--next'),
        currentGroup: option('--group'),
        reason: option('--reason'),
      });
      process.stdout.write(`checkpoint: CREATED ${result.checkpoint.checkpoint_id} seq=${result.checkpoint.sequence}\n`);
      return;
    }
    if (argv[0] === 'resume') {
      const result = resumeDecision(root);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.state.startsWith('blocked_')) process.exitCode = 1;
      return;
    }
    if (argv[0] === 'verify') {
      const result = loadCheckpoints(root);
      if (result.errors.length) throw new Error(result.errors.join('; '));
      process.stdout.write(`checkpoint: VALID count=${result.checkpoints.length}\n`);
      return;
    }
    throw new Error('usage: checkpoint-state.js create|resume|verify');
  } catch (err) {
    process.stderr.write(`checkpoint: ${err.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  SNAPSHOT_PATHS, atomicWrite, checkpointHash, createCheckpoint, loadCheckpoints, resumeDecision,
  currentBudget,
};
if (require.main === module) main();
