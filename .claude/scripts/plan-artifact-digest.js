'use strict';

// Shared sha256 for plan-approval + plan-seal so evaluator live fields on
// features.json do not void a human receipt or the coding-loop seal.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FEATURES_LIVE_FIELDS = Object.freeze([
  'passes', 'last_evaluated', 'failure_reason', 'failure_layer',
]);

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = stableJson(value[k]);
    return out;
  }
  return value;
}

function featuresIdentityBytes(buf) {
  let parsed;
  try { parsed = JSON.parse(buf.toString('utf8')); } catch (_) { return buf; }
  if (!Array.isArray(parsed)) return buf;
  const live = new Set(FEATURES_LIVE_FIELDS);
  const identity = parsed.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const kept = {};
    for (const k of Object.keys(row).sort()) {
      if (!live.has(k)) kept[k] = row[k];
    }
    return kept;
  });
  return Buffer.from(`${JSON.stringify(stableJson(identity))}\n`, 'utf8');
}

function digest(root, rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  const buf = fs.readFileSync(file);
  const payload = (rel === 'features.json' || path.basename(rel) === 'features.json')
    ? featuresIdentityBytes(buf)
    : buf;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

module.exports = { digest, FEATURES_LIVE_FIELDS, featuresIdentityBytes };
