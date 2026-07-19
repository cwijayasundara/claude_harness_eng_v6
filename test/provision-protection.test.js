'use strict';

// Branch-protection provisioner (Increment 2). All gh calls go through an
// arg-matching runner stub (the ghStub idiom from pr-poll.test.js) — no live
// network. The desired-ruleset builder output is round-tripped against the
// documented GitHub rulesets schema shape (a compliant live ruleset built FROM
// the builder must diff clean), never a hand-shaped fixture.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'provision-protection.js');
const {
  buildDesiredRuleset,
  planDiff,
  compareRulesets,
  computeDrift,
  run,
} = require(SCRIPT);

const GH = {
  org: 'o',
  default_branch: 'main',
  required_checks: ['gitleaks', 'sast'],
  required_approvals: 1,
  require_code_owner_review: true,
  enforce_admins: true,
  ruleset_scope: 'org',
  ruleset_name: 'harness-baseline-protection',
  target_repos: '~ALL',
  default_owners: [],
};

// A live ruleset that is fully compliant is exactly the builder output plus the
// server-assigned id — the "real shape" round-trip the design mandates.
function liveFromDesired(desired, id = 7) {
  return JSON.parse(JSON.stringify({ id, ...desired }));
}

// ghStub: arg-matching runner. Records every call for argv assertions. Routes
// are tried in order, so put the most specific needle first.
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

function mkProject(github) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-'));
  const manifest = { name: 'p', quality: { sensor_tier: 'strict' } };
  if (github !== undefined) manifest.github = github;
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

// --- C2 test 1: desired-ruleset builder shape (documented rulesets schema) ---

