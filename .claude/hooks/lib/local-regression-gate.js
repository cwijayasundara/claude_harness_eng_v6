'use strict';

// Deterministic primitives for local-regression-gate.js (gap G16, pass 2a).
// The fast, LOCAL complement to G15's regression-gate.js: instead of the
// whole accumulated e2e/ suite + every prior contract, runs only what
// impact-scope.js's deterministic TIA says a diff could plausibly have
// broken, plus an always-on golden-path safety net.
//
// Reuses G15's hooks/lib/regression-gate.js primitives (runE2eSuite,
// extractPlaywrightFailures, isQuarantined, regressPriorContract) rather than
// duplicating them — this file only adds what's new: golden-path loading and
// the two scoped runners that compose the shared primitives over a specific
// spec/contract list instead of "everything".

const fs = require('fs');
const path = require('path');
const {
  isQuarantined,
  extractPlaywrightFailures,
  runE2eSuite,
  regressPriorContract,
} = require('./regression-gate');
const { validate } = require('./contract-schema');

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

// Opt-in, unconditional safety net under a possibly-stale impact graph.
// Empty by default; degrades LOUDLY (a note, never a silent no-op) so teams
// know the net isn't populated, not that it "passed". A configured path that
// no longer exists (stale/typo'd) is dropped with its own note rather than
// left to surface as an opaque e2e command failure.
function loadGoldenPaths(root, notes) {
  const manifest = readJsonSafe(path.join(root, 'project-manifest.json')) || {};
  const configured = (manifest.verification && manifest.verification.golden_paths) || [];
  if (!configured.length) {
    notes.push('0 golden paths configured (project-manifest.json#verification.golden_paths) — no unconditional e2e safety net beyond impact analysis');
    return [];
  }
  const paths = configured.filter((p) => {
    const exists = fs.existsSync(path.join(root, p));
    if (!exists) notes.push(`golden path not found: ${p} (project-manifest.json#verification.golden_paths) — check the path is correct`);
    return exists;
  });
  return paths;
}

function runScopedE2e(root, opts, specs, quarantine, notes, findings) {
  if (!specs.length) { notes.push('no e2e specs in scope (impact analysis + golden paths) — nothing to run'); return; }
  const result = runE2eSuite(root, opts.e2eCmd, opts.e2eTimeout, specs, opts.replay);
  if (result.unprovisioned) {
    notes.push(`e2e command "${opts.e2eCmd}" is not runnable (binary not found) — impact-scoped e2e check skipped`);
    return;
  }
  if (result.liveExternalReached) {
    findings.push({ file: opts.e2eDir, line: 1, detail: 'regression under forced replay reached a LIVE external — a wrapper/LLM call had no recorded fixture (MissingFixtureError/GoldenNotFoundError). Record it (HARNESS_TEST_REPLAY unset) or fix the test; boot the app under HARNESS_TEST_REPLAY=1.' });
    return;
  }
  if (!result.report) {
    if (result.code !== 0) findings.push({ file: opts.e2eDir, line: 1, detail: `e2e suite exited ${result.code} but produced no parseable JSON report — see raw output for detail` });
    return;
  }
  for (const f of extractPlaywrightFailures(result.report)) {
    if (isQuarantined(f.title, quarantine)) { notes.push(`quarantined flake excluded: ${f.title}`); continue; }
    findings.push({ file: f.file ? path.join(opts.e2eDir, f.file) : opts.e2eDir, line: f.line, detail: `e2e regression: "${f.title}" now fails` });
  }
}

async function runScopedContracts(root, opts, contracts, quarantine, notes, findings) {
  if (!contracts.length) { notes.push('no sprint-contracts in scope — nothing to re-check'); return; }
  const schema = readJsonSafe(opts.schemaPath);
  if (schema === null) {
    findings.push({
      file: opts.schemaPath,
      line: 1,
      detail: `contract-schema unreadable — cannot verify ${contracts.length} in-scope contract(s) are still schema-valid (local-regression-gate refuses to silently skip the schema-drift check)`,
    });
    return;
  }
  for (const contractRel of contracts) {
    const contractFindings = await regressPriorContract(path.join(root, contractRel), opts.apiBaseUrl, quarantine, schema, validate, opts.httpTimeout);
    findings.push(...contractFindings);
  }
}

module.exports = { loadGoldenPaths, runScopedE2e, runScopedContracts };
