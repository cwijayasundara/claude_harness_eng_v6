'use strict';

// project-manifest.json#quality.test_discipline
//   outcomes  — tests + code together at named seams (default for new scaffolds)
//   tdd       — write-lock / red-phase / test-integrity / test-first existence
//   at-first  — AT + red receipt for behavior stories; no write-lock stack
//
// Missing key keeps the historical stack (tdd + at-first-gate) so un-migrated
// projects and hook fixtures do not change behavior.

const fs = require('fs');
const path = require('path');

const VALID = Object.freeze(['outcomes', 'tdd', 'at-first']);

function normalizeDiscipline(raw) {
  if (raw == null || raw === '') return null;
  const d = String(raw).trim().toLowerCase();
  return VALID.includes(d) ? d : null;
}

function loadTestDiscipline(projectDir, env = process.env) {
  const fromEnv = normalizeDiscipline(env.HARNESS_TEST_DISCIPLINE);
  if (fromEnv) return fromEnv;
  if (projectDir) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(projectDir, 'project-manifest.json'), 'utf8'));
      const fromManifest = normalizeDiscipline(m && m.quality && m.quality.test_discipline);
      if (fromManifest) return fromManifest;
    } catch (_) { /* no manifest */ }
  }
  return 'tdd';
}

function tddStackEnabled(discipline) {
  return discipline === 'tdd';
}

function atFirstRequired(discipline) {
  return discipline === 'at-first' || discipline === 'tdd';
}

module.exports = {
  VALID,
  normalizeDiscipline,
  loadTestDiscipline,
  tddStackEnabled,
  atFirstRequired,
};
