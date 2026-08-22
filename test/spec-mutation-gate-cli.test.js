'use strict';

// The spec-mutation runner, driven end to end against REAL verifier processes.
//
// Two verifiers are used, and the difference between them is the whole point:
//   * an HONEST one that reads the contract off disk and compares each expected
//     value against a recorded observation — mutating the contract must break it;
//   * a BLIND one that ignores the contract and always exits 0 — the shape of a
//     check nothing consults, which is what this gate exists to expose.
//
// A stubbed runner would prove neither. This is the same round-trip discipline
// the harness requires of contract tests: real artifact, real reader.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const GATE = path.join(__dirname, '..', '.claude', 'scripts', 'spec-mutation-gate.js');

const CONTRACT = {
  group: 'A',
  stories: ['E1-S1'],
  contract: {
    api_checks: [
      { id: 'E1-S1-AC1', method: 'GET', path: '/healthz', expected_status: 200 },
      { id: 'E1-S1-AC2', method: 'POST', path: '/auth/sign-in', expected_status: 200 },
    ],
  },
};

// What the running app actually returns. The honest verifier compares the
// contract against this, so a corrupted expectation genuinely fails.
const OBSERVED = { '/healthz': 200, '/auth/sign-in': 200 };

function project({ blind }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-mutation-'));
  fs.mkdirSync(path.join(dir, 'sprint-contracts'));
  fs.writeFileSync(path.join(dir, 'sprint-contracts', 'A.json'), `${JSON.stringify(CONTRACT, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'observed.json'), JSON.stringify(OBSERVED));

  const honest = `
    const fs = require('fs');
    const c = JSON.parse(fs.readFileSync('sprint-contracts/A.json', 'utf8'));
    const observed = JSON.parse(fs.readFileSync('observed.json', 'utf8'));
    for (const check of c.contract.api_checks) {
      if (observed[check.path] !== check.expected_status) process.exit(1);
    }
    process.exit(0);
  `;
  const blindSrc = "process.exit(0); // never opens the contract\n";
  fs.writeFileSync(path.join(dir, 'verify.js'), blind ? blindSrc : honest);
  return dir;
}

function runGate(dir, args = []) {
  const r = spawnSync('node', [GATE, '--verify-cmd', 'node verify.js', ...args], {
    cwd: dir, encoding: 'utf8',
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('a verification that really reads the contract kills every mutant', () => {
  const dir = project({ blind: false });
  const r = runGate(dir);
  assert.equal(r.code, 0, `expected clean, got ${r.code}: ${r.out}`);
  assert.match(r.out, /0 survivors/);
});

test('a verification that ignores the contract leaves survivors and BLOCKS', () => {
  const dir = project({ blind: true });
  const r = runGate(dir);
  assert.equal(r.code, 1, `a decorative check must block, got ${r.code}: ${r.out}`);
  assert.match(r.out, /surviving mutant/);
  assert.match(r.out, /E1-S1-AC1/, 'the survivor must be named');
  assert.match(r.out, /verifies nothing|delete it/i, 'the finding must say what to do');
});

test('the contract is byte-identical after a run — both outcomes', () => {
  for (const blind of [false, true]) {
    const dir = project({ blind });
    const file = path.join(dir, 'sprint-contracts', 'A.json');
    const before = fs.readFileSync(file, 'utf8');
    runGate(dir);
    assert.equal(fs.readFileSync(file, 'utf8'), before,
      `the contract must be restored (blind=${blind})`);
    assert.ok(!fs.existsSync(`${file}.spec-mutation-backup`), 'no backup may be left behind');
  }
});

test('a stale backup from a crashed run is restored before anything else', () => {
  const dir = project({ blind: false });
  const file = path.join(dir, 'sprint-contracts', 'A.json');
  const good = fs.readFileSync(file, 'utf8');

  // Simulate a crash mid-mutant: contract left corrupted, backup on disk.
  fs.writeFileSync(`${file}.spec-mutation-backup`, good);
  fs.writeFileSync(file, JSON.stringify({ group: 'A', contract: { api_checks: [] } }));

  const r = runGate(dir);
  assert.equal(fs.readFileSync(file, 'utf8'), good, 'the crashed run must be undone');
  assert.equal(r.code, 0, `expected a clean run after recovery, got: ${r.out}`);
});

test('a verification command that cannot run is inconclusive, never a kill', () => {
  const dir = project({ blind: false });
  const r = spawnSync('node', [GATE, '--verify-cmd', 'definitely-not-a-command-xyz'], {
    cwd: dir, encoding: 'utf8',
  });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 1, 'an inconclusive run must not read as a pass');
  assert.match(out, /could not execute/i);
});

test('no contract at all is unprovisioned, not a failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-mutation-empty-'));
  const r = spawnSync('node', [GATE, '--verify-cmd', 'true'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /unprovisioned/);
});

test('no verification command is unprovisioned, not a vacuous pass claim', () => {
  const dir = project({ blind: false });
  const r = spawnSync('node', [GATE], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /unprovisioned/);
  assert.doesNotMatch(r.stdout, /mutant\(s\) killed/,
    'it must not report a kill count for a run that never happened');
});

test('the mutant cap is reported, never silently applied', () => {
  const dir = project({ blind: false });
  const r = runGate(dir, ['--max-mutants', '1']);
  assert.match(r.out, /not run/, 'a bounded run must say what it did not cover');
});
