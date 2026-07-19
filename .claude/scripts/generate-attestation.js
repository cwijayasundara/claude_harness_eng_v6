#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/generate-attestation.js [--force] [--verify <file>] [--json]
//
// Increment 4a — per-repo durable compliance attestation with a sha256 integrity
// CHECKSUM. Assembles a per-commit evidence bundle from the harness control
// inventory (harness-manifest.json), the branch-protection / deploy-gate verify
// outputs, the gate verdict, and the ratchet baselines, resolves each control to a
// neutral standard clause (standard-map.json, C3), and writes an IMMUTABLE
// .claude/attestations/<sha>.json plus an integrity-checksummed index.json.
//
// Fail-safe evaluation: a source that is absent, corrupt, or missing a boolean
// verdict never counts as a silent pass; all-absent => not-evaluated (compliant
// false, no vacuous green). git runs through an injected runner (defaultGit) and
// generated_at through an injected clock so tests are deterministic; git absent =>
// null repo/sha, no crash.
//
// INTEGRITY NOTE: the embedded sha256 is a self-contained CORRUPTION-DETECTING
// checksum, NOT cryptographic authenticity — anyone with write access can rewrite
// the content and its hash. A --verify PASS means "not accidentally corrupted",
// not "authentic". Non-repudiation requires signing (GPG/cosign/Sigstore) — a
// documented seam, not built here.
//
// Exit 0 = attested / already-attested / --verify match; 1 = --verify tamper; 2 = usage/bad-sha.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildBundle } = require('./attestation-bundle');
const { contentHash } = require('./canonical-json');
const io = require('./attestation-io');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// A commit SHA is hex only; validated before it is interpolated into a filesystem
// path so a non-standard/malicious runner cannot traverse out of the attest dir.
const SHA_RE = /^[0-9a-f]{7,64}$/;

function defaultGit(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}

function slugFromUrl(url) {
  const match = String(url).match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/);
  return match ? match[1] : null;
}

function repoSlug(runner) {
  try { return slugFromUrl(runner('git', ['remote', 'get-url', 'origin']).trim()); }
  catch (_) { return null; }
}

function headSha(runner) {
  try {
    const sha = runner('git', ['rev-parse', 'HEAD']).trim();
    return sha || null;
  } catch (_) { return null; }
}

// Prefer the scaffold-stamped project-manifest.json#harness_version (the harness
// version the repo was built/upgraded with, Increment 4b C1); fall back to the
// local package.json version (a pre-stamp scaffolded repo reports its own project
// version — honest, and version-drift reads it as 'unknown' if non-semver); else null.
function readHarnessVersion(root) {
  const pm = io.readJson(path.join(root, 'project-manifest.json'));
  if (pm && typeof pm.harness_version === 'string' && pm.harness_version.trim()) return pm.harness_version;
  const pkg = io.readJson(path.join(root, 'package.json'));
  return pkg && pkg.version ? pkg.version : null;
}

function resolveIdentity(root, runner, now) {
  return {
    repo: repoSlug(runner),
    commit_sha: headSha(runner),
    generated_at: now(),
    harness_version: readHarnessVersion(root),
  };
}

// Classify all three sources, resolve the standard map, and shape the bundle.
// Kept separate so generateAttestation stays small and this is testable directly.
function assembleBundle(root, identity) {
  const bp = io.classifyVerify(path.join(root, 'specs', 'reviews', 'branch-protection-verify.json'));
  const dg = io.classifyVerify(path.join(root, 'specs', 'reviews', 'deploy-gate-verify.json'));
  const gt = io.classifyGate(root);
  const std = io.readStandardMap(root);
  return buildBundle({
    identity,
    manifest: io.readJson(path.join(root, 'harness-manifest.json')) || { guides: [], sensors: [] },
    standardMap: std.map,
    standardMapSource: std.source,
    verify: { branch_protection: bp.recorded, deploy_gate: dg.recorded },
    gate: gt.recorded,
    sourceStates: { branch_protection: bp.state, deploy_gate: dg.state, gate: gt.state },
    ratchets: io.readRatchets(root),
  });
}

