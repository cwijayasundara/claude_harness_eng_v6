#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/validate-harness-manifest.js [manifest.json]
// Validates harness-manifest.json — the guides/sensors registry that HARNESS.md
// renders. Enforces the honesty invariant stated in HARNESS.md: every active or
// partial entry must point at a real wired_at file, so the registry cannot
// silently drift from reality. Also checks the controlled vocabularies (axis,
// type, cadence, status), id uniqueness, and gap_ref shape.
// Run manually, and via test/harness-manifest.test.js in `npm test`.
// Exit 0 = valid, 1 = invalid, 2 = usage/IO error.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'harness-manifest.json');

const AXES = new Set(['maintainability', 'architecture', 'behaviour', 'traceability']);
const SENSOR_TYPES = new Set(['computational', 'inferential', 'hybrid']);
const CADENCES = new Set(['planning', 'session', 'commit', 'integration', 'drift']);
const STATUSES = new Set(['active', 'partial', 'planned']);
const GAP_RE = /^G\d+$/;

// A wired_at may carry a JSON-pointer-ish fragment (file.json#path); the file is
// what must exist on disk.
function resolveWiredAt(wiredAt) {
  return path.join(REPO_ROOT, String(wiredAt).split('#')[0]);
}

// The honesty invariant: anything not purely `planned` must resolve on disk;
// a `planned` entry must instead name the gap it tracks.
function checkWiring(e, where, errors) {
  const status = e.status || 'active'; // active is the default when omitted
  if (status === 'planned') {
    if (!('gap_ref' in e)) errors.push(`${where} ${e.id}: planned entry must declare a gap_ref`);
  } else if (!e.wired_at) {
    errors.push(`${where} ${e.id}: status "${status}" requires a wired_at`);
  } else if (!fs.existsSync(resolveWiredAt(e.wired_at))) {
    errors.push(`${where} ${e.id}: wired_at does not exist -> ${e.wired_at}`);
  }
}

function checkEntry(e, where, seen, errors) {
  if (!e.id) { errors.push(`${where}: entry missing id`); return; }
  if (seen.has(e.id)) errors.push(`${where}: duplicate id "${e.id}" (also in ${seen.get(e.id)})`);
  else seen.set(e.id, where);

  if (!AXES.has(e.axis)) errors.push(`${where} ${e.id}: invalid axis "${e.axis}"`);
  if (!STATUSES.has(e.status || 'active')) errors.push(`${where} ${e.id}: invalid status "${e.status}"`);
  if ('gap_ref' in e && !GAP_RE.test(e.gap_ref)) {
    errors.push(`${where} ${e.id}: gap_ref "${e.gap_ref}" must match /^G\\d+$/`);
  }
  checkWiring(e, where, errors);
}

function checkTopLevel(manifest, errors) {
  for (const key of ['version', 'guides', 'sensors']) {
    if (!(key in manifest)) errors.push(`missing top-level key: ${key}`);
  }
  if (!Array.isArray(manifest.guides)) errors.push('guides must be an array');
  if (!Array.isArray(manifest.sensors)) errors.push('sensors must be an array');
}

function validate(manifest) {
  const errors = [];
  const seen = new Map();
  checkTopLevel(manifest, errors);

  const guides = Array.isArray(manifest.guides) ? manifest.guides : [];
  const sensors = Array.isArray(manifest.sensors) ? manifest.sensors : [];

  for (const g of guides) {
    checkEntry(g, 'guide', seen, errors);
    if (g.kind && g.kind !== 'feedforward') errors.push(`guide ${g.id}: kind must be "feedforward"`);
  }
  for (const s of sensors) {
    checkEntry(s, 'sensor', seen, errors);
    if (!SENSOR_TYPES.has(s.type)) errors.push(`sensor ${s.id}: invalid type "${s.type}"`);
    if (!CADENCES.has(s.cadence)) errors.push(`sensor ${s.id}: invalid cadence "${s.cadence}"`);
  }

  return { errors, counts: { guides: guides.length, sensors: sensors.length } };
}

module.exports = { validate, DEFAULT_MANIFEST };

if (require.main === module) {
  const manifestPath = process.argv[2] || DEFAULT_MANIFEST;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    process.stderr.write(`validate-harness-manifest: cannot read ${manifestPath}: ${err.message}\n`);
    process.exit(2);
  }
  const { errors, counts } = validate(manifest);
  if (errors.length) {
    process.stderr.write(`harness-manifest INVALID (${errors.length} error(s)):\n`);
    for (const e of errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }
  process.stdout.write(`harness-manifest OK: ${counts.guides} guides, ${counts.sensors} sensors, all wired_at paths resolve.\n`);
  process.exit(0);
}
