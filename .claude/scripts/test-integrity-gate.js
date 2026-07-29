#!/usr/bin/env node

'use strict';

// Test-integrity gate (gap G43) — CLI surface. Pure logic lives in
// hooks/lib/test-integrity.js; this file is git/fs plumbing, the same split
// test-deletion-gate.js and cycle-gate.js use.
//
// Proves that no test file changed between the run that made it RED and the run
// that made it GREEN. G42 blocks that edit inside a session, but a turn-level
// gate is steppable (hooks off, work outside Claude Code, --no-verify); this is
// the backstop that is not.
//
// It also EMITS the verdict to specs/reviews/test-integrity.json, because the
// ledger itself is gitignored (.claude/state/*.jsonl) and a hash-chained file
// would conflict across branches anyway. The emitted verdict is what CI and
// finalize-task-evidence.js consume, matching the other specs/reviews/*.json
// evidence artifacts.
//
// CLI: node .claude/scripts/test-integrity-gate.js [--emit] [--strict]
// Exit 0 = pass, 1 = integrity findings (or --strict with no evidence), 2 = usage.
//
// VACUITY, stated plainly: with no ledger there is nothing to check, and an
// unconditional exit 0 would be a gate that can never fail — the "vacuous green"
// this repo has shipped before. So a missing ledger is reported as
// `vacuous: true` and printed as a WARNING, and `--strict` turns it into a
// failure. CI should run --strict, but only once the PostToolUse recorder is
// actually wired in settings.json; until then there is no ledger to find and
// strict mode would fail every build. That wiring is the gate on turning it on.

const fs = require('fs');
const path = require('path');
const { readLedger } = require('../hooks/lib/red-phase-ledger');
const { integrityFindings } = require('../hooks/lib/test-integrity');
const { isTestFile } = require('../hooks/lib/tdd');
const { stagedNewTestFiles } = require('../hooks/lib/pre-commit-util');

const REPO = path.resolve(__dirname, '..', '..');
const VERDICT_REL = path.join('specs', 'reviews', 'test-integrity.json');

function emitVerdict(root, verdict) {
  const file = path.join(root, VERDICT_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(verdict, null, 2)}\n`);
  return file;
}

function renderFindings(findings) {
  return findings.map((f) => `  - [${f.kind}] ${f.file}\n    ${f.detail}`).join('\n');
}

/** @returns {{pass: boolean, findings: object[], reason: string}} */
function evaluate(root) {
  const ledger = readLedger(root);
  if (ledger.state === 'invalid') {
    // A gate that cannot read its evidence must fail loud, never open.
    return {
      pass: false,
      reason: 'ledger-invalid',
      findings: [{
        kind: 'ledger-invalid',
        file: ledger.file,
        redSha: null,
        detail: `Red-phase ledger failed its integrity check: ${ledger.errors.join('; ')}`,
      }],
    };
  }
  // No ledger = no evidence = nothing proved. Reported as vacuous rather than
  // dressed up as a pass; --strict makes it a failure.
  if (ledger.state === 'absent') return { pass: true, vacuous: true, reason: 'no-ledger', findings: [] };
  const findings = integrityFindings(ledger.events, { newTestFiles: stagedNewTestFiles(root, isTestFile) });
  // Advisory findings (never-red) are reported, never blocked on — a pin-down is
  // indistinguishable from a tautological test at the ledger level.
  const blocking = findings.filter((f) => !f.advisory);
  return {
    pass: blocking.length === 0,
    vacuous: ledger.events.length === 0,
    reason: blocking.length ? 'findings' : 'clean',
    findings,
  };
}


// A gate with no evidence has proved nothing. Saying so out loud is the whole
// point — an unconditional exit 0 here would be a control that can never fail.
function reportVacuous(strict) {
  const line =
    'test-integrity has NO EVIDENCE to check (no red-phase ledger). This gate proved nothing.\n' +
    'Wire the PostToolUse(Bash) recorder in .claude/settings.json so test runs are observed.\n';
  if (strict) {
    process.stderr.write(`BLOCKED: ${line}`);
    return 1;
  }
  process.stdout.write(`WARNING: ${line}`);
  return 0;
}

function reportFindings(findings) {
  process.stderr.write(
    'BLOCKED: test-integrity found tests that changed between failing and passing.\n' +
    `${renderFindings(findings)}\n` +
    'A test weakened to go green proves nothing about the code. Fix the production code,\n' +
    'or re-run the corrected test so a new red phase is recorded.\n'
  );
  return 1;
}

function main(argv) {
  const strict = argv.includes('--strict');
  const result = evaluate(REPO);
  if (argv.includes('--emit')) {
    emitVerdict(REPO, {
      schema_version: 1,
      gate: 'test-integrity',
      pass: result.pass && !(strict && result.vacuous),
      vacuous: Boolean(result.vacuous),
      reason: result.reason,
      findings: result.findings,
    });
  }
  for (const f of (result.findings || []).filter((x) => x.advisory)) {
    process.stdout.write(`NOTE test-integrity: ${f.detail}\n`);
  }
  if (result.vacuous) return reportVacuous(strict);
  if (result.pass) {
    process.stdout.write('test-integrity OK: no test changed between its red and green runs.\n');
    return 0;
  }
  return reportFindings(result.findings.filter((f) => !f.advisory));
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { evaluate, VERDICT_REL };
