'use strict';

// Deployment-approval Environments provisioner (Increment 3). All gh calls go
// through an arg-matching runner stub (the ghStub idiom) — no live network. The
// desired-environment builder output is round-tripped against the documented
// GitHub Environments API shape (a compliant live env built FROM the builder
// diffs clean), never a hand-shaped fixture.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'provision-environments.js');
const { buildDesiredEnvironment, run } = require(SCRIPT);
const { planDiff, computeDrift, compareEnvironment } = require('../.claude/scripts/env-diff');

const PROD = { name: 'production', reviewers: [], wait_timer: 0, protected_branches: true };

// A flat body (the PUT/canonical shape) — used only for the PURE env-diff unit
// tests (planDiff/computeDrift operate on the normalized flat shape).
function liveFromDesired(desired) {
  return JSON.parse(JSON.stringify(desired));
}

// The REAL GitHub "Get an environment" response shape: reviewers/wait_timer nested
// under protection_rules[] (reviewer.id nested), deployment_branch_policy top-level.
// The end-to-end verify path must be exercised against THIS, not the flat body —
// otherwise the GET-shape normalization bug (CR-001/ENV-001) stays hidden.
function liveGetShape(desired) {
  const rules = [];
  if (desired.wait_timer) rules.push({ id: 1, type: 'wait_timer', wait_timer: desired.wait_timer });
  if ((desired.reviewers || []).length) {
    rules.push({
      id: 2, type: 'required_reviewers',
      reviewers: desired.reviewers.map((r) => ({ type: r.type, reviewer: { id: r.id } })),
    });
  }
  return { name: desired.name, protection_rules: rules, deployment_branch_policy: desired.deployment_branch_policy };
}

function ghStub(routes, calls) {
  return (args, input) => {
    if (calls) calls.push({ args: [...args], input });
    const key = args.join(' ');
    for (const [needle, out] of routes) {
      if (key.includes(needle)) {
        if (out instanceof Error) throw out;
        return typeof out === 'string' ? out : JSON.stringify(out);
      }
    }
    throw new Error(`unexpected gh call: ${key}`);
  };
}

function mkProject(environments) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provenv-'));
  const manifest = { name: 'p', quality: { sensor_tier: 'strict' }, github: { org: 'o' } };
  if (environments !== undefined) manifest.github.environments = environments;
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

function capture(fn) {
  const out = { stdout: '', stderr: '' };
  const ow = process.stdout.write;
  const oe = process.stderr.write;
  process.stdout.write = (c) => { out.stdout += c; return true; };
  process.stderr.write = (c) => { out.stderr += c; return true; };
  try { out.code = fn(); } finally {
    process.stdout.write = ow;
    process.stderr.write = oe;
  }
  return out;
}

const CONFIGURED = [{ name: 'production', reviewers: [{ type: 'Team', id: 42 }], wait_timer: 5, protected_branches: true }];

// --- test 1: desired body shape (documented Environments API) ----------------

test('buildDesiredEnvironment emits the documented Environments PUT body shape', () => {
  const d = buildDesiredEnvironment(CONFIGURED[0]);
  assert.strictEqual(d.name, 'production');
  assert.strictEqual(d.wait_timer, 5);
  assert.deepStrictEqual(d.reviewers, [{ type: 'Team', id: 42 }]);
  assert.deepStrictEqual(d.deployment_branch_policy, { protected_branches: true, custom_branch_policies: false });
});

test('buildDesiredEnvironment applies per-field defaults (empty reviewers, wait_timer 0, protected true)', () => {
  const d = buildDesiredEnvironment(PROD);
  assert.deepStrictEqual(d.reviewers, []);
  assert.strictEqual(d.wait_timer, 0);
  assert.strictEqual(d.deployment_branch_policy.protected_branches, true);
});

// --- test 2: plan diff (create / update / compliant) -------------------------

test('planDiff: no live environment ⇒ create', () => {
  assert.strictEqual(planDiff(buildDesiredEnvironment(CONFIGURED[0]), null).action, 'create');
});

test('planDiff: a compliant live env (real builder round-trip) ⇒ compliant', () => {
  const d = buildDesiredEnvironment(CONFIGURED[0]);
  const res = planDiff(d, liveFromDesired(d));
  assert.strictEqual(res.action, 'compliant');
  assert.deepStrictEqual(res.changes, []);
});

test('planDiff: a drifted live env ⇒ update with the changed fields', () => {
  const d = buildDesiredEnvironment(CONFIGURED[0]);
  const live = liveFromDesired(d);
  live.wait_timer = 0;
  live.reviewers = [];
  const res = planDiff(d, live);
  assert.strictEqual(res.action, 'update');
  const fields = res.changes.map((c) => c.field);
  assert.ok(fields.includes('wait_timer'));
  assert.ok(fields.includes('reviewers'));
});

