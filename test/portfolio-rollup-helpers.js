'use strict';

// Shared helpers for the Increment 4b portfolio-rollup tests (not a *.test.js, so
// the node:test glob does not run it as a suite). They round-trip REAL 4a
// attestations: each per-repo bundle is produced by the actual
// generate-attestation.js into a tmp root and copied into a collection dir, so the
// rollup is exercised against real integrity hashes, not hand-built fixtures.

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPTS = path.join(REPO_ROOT, '.claude', 'scripts');
const { generateAttestation } = require(path.join(SCRIPTS, 'generate-attestation'));
const NOW = '2026-07-19T00:00:00.000Z';

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

// Injected git runner: resolves a fixed sha + an owner/repo remote so the real
// attestation records repo slug owner/repo. Concatenation (not a template) keeps
// the harness length parser from mis-reading the arrow body.
function gitRunner(owner, repo, sha) {
  return function runGit(_c, args) {
    if (args[0] === 'rev-parse') return sha + '\n';
    return 'git@github.com:' + owner + '/' + repo + '.git\n';
  };
}

// A tmp root carrying the REAL manifest + a package.json version + the reviews
// that drive compliant / non-compliant / not-evaluated status through the real
// classifier (readHarnessVersion falls back to package.json when no
// project-manifest.json is present).
function attestRoot(version, mode) {
  const root = tmp('pr-att-');
  fs.mkdirSync(path.join(root, '.claude', 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs', 'reviews'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'harness-manifest.json'), path.join(root, 'harness-manifest.json'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
  const reviews = {};
  if (mode === 'compliant') {
    reviews['branch-protection-verify.json'] = { compliant: true, drift: [] };
    reviews['deploy-gate-verify.json'] = { compliant: true, environments: [] };
  } else if (mode === 'noncompliant') {
    reviews['branch-protection-verify.json'] = { compliant: false, drift: [{ rule: 'ruleset', field: 'presence' }] };
  }
  for (const [name, body] of Object.entries(reviews)) {
    fs.writeFileSync(path.join(root, 'specs', 'reviews', name), JSON.stringify(body));
  }
  return root;
}

// Generate a REAL attestation for owner/repo@sha and drop it into collectionDir
// as the flat <owner>__<repo>.json the rollup + --fetch naming expect.
function genInto(collectionDir, owner, repo, sha, version, mode) {
  const root = attestRoot(version, mode);
  const res = generateAttestation({
    root, attestDir: path.join(root, '.claude', 'attestations'),
    runner: gitRunner(owner, repo, sha), now: () => NOW,
  });
  fs.mkdirSync(collectionDir, { recursive: true });
  const dest = path.join(collectionDir, owner + '__' + repo + '.json');
  fs.copyFileSync(res.path, dest);
  return { file: dest, bundle: res.bundle };
}

function capture(fn) {
  const out = { stdout: '', stderr: '' };
  const ow = process.stdout.write; const oe = process.stderr.write;
  process.stdout.write = (c) => { out.stdout += c; return true; };
  process.stderr.write = (c) => { out.stderr += c; return true; };
  try { out.code = fn(); } finally { process.stdout.write = ow; process.stderr.write = oe; }
  return out;
}

function readReport(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

// --- gh --fetch stubbing (arg-matching; no live network) ----------------------

function contentsResponse(text) {
  return { content: Buffer.from(text, 'utf8').toString('base64'), encoding: 'base64' };
}

// Build a REAL attestation + its index.json (both as gh contents responses) for
// one repo, keyed by the api paths portfolio-rollup.js requests.
function fetchRoutesFor(owner, repo, sha) {
  const gen = genInto(tmp('pr-fetch-src-'), owner, repo, sha, '2.5.0', 'compliant');
  const attText = fs.readFileSync(gen.file, 'utf8');
  const relPath = '.claude/attestations/' + sha + '.json';
  const index = { entries: [{ commit_sha: sha, generated_at: NOW, path: relPath }], integrity: { algo: 'sha256', hash: 'x' } };
  return [
    ['repos/' + owner + '/' + repo + '/contents/.claude/attestations/index.json', contentsResponse(JSON.stringify(index))],
    ['repos/' + owner + '/' + repo + '/contents/' + relPath, contentsResponse(attText)],
  ];
}

function ghStub(routes) {
  return function stub(args) {
    const key = args.join(' ');
    for (const [needle, out] of routes) {
      if (key.includes(needle)) {
        if (out && out.__throw) throw new Error(out.__throw);
        return typeof out === 'string' ? out : JSON.stringify(out);
      }
    }
    throw new Error('unexpected gh call: ' + key);
  };
}

module.exports = {
  REPO_ROOT, SCRIPTS, NOW, tmp, attestRoot, genInto, gitRunner, capture, readReport,
  contentsResponse, fetchRoutesFor, ghStub, generateAttestation,
};
