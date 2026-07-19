'use strict';

// Increment 4a — whole-branch-review hardening for the compliance attestation:
// fail-safe source evaluation, index integrity (fail-loud), deep-canonicalization
// tamper detection, algo binding, and commit_sha path validation. Split from
// attestation.test.js to keep each file within the length gate.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPTS = path.join(REPO_ROOT, '.claude', 'scripts');
const { generateAttestation, verifyAttestation } = require(path.join(SCRIPTS, 'generate-attestation'));
const { canonicalize, sha256Hex } = require(path.join(SCRIPTS, 'canonical-json'));

const NOW = '2026-07-19T00:00:00.000Z';
const SHA = 'deadbeefcafe0001';
const shaRunner = (sha) => (_cmd, args) => (args[0] === 'rev-parse' ? `${sha}\n` : 'git@github.com:acme/widgets.git\n');

function makeRoot(reviews = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-h-'));
  fs.mkdirSync(path.join(root, '.claude', 'templates'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs', 'reviews'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'harness-manifest.json'), path.join(root, 'harness-manifest.json'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '2.5.0' }));
  fs.copyFileSync(
    path.join(REPO_ROOT, '.claude', 'templates', 'standard-map.json'),
    path.join(root, '.claude', 'templates', 'standard-map.json'),
  );
  for (const [name, body] of Object.entries(reviews)) {
    fs.writeFileSync(path.join(root, 'specs', 'reviews', name), body);
  }
  return root;
}

function gen(root, extra = {}) {
  return generateAttestation({ root, attestDir: path.join(root, '.claude', 'attestations'), runner: shaRunner(SHA), now: () => NOW, ...extra });
}

function reorderKeysDeep(v) {
  if (Array.isArray(v)) return v.map(reorderKeysDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort().reverse()) out[k] = reorderKeysDeep(v[k]);
    return out;
  }
  return v;
}

test('fail-safe: all sources absent => not-evaluated + compliant:false (no vacuous green)', () => {
  const { bundle } = gen(makeRoot());
  assert.strictEqual(bundle.status, 'not-evaluated');
  assert.strictEqual(bundle.compliant, false);
  assert.strictEqual(bundle.sources_evaluated, 0);
  assert.strictEqual(bundle.sources.branch_protection, 'absent');
});

test('fail-safe: a present-but-unparseable verify file => non-compliant + recorded invalid', () => {
  const { bundle } = gen(makeRoot({ 'branch-protection-verify.json': '{ not valid json' }));
  assert.strictEqual(bundle.sources.branch_protection, 'invalid');
  assert.deepStrictEqual(bundle.verify.branch_protection, { invalid: true, reason: 'unparseable' });
  assert.strictEqual(bundle.compliant, false);
});

test('fail-safe: verify present with a non-boolean compliant => non-compliant', () => {
  for (const bad of [{ drift: [] }, { compliant: 'false' }, { compliant: 0 }, { compliant: null }]) {
    const { bundle } = gen(makeRoot({ 'branch-protection-verify.json': JSON.stringify(bad) }));
    assert.strictEqual(bundle.sources.branch_protection, 'invalid', JSON.stringify(bad));
    assert.strictEqual(bundle.compliant, false, JSON.stringify(bad));
  }
});

test('fail-safe: one valid passing source + others absent => compliant:true, sources_evaluated:1', () => {
  const { bundle } = gen(makeRoot({ 'branch-protection-verify.json': JSON.stringify({ compliant: true, drift: [] }) }));
  assert.strictEqual(bundle.sources.branch_protection, 'pass');
  assert.strictEqual(bundle.sources_evaluated, 1);
  assert.strictEqual(bundle.compliant, true);
});

test('standard_map_source records provenance (template default vs repo-root override)', () => {
  assert.strictEqual(gen(makeRoot()).bundle.standard_map_source, '.claude/templates/standard-map.json');
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'standard-map.json'), JSON.stringify({ id: 'root/1', by_axis: {}, by_id: {} }));
  const { bundle } = gen(root);
  assert.strictEqual(bundle.standard_map_source, 'standard-map.json');
  assert.strictEqual(bundle.standard_ref, 'root/1');
});

