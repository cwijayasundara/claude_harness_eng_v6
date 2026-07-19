'use strict';

// Increment 4b — portfolio compliance rollup: core aggregation (design tests 1-6).
// Round-trips REAL 4a attestations (see portfolio-rollup-helpers.js) — not
// hand-built fixtures. --fetch + stamping live in portfolio-rollup-fetch.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const H = require('./portfolio-rollup-helpers');
const { run } = require(path.join(H.SCRIPTS, 'portfolio-rollup'));
const core = require(path.join(H.SCRIPTS, 'portfolio-rollup-core'));
const { tmp, genInto, capture, readReport, NOW } = H;

function rollup(dir, extraArgs, opts) {
  const outFile = path.join(dir, 'rollup.json');
  const args = [dir, '--target-version', '2.5.0', '--out', outFile, ...(extraArgs || [])];
  const res = capture(() => run(args, { cwd: dir, now: () => NOW, ...(opts || {}) }));
  return { res, report: fs.existsSync(outFile) ? readReport(outFile) : null, outFile };
}

// ============================ 1. real-collection summary =====================

test('1: aggregates a REAL collection into correct summary + portfolio_compliant', () => {
  const dir = tmp('pr-coll-');
  genInto(dir, 'acme', 'alpha', 'a'.repeat(40), '2.5.0', 'compliant');
  genInto(dir, 'acme', 'beta', 'b'.repeat(40), '2.5.0', 'compliant');
  genInto(dir, 'acme', 'gamma', 'c'.repeat(40), '2.5.0', 'noncompliant');
  genInto(dir, 'acme', 'delta', 'd'.repeat(40), '2.5.0', 'notevaluated');
  const { res, report } = rollup(dir);
  assert.strictEqual(res.code, 0, res.stderr);
  assert.strictEqual(report.summary.total, 4);
  assert.strictEqual(report.summary.compliant, 2);
  assert.strictEqual(report.summary.non_compliant, 1);
  assert.strictEqual(report.summary.not_evaluated, 1);
  assert.strictEqual(report.summary.version_current, 4);
  assert.strictEqual(report.portfolio_compliant, false, 'a non-compliant + not-evaluated repo keeps the portfolio non-green');
  assert.ok(report.repos.every((r) => r.integrity_ok), 'every real attestation verifies');
});

// ============================ 2. integrity gate ==============================

test('2: a tampered attestation => integrity_failed, excluded, portfolio false', () => {
  const dir = tmp('pr-tamper-');
  genInto(dir, 'acme', 'alpha', 'a'.repeat(40), '2.5.0', 'compliant');
  const gen = genInto(dir, 'acme', 'beta', 'b'.repeat(40), '2.5.0', 'compliant');
  // Mutate a field WITHOUT recomputing the integrity hash (real tamper).
  const j = JSON.parse(fs.readFileSync(gen.file, 'utf8'));
  j.status = 'compliant'; j.repo = 'attacker/beta';
  fs.writeFileSync(gen.file, JSON.stringify(j, null, 2));
  const { report } = rollup(dir);
  const tampered = report.repos.find((r) => r.repo === 'attacker/beta');
  assert.strictEqual(tampered.integrity_ok, false);
  assert.strictEqual(tampered.compliant, false, 'a failed-integrity attestation is never counted compliant');
  assert.strictEqual(report.summary.integrity_failed, 1);
  assert.strictEqual(report.summary.compliant, 1);
  assert.strictEqual(report.portfolio_compliant, false);
});

// ============================ 3. missing attestation gap =====================

