'use strict';

// Locks the G7 wiring so the mutation ratchet can't be silently dropped: the
// pre-commit hook must run the gate (scoped to /auto builds), the CLI must
// reuse the pure lib, package.json must expose `npm run mutation`, and the
// manifest must mark mutation-smoke active.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('pre-commit wires the mutation gate, scoped to /auto builds', () => {
  // PR3: thin pre-commit dispatches via gate-registry. v6: mutation-smoke moved to
  // gates-verification.js (verification pack), reached via packRun so an uninstalled
  // pack is a reported skip rather than a crash.
  const hook = read('.claude/git-hooks/pre-commit');
  assert.match(hook, /gate-registry/, 'pre-commit must dispatch through gate-registry');
  const registry = read('.claude/hooks/lib/gate-registry.js');
  assert.match(registry, /mutation-smoke/, 'catalog must register mutation-smoke');
  assert.match(registry, /packRun\('gates-verification', 'checkMutation'/, 'catalog must bind checkMutation via packRun');
  const quality = read('.claude/hooks/lib/gates-verification.js');
  assert.match(quality, /runMutationOnFiles/, 'must import the mutation orchestrator');
  assert.match(quality, /inAutoBuild/, 'mutation gate must be scoped to active /auto builds');
  assert.match(quality, /HARNESS_MUTATION_GATE/, 'must honor the off switch');
});

test('mutation-gate CLI reuses the lib, which drives the existing smoke runner', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/mutation-gate.js')));
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/hooks/lib/mutation-gate.js')));
  const cli = read('.claude/scripts/mutation-gate.js');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/mutation-gate'\)/, 'CLI must use the tested lib');
  const lib = read('.claude/hooks/lib/mutation-gate.js');
  assert.match(lib, /mutation-smoke\.js/, 'the lib must drive the existing mutation-smoke runner');
});

test('the lib owns the orchestrator and is require-safe', () => {
  const lib = require(path.join(ROOT, '.claude/hooks/lib/mutation-gate.js'));
  assert.strictEqual(typeof lib.runMutationOnFiles, 'function');
  // Importing the CLI must not run main() (no process.exit on require).
  assert.doesNotThrow(() => require(path.join(ROOT, '.claude/scripts/mutation-gate.js')));
});

test('package.json exposes the mutation script and manifest marks it active', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.strictEqual(pkg.scripts.mutation, 'node .claude/scripts/mutation-gate.js --staged');
  const m = JSON.parse(read('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'mutation-smoke');
  assert.strictEqual(s.status, 'active');
  assert.ok(!('gap_ref' in s), 'no longer a gap');
});

test('/auto Gate 3 documents the mutation-smoke step', () => {
  const skill = readSkillCorpus('auto');
  assert.match(skill, /mutation-gate\.js/, 'Gate 3 must reference the mutation gate');
  assert.match(skill, /survivor/i, 'Gate 3 must explain survivors');
});