test('integrity is order-independent: deep key reordering still verifies with the same hash', () => {
  const root = makeRoot({
    'deploy-gate-verify.json': JSON.stringify({ compliant: true, environments: [{ environment: 'prod', repo: 'acme/widgets', compliant: true, drift: [] }] }),
  });
  const { path: file, bundle } = gen(root);
  fs.writeFileSync(file, JSON.stringify(reorderKeysDeep(JSON.parse(fs.readFileSync(file, 'utf8'))), null, 2));
  const res = verifyAttestation(file);
  assert.strictEqual(res.ok, true, 'deep key reordering must not change the hash');
  assert.strictEqual(res.recomputedHash, bundle.integrity.hash);
});

test('tamper detection catches a NESTED field mutation', () => {
  const root = makeRoot({
    'deploy-gate-verify.json': JSON.stringify({ compliant: true, environments: [{ environment: 'prod', repo: 'acme/widgets', compliant: true, drift: [] }] }),
  });
  const { path: file } = gen(root);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  j.verify.deploy_gate.environments[0].compliant = false; // nested flip, no hash recompute
  fs.writeFileSync(file, JSON.stringify(j, null, 2));
  assert.strictEqual(verifyAttestation(file).ok, false);
});

test('--verify rejects a non-sha256 integrity algo', () => {
  const { path: file } = gen(makeRoot());
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  j.integrity.algo = 'md5';
  fs.writeFileSync(file, JSON.stringify(j, null, 2));
  const res = verifyAttestation(file);
  assert.strictEqual(res.ok, false);
  assert.match(res.message, /algo/i);
});

test('a non-hex commit_sha is rejected (no path traversal) and writes nothing', () => {
  const root = makeRoot();
  const res = generateAttestation({ root, attestDir: path.join(root, '.claude', 'attestations'), runner: shaRunner('../evil'), now: () => NOW });
  assert.strictEqual(res.action, 'invalid-sha');
  assert.ok(!fs.existsSync(path.join(root, '.claude', 'evil.json')));
});

test('index integrity: a tampered index fails loudly, not a silent reset', () => {
  const root = makeRoot();
  const attestDir = path.join(root, '.claude', 'attestations');
  gen(root);
  const idxPath = path.join(attestDir, 'index.json');
  const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  idx.entries[0].compliant = true; // flip an entry without recomputing integrity
  fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2));
  assert.throws(
    () => generateAttestation({ root, attestDir, runner: shaRunner('feed0002'), now: () => NOW }),
    /index integrity mismatch/i,
  );
  assert.strictEqual(JSON.parse(fs.readFileSync(idxPath, 'utf8')).entries.length, 1, 'prior entry not discarded');
});

test('index preserves prior entries and updates its integrity hash on append', () => {
  const root = makeRoot();
  const attestDir = path.join(root, '.claude', 'attestations');
  gen(root);
  generateAttestation({ root, attestDir, runner: shaRunner('feed0002'), now: () => NOW });
  const idx = JSON.parse(fs.readFileSync(path.join(attestDir, 'index.json'), 'utf8'));
  assert.strictEqual(idx.entries.length, 2);
  assert.strictEqual(idx.integrity.hash, sha256Hex(canonicalize(idx.entries)));
});

test('already-attested re-run self-heals a missing index entry and returns stored compliance', () => {
  const root = makeRoot({ 'branch-protection-verify.json': JSON.stringify({ compliant: true, drift: [] }) });
  const attestDir = path.join(root, '.claude', 'attestations');
  gen(root);
  fs.rmSync(path.join(attestDir, 'index.json')); // simulate a lost index
  const res = gen(root); // no --force
  assert.strictEqual(res.action, 'already-attested');
  assert.strictEqual(res.compliant, true, 'returns STORED compliance');
  const idx = JSON.parse(fs.readFileSync(path.join(attestDir, 'index.json'), 'utf8'));
  assert.strictEqual(idx.entries.length, 1, 'missing index entry self-healed');
});