// Assemble + persist one attestation. Injected runner/now/attestDir keep it
// deterministic and tmp-writable for tests. Immutable per SHA: an existing
// <sha>.json is a no-op (exit 0) unless force overwrites it.
function generateAttestation(opts = {}) {
  const root = opts.root || REPO_ROOT;
  const runner = opts.runner || defaultGit;
  const now = opts.now || (() => new Date().toISOString());
  const attestDir = opts.attestDir || path.join(root, '.claude', 'attestations');

  const identity = resolveIdentity(root, runner, now);
  if (!identity.commit_sha) return { action: 'no-sha', path: null, bundle: null, compliant: null };
  if (!SHA_RE.test(identity.commit_sha)) return { action: 'invalid-sha', path: null, bundle: null, compliant: null };

  const file = path.join(attestDir, `${identity.commit_sha}.json`);
  // Stored <sha>.json is authoritative: re-run is a no-op unless force, but still
  // self-heal a missing index entry (idempotent) and return STORED compliance.
  if (fs.existsSync(file) && !opts.force) {
    const stored = io.readJson(file);
    if (stored) io.appendIndex(attestDir, root, stored, file);
    return { action: 'already-attested', path: file, bundle: stored, compliant: stored ? stored.compliant : null };
  }

  const bundle = assembleBundle(root, identity);
  io.writeBundle(file, bundle);
  io.appendIndex(attestDir, root, bundle, file);
  return { action: 'written', path: file, bundle, compliant: bundle.compliant };
}

function tamperMessage(file, stored, recomputed) {
  return `TAMPER DETECTED: ${file}\n` +
    `  integrity.hash (stored):  ${stored || '<none>'}\n` +
    `  recomputed over content:  ${recomputed}\n` +
    'The attestation content no longer matches its sha256 integrity hash.';
}

// Recompute the hash over the file's canonical content-minus-integrity and
// compare to the stored integrity.hash. The algo is bound to the check (a bundle
// claiming a non-sha256 algo fails, so the displayed algo cannot mislead a
// reader). Never mutates.
function verifyAttestation(file) {
  const bundle = io.readJson(file);
  if (!bundle) return { ok: false, storedHash: null, recomputedHash: null, message: `cannot read attestation: ${file}` };
  const algo = bundle.integrity && bundle.integrity.algo;
  if (algo !== 'sha256') {
    return { ok: false, storedHash: (bundle.integrity && bundle.integrity.hash) || null, recomputedHash: null,
      message: `unsupported integrity algo ${JSON.stringify(algo)} (expected "sha256") in ${file}` };
  }
  const stored = (bundle.integrity && bundle.integrity.hash) || null;
  const recomputed = contentHash(bundle);
  const ok = Boolean(stored) && stored === recomputed;
  return {
    ok,
    storedHash: stored,
    recomputedHash: recomputed,
    message: ok
      ? `OK: ${file} integrity verified (sha256 ${recomputed}). NOTE: checksum detects corruption, not forgery.`
      : tamperMessage(file, stored, recomputed),
  };
}

function runVerify(file, jsonOut) {
  if (!file) { process.stderr.write('--verify requires a <file> argument\n'); process.exit(2); }
  const res = verifyAttestation(path.resolve(file));
  process.stdout.write((jsonOut ? JSON.stringify(res, null, 2) : res.message) + '\n');
  process.exit(res.ok ? 0 : 1);
}

function runGenerate(force, jsonOut) {
  const res = generateAttestation({ force });
  if (res.action === 'no-sha') {
    process.stderr.write('cannot attest: no commit sha resolvable (git unavailable)\n');
    process.exit(0);
  }
  if (res.action === 'invalid-sha') {
    process.stderr.write('cannot attest: resolved commit sha is not a valid hex sha\n');
    process.exit(2);
  }
  if (jsonOut) { process.stdout.write(JSON.stringify(res.bundle, null, 2) + '\n'); process.exit(0); }
  const verb = res.action === 'already-attested' ? 'already attested' : `attested (compliant=${res.compliant})`;
  process.stdout.write(`${verb}: ${res.path}\n`);
  process.exit(0);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json');
  const verifyIdx = args.indexOf('--verify');
  if (verifyIdx !== -1) runVerify(args[verifyIdx + 1], jsonOut);
  else runGenerate(args.includes('--force'), jsonOut);
}

module.exports = {
  generateAttestation,
  verifyAttestation,
  slugFromUrl,
};
