'use strict';

// Proves separability for real: compose a KERNEL-ONLY tree and run it.
//
// check-partition proves no kernel unit hard-references a pack; this proves the
// consequence — that a tree containing only the kernel actually works. The two are
// different claims, and only this one would have caught .claude/git-hooks/lib being
// undeclared: the hooks loaded fine and then gate-registry died on a missing module.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { loadPartition, resolveSelection, filesFor, materialize, undeclaredUnits } = require('./pack-install');

const ALWAYS = [
  '.claude/.claude-plugin', '.claude/settings.json', '.claude/config',
  '.claude/templates/state-seeds', '.claude/git-hooks/lib',
];

let kernelTree = null;
function kernelOnly() {
  if (kernelTree) return kernelTree;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-only-'));
  const sel = resolveSelection(loadPartition(), []);
  const { missing } = materialize(out, [...ALWAYS, ...filesFor(sel)]);
  assert.deepStrictEqual(missing, [], 'every declared kernel unit must exist on disk');
  kernelTree = out;
  return out;
}

const CORE_PACKS = ['planning', 'verification', 'legacy-discipline', 'telemetry', 'scaffold'];
let coreTree = null;
function coreProfile() {
  if (coreTree) return coreTree;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'core-profile-'));
  const sel = resolveSelection(loadPartition(), CORE_PACKS);
  materialize(out, [...ALWAYS, ...filesFor(sel)]);
  coreTree = out;
  return out;
}

const node = (args, opts = {}) => spawnSync('node', args, { encoding: 'utf8', timeout: 60000, ...opts });

// A composed `core` install (no brownfield pack) must still load its own modules. These
// core-profile units degrade when the code-graph is absent, but they hard-required the
// brownfield code that computes over it at module top-level — so the install crashed on
// require() before the degradation could run. Each entry here is a resolved profile-break
// (see tools/check-partition.js PROFILE-BREAKING); grow the list as more are fixed.
const CORE_MODULES_THAT_MUST_LOAD = [
  ['hooks', 'lib', 'agent-readiness-project.js'],
];

test('every fixed core-profile module loads without the brownfield pack', () => {
  const out = coreProfile();
  for (const parts of CORE_MODULES_THAT_MUST_LOAD) {
    const p = path.join(out, '.claude', ...parts);
    const r = node(['-e', `require(${JSON.stringify(p)})`]);
    assert.strictEqual(r.status, 0,
      `${parts.join('/')} must load in a core install: ${(r.stderr || '').split('\n').find((l) => l.includes('Error')) || ''}`);
  }
});

test('every kernel hook loads with no pack installed', () => {
  const out = kernelOnly();
  for (const h of ['pre-write-gate', 'pre-bash-gate', 'verify-on-save', 'record-run', 'check-git-hooks']) {
    const p = path.join(out, '.claude', 'hooks', `${h}.js`);
    const r = node(['-e', `require(${JSON.stringify(p)})`]);
    assert.strictEqual(r.status, 0, `${h} must load without packs: ${(r.stderr || '').split('\n')[0]}`);
  }
});

test('the commit gate registry loads and selects its gates with no pack installed', () => {
  const out = kernelOnly();
  const reg = path.join(out, '.claude', 'hooks', 'lib', 'gate-registry.js');
  const r = node(['-e', `const {selectGates}=require(${JSON.stringify(reg)});process.stdout.write(String(selectGates('standard').length))`]);
  assert.strictEqual(r.status, 0, `gate-registry must load without packs: ${(r.stderr || '').split('\n')[0]}`);
  assert.ok(Number(r.stdout) > 0, 'the standard tier must still select gates');
});

test('a kernel-only /gate reports pack checks as not installed, and does not block', () => {
  const out = kernelOnly();
  fs.mkdirSync(path.join(out, 'specs', 'reviews'), { recursive: true });
  const r = node([path.join(out, '.claude', 'scripts', 'run-gate-checks.js'), '--root', out]);
  assert.match(r.stdout, /pack not installed/, 'an absent pack must be reported, not silently dropped');
  assert.doesNotMatch(r.stdout, /BLOCK/, 'an uninstalled pack is a configuration, not a failure');
  assert.strictEqual(r.status, 0);
});

test('no kernel skill, agent or script is missing from a kernel-only tree', () => {
  const out = kernelOnly();
  const sel = resolveSelection(loadPartition(), []);
  for (const rel of filesFor(sel)) {
    assert.ok(fs.existsSync(path.join(out, rel)), `${rel} declared kernel but absent from the install`);
  }
});

test('no pack unit leaks into a kernel-only tree', () => {
  const out = kernelOnly();
  const partition = loadPartition();
  const kernelSkills = new Set(partition.kernel.skill || []);
  const installed = fs.readdirSync(path.join(out, '.claude', 'skills'));
  for (const s of installed) {
    assert.ok(kernelSkills.has(s), `${s} is a pack skill but shipped in the kernel-only install`);
  }
});

test('every file in the accounted directories is claimed by some pack', () => {
  // A file no pack declares ships in NO install. check-partition cannot see this —
  // it reports edges between declared units, not units nobody declared.
  assert.deepStrictEqual(undeclaredUnits(loadPartition(), ROOT), []);
});