test('3: a --fleet repo with no attestation => not-attested gap, never dropped', () => {
  const dir = tmp('pr-gap-');
  genInto(dir, 'acme', 'alpha', 'a'.repeat(40), '2.5.0', 'compliant');
  const fleet = path.join(dir, 'fleet.json');
  fs.writeFileSync(fleet, JSON.stringify({ org: 'acme', repos: [{ owner: 'acme', repo: 'alpha' }, { owner: 'acme', repo: 'ghost' }] }));
  const { report } = rollup(dir, ['--fleet', fleet]);
  const ghost = report.repos.find((r) => r.repo === 'acme/ghost');
  assert.ok(ghost, 'the unattested fleet repo is recorded, not omitted');
  assert.strictEqual(ghost.status, 'not-attested');
  assert.strictEqual(ghost.integrity_ok, false);
  assert.strictEqual(report.summary.not_attested, 1);
  assert.strictEqual(report.summary.total, 2);
  assert.strictEqual(report.portfolio_compliant, false);
});

// ============================ 4. version drift ===============================

test('4: version-drift behind/current/ahead/unknown via semverCompare', () => {
  assert.strictEqual(core.semverCompare('2.4.0', '2.5.0'), 'behind');
  assert.strictEqual(core.semverCompare('2.5.0', '2.5.0'), 'current');
  assert.strictEqual(core.semverCompare('2.6.0', '2.5.0'), 'ahead');
  assert.strictEqual(core.semverCompare('banana', '2.5.0'), 'unknown');
  assert.strictEqual(core.semverCompare(null, '2.5.0'), 'unknown');
  assert.strictEqual(core.semverCompare('2.5.0', undefined), 'unknown');

  const dir = tmp('pr-drift-');
  genInto(dir, 'acme', 'behind', 'a'.repeat(40), '2.4.9', 'compliant');
  genInto(dir, 'acme', 'current', 'b'.repeat(40), '2.5.0', 'compliant');
  genInto(dir, 'acme', 'ahead', 'c'.repeat(40), '3.0.0', 'compliant');
  const { report } = rollup(dir);
  const drift = Object.fromEntries(report.repos.map((r) => [r.repo, r.version_drift]));
  assert.strictEqual(drift['acme/behind'], 'behind');
  assert.strictEqual(drift['acme/current'], 'current');
  assert.strictEqual(drift['acme/ahead'], 'ahead');
  assert.strictEqual(report.summary.version_behind, 1);
  assert.strictEqual(report.summary.version_current, 1);
  assert.strictEqual(report.target_harness_version, '2.5.0');
});

test('4b: prerelease/garbage version => unknown (anchored semver); 2.10.0 > 2.5.0 numeric', () => {
  assert.strictEqual(core.semverCompare('2.5.0-rc1', '2.5.0'), 'unknown');
  assert.strictEqual(core.semverCompare('2.10.0', '2.5.0'), 'ahead');
  assert.strictEqual(core.semverCompare('2.5.0', '2.10.0'), 'behind');
});

test('4c: version buckets are exhaustive — current+behind+ahead+unknown === total', () => {
  const dir = tmp('pr-vbuckets-');
  genInto(dir, 'acme', 'cur', 'a'.repeat(40), '2.5.0', 'compliant');
  genInto(dir, 'acme', 'ahd', 'b'.repeat(40), '3.0.0', 'compliant');
  genInto(dir, 'acme', 'unk', 'c'.repeat(40), '2.5.0-rc1', 'compliant');
  const { report } = rollup(dir);
  const s = report.summary;
  assert.strictEqual(s.version_current, 1);
  assert.strictEqual(s.version_ahead, 1);
  assert.strictEqual(s.version_unknown, 1);
  assert.strictEqual(s.version_current + s.version_behind + s.version_ahead + s.version_unknown, s.total);
});

test('4d: same repo as a flat file AND a per-repo subdir dedups to ONE row', () => {
  const dir = tmp('pr-dedup-');
  const gen = genInto(dir, 'acme', 'dup', 'a'.repeat(40), '2.5.0', 'compliant'); // flat acme__dup.json
  const sub = path.join(dir, 'acme__dup');
  fs.mkdirSync(sub, { recursive: true });
  fs.copyFileSync(gen.file, path.join(sub, 'x.json'));
  fs.writeFileSync(path.join(sub, 'index.json'), JSON.stringify({
    entries: [{ commit_sha: 'a'.repeat(40), generated_at: NOW, path: 'x.json' }], integrity: { algo: 'sha256', hash: 'x' },
  }));
  const { report } = rollup(dir);
  assert.strictEqual(report.repos.filter((r) => r.repo === 'acme/dup').length, 1, 'flat + subdir dedup to one row');
  assert.strictEqual(report.summary.total, 1);
});

