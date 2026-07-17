'use strict';

// Pure logic for the duplication ratchet. Turns a jscpd clone report into a
// sorted, deduped set of stable occurrence keys ("<fragmentHash8>:<file>"),
// then reuses the canonical monotonic gateDecision (same as cycle/coupling).
// A NEW clone occurrence (new file entering a clone relationship) raises the
// count and is blocked; pre-existing clones are grandfathered by the baseline.

const crypto = require('crypto');
const { gateDecision } = require('./cycle-gate');

function fragmentHash(fragment) {
  const norm = String(fragment || '').replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 8);
}

function cloneKeys(report) {
  const dups = (report && report.duplicates) || [];
  const keys = new Set();
  for (const d of dups) {
    const h = fragmentHash(d.fragment);
    for (const f of [d.firstFile, d.secondFile]) {
      if (f && f.name) keys.add(`${h}:${f.name}`);
    }
  }
  return [...keys].sort();
}

module.exports = { fragmentHash, cloneKeys, gateDecision };
