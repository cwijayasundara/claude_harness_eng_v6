'use strict';

// Mutation-smoke pre-commit gate. VERIFICATION pack: it only runs inside an /auto
// build and needs the mutation runner. Split out of gates-quality (kernel) so the
// kernel commit gate does not require mutation-gate.

const fs = require('fs');
const path = require('path');
const { runMutationOnFiles, renderSurvivors } = require('./mutation-gate');
const { failBlock, noteSkip, inAutoBuild, stagedNewTestFiles, requireScript, gitExec } = require('./pre-commit-util');
const { isTestFile } = require('./tdd');
const { readLedger } = require('./red-phase-ledger');
const { integrityFindings } = require('./test-integrity');

function checkImpactScopedRegression(ctx) {
  const { projectDir, staged } = ctx;
  if ((process.env.HARNESS_LOCAL_REGRESSION_GATE || '').toLowerCase() === 'off') return;
  if (!inAutoBuild(projectDir)) return;
  const { spawnSync } = require('child_process');
  const script = path.join(projectDir, '.claude', 'scripts', 'local-regression-gate.js');
  if (!fs.existsSync(script)) {
    noteSkip('impact-scoped-regression', 'local-regression-gate.js not installed');
    return;
  }
  const args = [script, '--root', projectDir];
  for (const f of staged || []) args.push('--changed-file', f);
  const res = spawnSync(process.execPath, args, {
    cwd: projectDir, encoding: 'utf8', timeout: 180000,
  });
  if (res.status === 0) return;
  failBlock({
    id: 'impact-scoped-regression',
    title: 'impact-scoped regression (G16) failed during /auto',
    detail: `${String(res.stderr || res.stdout || '').slice(0, 800)}\n`,
    fix: 'fix the regressed e2e/contract check. G15 (regression-gate.js --replay) still runs when the group lands on WAVE_BASE.',
    envOff: 'HARNESS_LOCAL_REGRESSION_GATE',
    minTier: 'standard',
  });
}

function checkMutation(ctx) {
  const { projectDir, stagedSource } = ctx;
  if ((process.env.HARNESS_MUTATION_GATE || '').toLowerCase() === 'off') return;
  if (!inAutoBuild(projectDir)) return;
  const { results, blocked } = runMutationOnFiles(stagedSource, projectDir, {});
  for (const r of results) {
    if (r.skipped) noteSkip(`Mutation-smoke (${r.lang})`, r.reason);
  }
  if (blocked.length === 0) return;
  const detail = blocked.map((r) => renderSurvivors(r.survived)).filter(Boolean).join('\n');
  failBlock({
    id: 'mutation-smoke',
    title: 'mutation-smoke found tests that pass but don\'t bite (survivors)',
    detail: `${detail}\n`,
    fix: 'add an assertion that fails when the flipped operator above is applied — test the boundary (off-by-one) or the false branch — then re-commit.',
    envOff: 'HARNESS_MUTATION_GATE',
    minTier: 'standard',
  });
}


// G43. The commit-time backstop for the G42 session lock: no test file may
// change between the run that made it RED and the run that made it GREEN.
// runsWithoutSource, because the tamper can land in a test-only commit.
function blockInvalidLedger(ledger) {
  failBlock({
    id: 'test-integrity',
    title: 'red-phase ledger failed its integrity check',
    detail: `${ledger.errors.join('; ')}\n`,
    fix: 'the ledger is tamper-evident by design; recover it from a clean state rather than editing it.',
    envOff: 'HARNESS_TEST_INTEGRITY_GATE',
    minTier: 'standard',
  });
}

function checkTestIntegrity(ctx) {
  const { projectDir } = ctx;
  if ((process.env.HARNESS_TEST_INTEGRITY_GATE || '').toLowerCase() === 'off') return;
  const { loadTestDiscipline, tddStackEnabled } = require('./test-discipline');
  if (!tddStackEnabled(loadTestDiscipline(projectDir, process.env))) return;
  const ledger = readLedger(projectDir);
  if (ledger.state === 'absent') return; // nothing observed yet
  if (ledger.state === 'invalid') return blockInvalidLedger(ledger);

  const findings = integrityFindings(ledger.events, { newTestFiles: stagedNewTestFiles(projectDir, isTestFile) });
  // Advisory findings (never-red) are surfaced but never blocked on: a pin-down
  // is indistinguishable from a tautological test at the ledger level.
  for (const f of findings.filter((x) => x.advisory)) {
    process.stdout.write(`NOTE test-integrity: ${f.detail}\n`);
  }
  const blocking = findings.filter((f) => !f.advisory);
  if (!blocking.length) return;
  failBlock({
    id: 'test-integrity',
    title: 'a test changed between its failing run and its passing run',
    detail: `${blocking.map((f) => `  - ${f.file}: ${f.detail}`).join('\n')}\n`,
    fix: 'fix the production code instead, or re-run the corrected test so a new red phase is recorded.',
    envOff: 'HARNESS_TEST_INTEGRITY_GATE',
    minTier: 'standard',
  });
}

function checkTrajectoryContract(ctx) {
  const { projectDir } = ctx;
  if (process.env.HARNESS_TRAJECTORY_GATE === 'off') {
    noteSkip('trajectory-contract', 'HARNESS_TRAJECTORY_GATE=off');
    return;
  }
  let gate;
  try {
    gate = requireScript('trajectory-contract');
  } catch (_) {
    noteSkip('trajectory-contract', 'sensor script missing or unloadable');
    return;
  }
  const verdict = gate.evaluateFromDisk(projectDir, gitExec(projectDir));
  if (verdict.status === 'skip') {
    noteSkip('trajectory-contract', verdict.reason);
    return;
  }
  if (verdict.status === 'fail') {
    const failed = (verdict.checks || []).filter((c) => c.required && !c.ok);
    failBlock({
      id: 'trajectory-contract',
      title: 'trajectory-contract — agent session is missing a required step receipt',
      detail: `${failed.map((c) => `  - ${c.id}: ${c.detail}`).join('\n')}\n`,
      fix: 'run the missing step (tests / context-pack) and leave its receipt, then re-commit. Do not skip verification and then swap models.',
      envOff: 'HARNESS_TRAJECTORY_GATE',
      minTier: 'standard',
    });
  }
}

module.exports = {
  checkMutation, checkTestIntegrity, checkImpactScopedRegression, checkTrajectoryContract,
};
