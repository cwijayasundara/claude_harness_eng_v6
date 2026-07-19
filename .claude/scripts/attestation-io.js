'use strict';

// Filesystem IO for the compliance attestation (Increment 4a) — split out of
// generate-attestation.js so that module stays a thin CLI/orchestrator (SRP +
// length gate). Reads the durable inputs (verify outputs, gate receipt, ratchet
// baselines, standard map), classifies each source fail-safe, and maintains the
// integrity-checksummed index.json. No git and no process control here.

const fs = require('fs');
const path = require('path');
const { canonicalize, sha256Hex } = require('./canonical-json');

const TXT_RATCHETS = {
  coverage: 'coverage-baseline.txt',
  cycle: 'cycle-baseline.txt',
  coupling: 'coupling-baseline.txt',
  duplication: 'duplication-baseline.txt',
  security: 'security-baseline.txt',
};

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

// A .txt baseline: numeric when it parses, raw string otherwise; absent OR empty
// => null (an empty baseline file records no value, not zero).
function readBaselineValue(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : trimmed;
}

function readRatchets(root) {
  const stateDir = path.join(root, '.claude', 'state');
  const out = {};
  for (const [key, file] of Object.entries(TXT_RATCHETS)) {
    out[key] = readBaselineValue(path.join(stateDir, file));
  }
  const budget = readJson(path.join(stateDir, 'control-budget-baseline.json'));
  out.control_budget = budget && Number.isFinite(budget.count) ? budget.count : null;
  return out;
}

// Classify a verify output into a fail-safe source state + the value recorded in
// the bundle. ABSENT => null; PRESENT-but-unparseable or PRESENT-without-a-boolean
// `compliant` => 'invalid' (a corrupt file is never a silent pass); else pass/fail
// on the boolean. The recorded value distinguishes absent (null) from corrupt
// ({invalid:true}) so an auditor can tell "not run" from "ran but broken".
function classifyVerify(file) {
  if (!fs.existsSync(file)) return { state: 'absent', recorded: null };
  const data = readJson(file);
  if (data === null) return { state: 'invalid', recorded: { invalid: true, reason: 'unparseable' } };
  if (typeof data.compliant !== 'boolean') return { state: 'invalid', recorded: data };
  return { state: data.compliant ? 'pass' : 'fail', recorded: data };
}

// Same fail-safe classification for the gate receipt (verdict is `pass`, not
// `compliant`). The quality-card summary is recorded regardless of receipt state.
function classifyGate(root) {
  const receiptFile = path.join(root, '.claude', 'state', 'gate-receipt.json');
  const card = readJson(path.join(root, 'specs', 'reviews', 'quality-card.json'));
  const summary = card && card.summary ? card.summary : null;
  if (!fs.existsSync(receiptFile)) return { state: 'absent', recorded: { pass: null, quality_card_summary: summary } };
  const receipt = readJson(receiptFile);
  if (receipt === null) return { state: 'invalid', recorded: { pass: null, quality_card_summary: summary, invalid: true, reason: 'unparseable' } };
  if (typeof receipt.pass !== 'boolean') return { state: 'invalid', recorded: { pass: null, quality_card_summary: summary } };
  return { state: receipt.pass ? 'pass' : 'fail', recorded: { pass: receipt.pass, quality_card_summary: summary } };
}

// Read the standard-clause map and record WHICH candidate produced it (audit
// provenance): a repo-root / .claude/ override wins over the bundled template
// default; if none is on disk, an empty (all-"unmapped") built-in default.
function readStandardMap(root) {
  const candidates = [
    ['standard-map.json', path.join(root, 'standard-map.json')],
    ['.claude/standard-map.json', path.join(root, '.claude', 'standard-map.json')],
    ['.claude/templates/standard-map.json', path.join(root, '.claude', 'templates', 'standard-map.json')],
  ];
  for (const [label, file] of candidates) {
    const map = readJson(file);
    if (map) return { map, source: label };
  }
  return { map: { id: 'unmapped', by_axis: {}, by_id: {} }, source: 'built-in-default' };
}

function writeBundle(file, bundle) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(bundle, null, 2) + '\n');
}

// Read the integrity-covered index. Shape: { entries:[...], integrity:{algo,hash} }.
// A present index that is malformed OR whose entries no longer match its stored
// hash FAILS LOUDLY (throws) — committed evidence is never silently discarded or
// overwritten. Absent index => a fresh empty list.
function readIndex(indexPath) {
  if (!fs.existsSync(indexPath)) return [];
  const idx = readJson(indexPath);
  if (!idx || !Array.isArray(idx.entries) || !idx.integrity || typeof idx.integrity.hash !== 'string') {
    throw new Error(`attestation index is malformed: ${indexPath} — refusing to overwrite committed evidence`);
  }
  if (sha256Hex(canonicalize(idx.entries)) !== idx.integrity.hash) {
    throw new Error(`attestation index integrity mismatch: ${indexPath} — entries do not match the stored hash (corrupt or tampered)`);
  }
  return idx.entries;
}

// Append one summary entry, deduping by commit_sha (re-adding a SHA is a no-op),
// and re-stamp the index integrity hash over the canonical entries.
function appendIndex(attestDir, root, bundle, file) {
  const indexPath = path.join(attestDir, 'index.json');
  const entries = readIndex(indexPath);
  if (entries.some((e) => e && e.commit_sha === bundle.commit_sha)) return indexPath;
  entries.push({
    commit_sha: bundle.commit_sha,
    generated_at: bundle.generated_at,
    status: bundle.status,
    compliant: bundle.compliant,
    sources_evaluated: bundle.sources_evaluated,
    sources_total: bundle.sources_total,
    path: path.relative(root, file),
  });
  fs.mkdirSync(attestDir, { recursive: true });
  const integrity = { algo: 'sha256', hash: sha256Hex(canonicalize(entries)) };
  fs.writeFileSync(indexPath, JSON.stringify({ entries, integrity }, null, 2) + '\n');
  return indexPath;
}

module.exports = {
  readJson,
  readRatchets,
  classifyVerify,
  classifyGate,
  readStandardMap,
  writeBundle,
  readIndex,
  appendIndex,
};