test('4e: a fleet repo whose file has a mismatched att.repo is not double-counted as not-attested', () => {
  const dir = tmp('pr-mismatch-');
  const gen = genInto(dir, 'acme', 'alpha', 'a'.repeat(40), '2.5.0', 'compliant');
  const j = JSON.parse(fs.readFileSync(gen.file, 'utf8'));
  j.repo = 'other/x'; // tamper the repo field (integrity now fails, but the file IS present)
  fs.writeFileSync(gen.file, JSON.stringify(j, null, 2));
  const fleet = path.join(dir, 'fleet.json');
  fs.writeFileSync(fleet, JSON.stringify({ repos: [{ owner: 'acme', repo: 'alpha' }] }));
  const { report } = rollup(dir, ['--fleet', fleet]);
  assert.ok(!report.repos.some((r) => r.status === 'not-attested'), 'the file is present by filename slug, so no not-attested gap');
  assert.strictEqual(report.summary.total, 1);
});

// ============================ 5. fail-safe portfolio_compliant ================

test('5: portfolio_compliant fail-safe — all-good true, any bad false, empty false', () => {
  const good = tmp('pr-good-');
  genInto(good, 'acme', 'a', 'a'.repeat(40), '2.5.0', 'compliant');
  genInto(good, 'acme', 'b', 'b'.repeat(40), '2.5.0', 'compliant');
  assert.strictEqual(rollup(good).report.portfolio_compliant, true);

  const bad = tmp('pr-bad-');
  genInto(bad, 'acme', 'a', 'a'.repeat(40), '2.5.0', 'compliant');
  genInto(bad, 'acme', 'b', 'b'.repeat(40), '2.5.0', 'notevaluated');
  assert.strictEqual(rollup(bad).report.portfolio_compliant, false);

  const empty = tmp('pr-empty-');
  const emptyReport = rollup(empty).report;
  assert.strictEqual(emptyReport.summary.total, 0);
  assert.strictEqual(emptyReport.portfolio_compliant, false, 'empty portfolio is not a vacuous green');
});

// default drift target: with no --target-version, uses the running harness
// version (project-manifest.json#harness_version, else package.json) — not the
// per-repo project version.
test('default target-version falls back to the running harness version', () => {
  const dir = tmp('pr-default-target-');
  const pm = readReport(path.join(H.REPO_ROOT, 'project-manifest.json'));
  const expected = pm.harness_version;
  genInto(dir, 'acme', 'a', 'a'.repeat(40), expected, 'compliant');
  const outFile = path.join(dir, 'rollup.json');
  capture(() => run([dir, '--out', outFile], { cwd: dir, now: () => NOW }));
  const report = readReport(outFile);
  assert.strictEqual(report.target_harness_version, expected);
  assert.strictEqual(report.repos[0].version_drift, 'current');
});

// ============================ 6. rollup integrity + --verify =================

test('6: the rollup output is integrity-hashed; --verify catches a mutation', () => {
  const dir = tmp('pr-verify-');
  genInto(dir, 'acme', 'a', 'a'.repeat(40), '2.5.0', 'compliant');
  const { report, outFile } = rollup(dir);
  assert.strictEqual(report.integrity.algo, 'sha256');
  assert.ok(report.integrity.hash);

  const ok = capture(() => run(['--verify', outFile], {}));
  assert.strictEqual(ok.code, 0, ok.stdout);

  const j = readReport(outFile);
  j.portfolio_compliant = true;
  j.summary.compliant = 999;
  fs.writeFileSync(outFile, JSON.stringify(j, null, 2));
  const bad = capture(() => run(['--verify', outFile], {}));
  assert.strictEqual(bad.code, 1);
  assert.match(bad.stdout, /MISMATCH/);
});
