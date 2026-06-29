'use strict';

// Pure helpers for the approved-fixtures gate (gap G12). Snapshot/golden files
// are oracles; this lib detects them, checksums them, and classifies them
// against an approved baseline. No process control — unit-testable.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PATTERNS = ['__snapshots__/', '.snap', '.ambr', '.approved.txt', '.approved.json'];
const IGNORE = new Set(['node_modules', '.git']);

// A pattern ending in '/' is a path substring (e.g. __snapshots__/); otherwise a suffix.
function matches(rel, patterns) {
  const p = rel.replace(/\\/g, '/');
  return patterns.some((pat) => (pat.endsWith('/') ? p.includes(pat) : p.endsWith(pat)));
}

function walk(root, rel, patterns, acc) {
  let names;
  try { names = fs.readdirSync(path.join(root, rel)); } catch (_) { return acc; }
  for (const name of names) {
    if (IGNORE.has(name)) continue;
    const r = rel ? `${rel}/${name}` : name;
    let st;
    try { st = fs.statSync(path.join(root, r)); } catch (_) { continue; }
    if (st.isDirectory()) walk(root, r, patterns, acc);
    else if (matches(r, patterns)) acc.push(r);
  }
  return acc;
}

function findSnapshots(root, patterns) {
  return walk(root, '', patterns || DEFAULT_PATTERNS, []).sort();
}

function checksumOf(root, rel) {
  return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
}

function readBaseline(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return []; }
}

function classify(found, baseline, checksum) {
  const base = new Map(baseline.map((e) => [e.path, e.checksum]));
  const foundSet = new Set(found);
  const ok = [];
  const modified = [];
  const unapproved = [];
  const removed = [];
  for (const rel of found) {
    if (!base.has(rel)) unapproved.push(rel);
    else if (base.get(rel) !== checksum(rel)) modified.push(rel);
    else ok.push(rel);
  }
  for (const e of baseline) if (!foundSet.has(e.path)) removed.push(e.path);
  return { ok, modified, unapproved, removed };
}

function resolvePatterns(manifest) {
  const cfg = manifest && manifest.approved_fixtures && manifest.approved_fixtures.patterns;
  return Array.isArray(cfg) && cfg.length ? cfg : DEFAULT_PATTERNS;
}

module.exports = { DEFAULT_PATTERNS, findSnapshots, checksumOf, readBaseline, classify, resolvePatterns };
