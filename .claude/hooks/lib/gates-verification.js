'use strict';

// Mutation-smoke pre-commit gate. VERIFICATION pack: it only runs inside an /auto
// build and needs the mutation runner. Split out of gates-quality (kernel) so the
// kernel commit gate does not require mutation-gate.

const { runMutationOnFiles, renderSurvivors } = require('./mutation-gate');
const { failBlock, noteSkip, inAutoBuild, stagedNewTestFiles } = require('./pre-commit-util');
const { isTestFile } = require('./tdd');
const { readLedger } = require('./red-phase-ledger');
const { integrityFindings } = require('./test-integrity');

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

module.exports = { checkMutation, checkTestIntegrity };