// --- test 3: apply argv + body, idempotency, repo-scoped exit 2 --------------

test('--apply PUTs the environment with exact argv + documented JSON body per environment', () => {
  const dir = mkProject(CONFIGURED);
  const calls = [];
  const runner = ghStub([['--method PUT', { name: 'production' }]], calls);
  const res = capture(() => run(['--apply', '--repo', 'acme/widget'], { cwd: dir, runner }));
  assert.strictEqual(res.code, 0, res.stderr);
  const put = calls.find((c) => c.args.includes('PUT'));
  assert.deepStrictEqual(put.args,
    ['api', '--method', 'PUT', 'repos/acme/widget/environments/production', '--input', '-']);
  const body = JSON.parse(put.input);
  assert.strictEqual(body.wait_timer, 5);
  assert.deepStrictEqual(body.reviewers, [{ type: 'Team', id: 42 }]);
  assert.deepStrictEqual(body.deployment_branch_policy, { protected_branches: true, custom_branch_policies: false });
});

test('--apply is idempotent: re-running issues the same PUT (no POST/PUT split)', () => {
  const dir = mkProject(CONFIGURED);
  const calls = [];
  const runner = ghStub([['--method PUT', { name: 'production' }]], calls);
  capture(() => run(['--apply', '--repo', 'acme/widget'], { cwd: dir, runner }));
  capture(() => run(['--apply', '--repo', 'acme/widget'], { cwd: dir, runner }));
  assert.strictEqual(calls.filter((c) => c.args.includes('PUT')).length, 2);
  assert.ok(!calls.some((c) => c.args.includes('POST')), 'environments use idempotent PUT only');
});

test('--apply with neither --repo nor --fleet exits 2 (environments are repo-scoped)', () => {
  const dir = mkProject(CONFIGURED);
  const runner = () => { throw new Error('should not be called'); };
  const res = capture(() => run(['--apply'], { cwd: dir, runner }));
  assert.strictEqual(res.code, 2);
  assert.match(res.stderr, /repo-scoped|--repo|--fleet/);
});

test('--apply with empty reviewers ⇒ exit 3 (provisioned but not gating) + loud ACTION-REQUIRED notice', () => {
  const dir = mkProject([PROD]);
  const calls = [];
  const runner = ghStub([['--method PUT', { name: 'production' }]], calls);
  const res = capture(() => run(['--apply', '--repo', 'acme/widget'], { cwd: dir, runner }));
  assert.strictEqual(res.code, 3, res.stderr); // distinct from 0 (gating) and 2 (error)
  assert.match(res.stderr, /ACTION REQUIRED/);
  assert.match(res.stderr, /NOT GATING/);
});

test('--apply --fleet provisions each repo in the registry', () => {
  const dir = mkProject(CONFIGURED);
  const fleet = path.join(dir, 'fleet.json');
  fs.writeFileSync(fleet, JSON.stringify({ repos: [{ owner: 'acme', repo: 'a' }, { owner: 'acme', repo: 'b' }] }));
  const calls = [];
  const runner = ghStub([['--method PUT', { name: 'production' }]], calls);
  const res = capture(() => run(['--apply', '--fleet', fleet], { cwd: dir, runner }));
  assert.strictEqual(res.code, 0, res.stderr);
  const paths = calls.filter((c) => c.args.includes('PUT')).map((c) => c.args[3]);
  assert.deepStrictEqual(paths.sort(),
    ['repos/acme/a/environments/production', 'repos/acme/b/environments/production']);
});

// --- test 4: verify drift + approval-gate floor ------------------------------

test('--verify writes the report and exits 0 when the live env is fully compliant (real GET shape)', () => {
  const dir = mkProject(CONFIGURED);
  const d = buildDesiredEnvironment(CONFIGURED[0]);
  // The stub returns the REAL nested GET shape — without normalization the nested
  // required_reviewers read as [] and the floor would (wrongly) fire.
  const runner = ghStub([['environments/production', liveGetShape(d)]]);
  const res = capture(() => run(['--verify', '--repo', 'acme/widget'], { cwd: dir, runner }));
  assert.strictEqual(res.code, 0, res.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'deploy-gate-verify.json'), 'utf8'));
  assert.strictEqual(report.compliant, true);
  assert.strictEqual(report.environments[0].compliant, true);
});

test('--verify: empty live reviewers ⇒ non-compliant regardless of config (approval-gate floor)', () => {
  // A real GET-shaped env with NO required_reviewers rule must fail verify.
  const dir = mkProject([PROD]);
  const d = buildDesiredEnvironment(PROD);
  const runner = ghStub([['environments/production', liveGetShape(d)]]);
  const res = capture(() => run(['--verify', '--repo', 'acme/widget'], { cwd: dir, runner }));
  assert.notStrictEqual(res.code, 0);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'deploy-gate-verify.json'), 'utf8'));
  assert.strictEqual(report.compliant, false);
  assert.ok(report.environments[0].drift.some((x) => /reviewers/.test(x.field)));
});