test('buildDesiredRuleset emits the documented GitHub rulesets payload shape', () => {
  const d = buildDesiredRuleset(GH);
  assert.strictEqual(d.name, 'harness-baseline-protection');
  assert.strictEqual(d.target, 'branch');
  assert.strictEqual(d.enforcement, 'active');
  assert.deepStrictEqual(d.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  assert.deepStrictEqual(d.conditions.ref_name.exclude, []);
  assert.deepStrictEqual(d.bypass_actors, []); // enforce_admins:true ⇒ no bypass

  const byType = Object.fromEntries(d.rules.map((r) => [r.type, r]));
  assert.strictEqual(byType.pull_request.parameters.required_approving_review_count, 1);
  assert.strictEqual(byType.pull_request.parameters.require_code_owner_review, true);
  assert.strictEqual(byType.pull_request.parameters.dismiss_stale_reviews_on_push, true);
  assert.strictEqual(byType.required_status_checks.parameters.strict_required_status_checks_policy, true);
  assert.deepStrictEqual(
    byType.required_status_checks.parameters.required_status_checks,
    [{ context: 'gitleaks' }, { context: 'sast' }],
  );
  assert.ok(byType.non_fast_forward, 'non_fast_forward rule present');
  assert.ok(byType.deletion, 'deletion rule present');
});

test('required_status_checks contexts are config-driven, not hardcoded literals', () => {
  const d = buildDesiredRuleset({ ...GH, required_checks: ['gitleaks', 'sast', 'codeql'] });
  const rsc = d.rules.find((r) => r.type === 'required_status_checks');
  assert.deepStrictEqual(rsc.parameters.required_status_checks.map((c) => c.context),
    ['gitleaks', 'sast', 'codeql']);
});

// --- C2 test 2: plan diff (create / update / compliant) -----------------------

test('planDiff: no live ruleset ⇒ create', () => {
  const d = buildDesiredRuleset(GH);
  assert.strictEqual(planDiff(d, null).action, 'create');
});

test('planDiff: a compliant live ruleset (real builder round-trip) ⇒ compliant', () => {
  const d = buildDesiredRuleset(GH);
  const res = planDiff(d, liveFromDesired(d));
  assert.strictEqual(res.action, 'compliant');
  assert.deepStrictEqual(res.changes, []);
});

test('planDiff: a drifted live ruleset ⇒ update with the changed fields', () => {
  const d = buildDesiredRuleset(GH);
  const live = liveFromDesired(d);
  live.rules.find((r) => r.type === 'pull_request').parameters.required_approving_review_count = 0;
  const res = planDiff(d, live);
  assert.strictEqual(res.action, 'update');
  assert.ok(res.changes.some((c) => c.field === 'required_approving_review_count'
    && String(c.actual) === '0' && String(c.expected) === '1'));
});

test('compareRulesets flags a non-active enforcement, missing check context, and a bypass actor', () => {
  const d = buildDesiredRuleset(GH);
  const live = liveFromDesired(d);
  live.enforcement = 'disabled';
  live.rules.find((r) => r.type === 'required_status_checks')
    .parameters.required_status_checks = [{ context: 'gitleaks' }]; // sast missing
  live.bypass_actors = [{ actor_id: 1, actor_type: 'Team' }];
  const drift = compareRulesets(d, live);
  const fields = drift.map((x) => x.field);
  assert.ok(fields.includes('enforcement'));
  assert.ok(fields.some((f) => f.includes('sast') || f === 'required_status_checks'));
  assert.ok(fields.includes('bypass_actors'));
});

test('compareRulesets flags a missing rule type (deletion removed) as drift', () => {
  const d = buildDesiredRuleset(GH);
  const live = liveFromDesired(d);
  live.rules = live.rules.filter((r) => r.type !== 'deletion');
  const drift = compareRulesets(d, live);
  assert.ok(drift.some((x) => x.rule === 'deletion' || x.field === 'deletion'));
});

// --- C2 test 3: apply idempotency (POST create vs PUT update argv) ------------

test('--apply with no existing ruleset POSTs to create (exact argv + JSON body via stdin)', () => {
  const dir = mkProject(GH);
  const calls = [];
  const runner = ghStub([
    ['--method POST', { id: 99 }],
    ['orgs/o/rulesets', []], // list: none exist
  ], calls);
  const res = capture(() => run(['--apply'], { cwd: dir, runner, env: {} }));
  assert.strictEqual(res.code, 0, res.stderr);
  const post = calls.find((c) => c.args.includes('POST'));
  assert.deepStrictEqual(post.args,
    ['api', '--method', 'POST', 'orgs/o/rulesets', '--input', '-']);
  const body = JSON.parse(post.input);
  assert.strictEqual(body.name, 'harness-baseline-protection');
  assert.strictEqual(body.enforcement, 'active');
});

test('--apply with an existing same-name ruleset PUTs to .../rulesets/{id} (idempotent update)', () => {
  const dir = mkProject(GH);
  const calls = [];
  const runner = ghStub([
    ['--method PUT', { id: 5 }],
    ['orgs/o/rulesets', [{ id: 5, name: 'harness-baseline-protection' }]],
  ], calls);
  const res = capture(() => run(['--apply'], { cwd: dir, runner, env: {} }));
  assert.strictEqual(res.code, 0, res.stderr);
  const put = calls.find((c) => c.args.includes('PUT'));
  assert.deepStrictEqual(put.args,
    ['api', '--method', 'PUT', 'orgs/o/rulesets/5', '--input', '-']);
  assert.ok(!calls.some((c) => c.args.includes('POST')), 'must not POST when updating');
});

test('--apply repo mode targets repos/{owner}/{repo}/rulesets for a --repo slug', () => {
  const dir = mkProject({ ...GH, org: '', ruleset_scope: 'repo' });
  const calls = [];
  const runner = ghStub([
    ['--method POST', { id: 1 }],
    ['repos/acme/widget/rulesets', []],
  ], calls);
  const res = capture(() => run(['--apply', '--repo', 'acme/widget'], { cwd: dir, runner, env: {} }));
  assert.strictEqual(res.code, 0, res.stderr);
  const post = calls.find((c) => c.args.includes('POST'));
  assert.deepStrictEqual(post.args,
    ['api', '--method', 'POST', 'repos/acme/widget/rulesets', '--input', '-']);
});

// --- C2 test 4: verify drift + exit codes ------------------------------------

test('--verify writes the report and exits 0 when the live ruleset is compliant', () => {
  const dir = mkProject(GH);
  const d = buildDesiredRuleset(GH);
  const runner = ghStub([
    ['rulesets/5', liveFromDesired(d, 5)],
    ['orgs/o/rulesets', [{ id: 5, name: 'harness-baseline-protection' }]],
  ]);
  const res = capture(() => run(['--verify'], { cwd: dir, runner, env: {} }));
  assert.strictEqual(res.code, 0, res.stderr);
  const report = JSON.parse(fs.readFileSync(
    path.join(dir, 'specs', 'reviews', 'branch-protection-verify.json'), 'utf8'));
  assert.strictEqual(report.compliant, true);
  assert.deepStrictEqual(report.drift, []);
});

test('--verify exits non-zero and records structured drift[] when the live ruleset drifted', () => {
  const dir = mkProject(GH);
  const d = buildDesiredRuleset(GH);
  const live = liveFromDesired(d, 5);
  live.enforcement = 'disabled';
  const runner = ghStub([
    ['rulesets/5', live],
    ['orgs/o/rulesets', [{ id: 5, name: 'harness-baseline-protection' }]],
  ]);
  const res = capture(() => run(['--verify'], { cwd: dir, runner, env: {} }));
  assert.notStrictEqual(res.code, 0);
  const report = JSON.parse(fs.readFileSync(
    path.join(dir, 'specs', 'reviews', 'branch-protection-verify.json'), 'utf8'));
  assert.strictEqual(report.compliant, false);
  assert.ok(report.drift.some((x) => x.field === 'enforcement'));
});

test('--verify treats a missing ruleset as drift and exits non-zero', () => {
  const dir = mkProject(GH);
  const runner = ghStub([['orgs/o/rulesets', []]]);
  const res = capture(() => run(['--verify'], { cwd: dir, runner, env: {} }));
  assert.notStrictEqual(res.code, 0);
  const report = JSON.parse(fs.readFileSync(
    path.join(dir, 'specs', 'reviews', 'branch-protection-verify.json'), 'utf8'));
  assert.strictEqual(report.compliant, false);
});

// --- C2 test 5: gh absent / error handling -----------------------------------

test('plan never errors on a gh failure (read-only preview, exit 0)', () => {
  const dir = mkProject(GH);
  const runner = () => { throw new Error('gh: command not found'); };
  const res = capture(() => run(['plan'], { cwd: dir, runner, env: {} }));
  assert.strictEqual(res.code, 0);
  assert.match(res.stdout + res.stderr, /gh/);
});

test('--apply fails loudly (exit 2) with a clear reason when gh is absent', () => {
  const dir = mkProject(GH);
  const runner = () => { throw new Error('gh: command not found'); };
  const res = capture(() => run(['--apply'], { cwd: dir, runner, env: {} }));
  assert.strictEqual(res.code, 2);
  assert.match(res.stderr, /gh/);
});

test('--verify fails loudly (exit 2) when gh is absent', () => {
  const dir = mkProject(GH);
  const runner = () => { throw new Error('gh: not authenticated'); };
  const res = capture(() => run(['--verify'], { cwd: dir, runner, env: {} }));
  assert.strictEqual(res.code, 2);
});

test('--apply fails (exit 2) when org is empty in org scope (no client literal to fall back on)', () => {
  const dir = mkProject({ ...GH, org: '' });
  const runner = () => { throw new Error('should not be called'); };
  const res = capture(() => run(['--apply'], { cwd: dir, runner, env: {} }));
  assert.strictEqual(res.code, 2);
  assert.match(res.stderr, /org/);
});

// --- C1: missing github section ----------------------------------------------

test('a missing github section ⇒ plan prints "not configured" and exits 0', () => {
  const dir = mkProject(undefined);
  const runner = () => { throw new Error('should not be called'); };
  const res = capture(() => run(['plan'], { cwd: dir, runner, env: {} }));
  assert.strictEqual(res.code, 0);
  assert.match(res.stdout, /not configured/i);
});

test('plan prints the org-admin note so an operator knows --apply needs elevated rights', () => {
  const dir = mkProject(GH);
  const runner = ghStub([['orgs/o/rulesets', []]]);
  const res = capture(() => run(['plan'], { cwd: dir, runner, env: {} }));
  assert.strictEqual(res.code, 0);
  assert.match(res.stdout, /org-admin|organization admin|admin/i);
});
