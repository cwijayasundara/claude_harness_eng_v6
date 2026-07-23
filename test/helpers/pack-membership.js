'use strict';

// "Does this unit ship to a scaffolded project, and in which profiles?"
//
// Wiring tests used to answer that by regexing scaffold-copy.js for a quoted filename.
// The copy lists are now derived from .claude/config/packs.json, so the literals are
// gone and those regexes silently matched nothing — a test that can only pass is worse
// than no test. This reads the partition, which is what the copy step actually uses.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PACKS = path.join(ROOT, '.claude', 'config', 'packs.json');

function loadPacks() {
  return JSON.parse(fs.readFileSync(PACKS, 'utf8'));
}

/** The pack that owns a unit, or null if nothing declares it. */
function packOf(name, kind) {
  const cfg = loadPacks();
  if ((cfg.kernel[kind] || []).includes(name)) return 'kernel';
  for (const [pack, spec] of Object.entries(cfg.packs)) {
    if ((spec[kind] || []).includes(name)) return pack;
  }
  return null;
}

/** Profile names whose install contains this unit. Empty means it ships nowhere. */
function shipsIn(name, kind) {
  const cfg = loadPacks();
  const owner = packOf(name, kind);
  if (!owner) return [];
  if (owner === 'kernel') return Object.keys(cfg.profiles);
  return Object.entries(cfg.profiles)
    .filter(([, p]) => p.packs.includes(owner))
    .map(([n]) => n);
}

module.exports = { loadPacks, packOf, shipsIn };