test('--verify: live protected_branches false ⇒ drift + non-zero exit', () => {
  const dir = mkProject(CONFIGURED);
  const d = buildDesiredEnvironment(CONFIGURED[0]);
  const live = liveGetShape(d);
  live.deployment_branch_policy.protected_branches = false;
  const runner = ghStub([['environments/production', live]]);
  const res = capture(() => run(['--verify', '--repo', 'acme/widget'], { cwd: dir, runner }));
  assert.notStrictEqual(res.code, 0);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'deploy-gate-verify.json'), 'utf8'));
  assert.ok(report.environments[0].drift.some((x) => /protected_branches/.test(x.field)));
});

test('--verify: an absent live environment is drift (exit non-zero)', () => {
  const dir = mkProject(CONFIGURED);
  const runner = ghStub([['environments/production', new Error('HTTP 404: Not Found')]]);
  const res = capture(() => run(['--verify', '--repo', 'acme/widget'], { cwd: dir, runner }));
  assert.notStrictEqual(res.code, 0);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'deploy-gate-verify.json'), 'utf8'));
  assert.strictEqual(report.compliant, false);
});

// --- test 5: reviewer validation ---------------------------------------------

test('--apply with a malformed reviewer id (non-integer) exits 2, never silently dropped', () => {
  const dir = mkProject([{ name: 'production', reviewers: [{ type: 'User', id: 'me' }], protected_branches: true }]);
  const runner = () => { throw new Error('should not be called'); };
  const res = capture(() => run(['--apply', '--repo', 'acme/widget'], { cwd: dir, runner }));
  assert.strictEqual(res.code, 2);
  assert.match(res.stderr, /reviewer id/);
});

test('--verify with a bad reviewer type exits 2', () => {
  const dir = mkProject([{ name: 'production', reviewers: [{ type: 'Robot', id: 1 }], protected_branches: true }]);
  const runner = () => { throw new Error('should not be called'); };
  const res = capture(() => run(['--verify', '--repo', 'acme/widget'], { cwd: dir, runner }));
  assert.strictEqual(res.code, 2);
  assert.match(res.stderr, /reviewer type/);
});

// --- test 6: gh absent / no config -------------------------------------------

test('plan never errors on a gh failure (read-only preview, exit 0)', () => {
  const dir = mkProject(CONFIGURED);
  const runner = () => { throw new Error('gh: command not found'); };
  const res = capture(() => run(['plan', '--repo', 'acme/widget'], { cwd: dir, runner }));
  assert.strictEqual(res.code, 0);
});

test('--apply fails loudly (exit 2) with a clear reason when gh is absent', () => {
  const dir = mkProject(CONFIGURED);
  const runner = () => { throw new Error('gh: command not found'); };
  const res = capture(() => run(['--apply', '--repo', 'acme/widget'], { cwd: dir, runner }));
  assert.strictEqual(res.code, 2);
  assert.match(res.stderr, /gh/);
});

test('--verify fails loudly (exit 2) when gh errors (auth), not a 404', () => {
  const dir = mkProject(CONFIGURED);
  const runner = () => { throw new Error('gh: not authenticated'); };
  const res = capture(() => run(['--verify', '--repo', 'acme/widget'], { cwd: dir, runner }));
  assert.strictEqual(res.code, 2);
});

test('no environments configured ⇒ prints "no environments configured" and exits 0', () => {
  const dir = mkProject(undefined);
  const runner = () => { throw new Error('should not be called'); };
  const res = capture(() => run(['plan'], { cwd: dir, runner }));
  assert.strictEqual(res.code, 0);
  assert.match(res.stdout, /no environments configured/i);
});

test('empty environments array ⇒ exits 0 with the no-op message', () => {
  const dir = mkProject([]);
  const res = capture(() => run(['--apply', '--repo', 'acme/widget'], { cwd: dir, runner: () => { throw new Error('nope'); } }));
  assert.strictEqual(res.code, 0);
  assert.match(res.stdout, /no environments configured/i);
});

// --- env-diff floor unit ------------------------------------------------------

test('computeDrift applies the floor even when a config-vs-live compare is clean', () => {
  const d = buildDesiredEnvironment(PROD); // reviewers:[]
  const { compliant, drift } = computeDrift(d, liveFromDesired(d));
  assert.strictEqual(compliant, false);
  assert.ok(drift.some((x) => /reviewers/.test(x.field)));
  assert.deepStrictEqual(compareEnvironment(d, liveFromDesired(d)), []); // config diff alone is clean
});
