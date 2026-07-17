'use strict';

// Load quality.sensor_tier for pre-commit / gate filtering (PR3).
// Priority: HARNESS_SENSOR_TIER env > project-manifest.json#quality.sensor_tier > standard

const fs = require('fs');
const path = require('path');

const VALID_TIERS = Object.freeze(['minimal', 'standard', 'strict']);

/** @type {Record<string, Set<string>>} gate id → tiers that include it */
const GATE_TIERS = Object.freeze({
  'secret-scan': new Set(VALID_TIERS),
  'amendment-provenance': new Set(VALID_TIERS),
  'test-deletion-guard': new Set(['standard', 'strict']),
  'live-externals': new Set(['standard', 'strict']),
  'stub-smell-gate': new Set(['standard', 'strict']),
  'refactor-purity': new Set(VALID_TIERS),
  'layer-imports': new Set(VALID_TIERS),
  'bounded-context-rules': new Set(VALID_TIERS),
  'ownership-check': new Set(VALID_TIERS),
  'legacy-discipline-proof': new Set(['standard', 'strict']),
  'sprout-diff': new Set(['standard', 'strict']),
  'at-first-gate': new Set(['standard', 'strict']),
  'sprint-contract': new Set(VALID_TIERS),
  'type-check': new Set(VALID_TIERS),
  'coverage-ratchet-py': new Set(['standard', 'strict']),
  'coverage-ratchet-js': new Set(['standard', 'strict']),
  'mutation-smoke': new Set(['standard', 'strict']),
  'cycle-detection': new Set(['strict']),
  'coupling-ratchet': new Set(['strict']),
  'duplication-ratchet': new Set(['strict']),
});

function normalizeTier(raw) {
  if (raw == null || raw === '') return null;
  const t = String(raw).trim().toLowerCase();
  return VALID_TIERS.includes(t) ? t : null;
}

function loadSensorTier(projectDir, env = process.env) {
  const fromEnv = normalizeTier(env.HARNESS_SENSOR_TIER);
  if (fromEnv) return fromEnv;
  try {
    const m = JSON.parse(fs.readFileSync(path.join(projectDir, 'project-manifest.json'), 'utf8'));
    const fromManifest = normalizeTier(m && m.quality && m.quality.sensor_tier);
    if (fromManifest) return fromManifest;
  } catch (_) {
    /* no manifest */
  }
  return 'standard';
}

function isGateEnabled(tier, gateId) {
  const t = normalizeTier(tier) || 'standard';
  const allowed = GATE_TIERS[gateId];
  if (!allowed) return true; // unknown gates run (fail-safe: don't drop new gates)
  return allowed.has(t);
}

module.exports = {
  VALID_TIERS,
  GATE_TIERS,
  loadSensorTier,
  isGateEnabled,
  normalizeTier,
};
