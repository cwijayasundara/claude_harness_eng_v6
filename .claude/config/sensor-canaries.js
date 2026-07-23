'use strict';

// Canaries for PREVENTIVE gates — the missing half of the value meter.
//
// The bite ledger records when a sensor blocked something. A preventive gate that
// blocks 0 is ambiguous: it may be a working deterrent (nothing bad reached it) or
// shelfware (it is inert). The ledger cannot tell them apart — sensor-value-report
// says so explicitly. A canary resolves it: a known-BAD input the gate must catch,
// paired with a known-GOOD input it must ignore. A gate that bites the bad and stays
// quiet on the good is PROVEN-LIVE; one that misses the bad (or fires on the good) is
// broken. This lets "never blocked" split into proven-live vs still-ambiguous, so a
// quarantine sweep can cut with evidence instead of guessing.
//
// Each entry drives the sensor's REAL detection function (never a reimplementation),
// the same round-trip discipline the harness requires of its contract tests. `sensors`
// lists the ledger names this probe proves (one detector can back several gate wirings).
// The registry starts small and honest: gates without a canary are reported as such,
// not silently assumed live. Add a probe when you want a gate's liveness proven.

const path = require('path');
const LIB = path.join(__dirname, '..', 'hooks', 'lib');

const CANARIES = [
  {
    probe: 'length-caps',
    sensors: ['length-caps'],
    why: 'a 42-line JS function must be flagged; a 3-line one must not',
    run() {
      const L = require(path.join(LIB, 'length'));
      const bad = 'function f() {\n' + Array(40).fill('  doThing();').join('\n') + '\n}\n';
      const good = 'function g() {\n  return 1;\n}\n';
      return { bit: L.oversizedFunctions(bad, '.js').length > 0, quiet: L.oversizedFunctions(good, '.js').length === 0 };
    },
  },
  {
    probe: 'secret-scan',
    sensors: ['secret-scan', 'secret-scan-write'],
    why: 'an AWS access key must be flagged; an env-var reference must not',
    run() {
      const S = require(path.join(LIB, 'secrets'));
      const bad = 'const k = "AKIA' + 'ABCDEFGHIJKLMNOP";';
      const good = 'const k = process.env.AWS_KEY;';
      return { bit: S.scanSecrets(bad).length > 0, quiet: S.scanSecrets(good).length === 0 };
    },
  },
  {
    probe: 'protected-env-file',
    sensors: ['protected-env-file'],
    why: 'a real .env must be protected; .env.example must not',
    run() {
      const S = require(path.join(LIB, 'secrets'));
      return { bit: S.isProtectedEnvFile('.env.production'), quiet: !S.isProtectedEnvFile('.env.example') };
    },
  },
];

module.exports = { CANARIES };
