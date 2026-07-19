'use strict';

// Whole-branch-review hardening for the branch-protection provisioner (Increment 2):
// CR-001 org-scope repository targeting, VULN-001 security floor, VULN-002 verify
// against the floor, CR-003 pagination, VULN-004 API-path validation. All gh calls
// go through an arg-matching stub — no live network.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'provision-protection.js');
const { buildDesiredRuleset, computeDrift, run } = require(SCRIPT);

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

function repoName(d) { return d.conditions.repository_name; }
function checks(d) {
  return d.rules.find((r) => r.type === 'required_status_checks').parameters.required_status_checks.map((c) => c.context);
}
function approvals(d) {
  return d.rules.find((r) => r.type === 'pull_request').parameters.required_approving_review_count;
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

function mkProject(github) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-hard-'));
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

// --- CR-001: org scope carries repository_name; repo scope omits it -----------

test('CR-001: org-scope ruleset includes conditions.repository_name.include = [target_repos]', () => {
  const d = buildDesiredRuleset(GH, { orgScope: true });
  assert.ok(repoName(d), 'org-scope ruleset must carry a repository_name target (GitHub 422s without it)');
  assert.deepStrictEqual(repoName(d).include, ['~ALL']);
});

test('CR-001: a custom target_repos pattern flows into repository_name.include', () => {
  const d = buildDesiredRuleset({ ...GH, target_repos: 'service-*' }, { orgScope: true });
  assert.deepStrictEqual(repoName(d).include, ['service-*']);
});

test('CR-001: repo-scope ruleset OMITS repository_name (repo rulesets 422 if present)', () => {
  const d = buildDesiredRuleset(GH, { orgScope: false });
  assert.strictEqual(repoName(d), undefined);
});

test('CR-001: default scope follows ruleset_scope config (org ⇒ present, repo ⇒ absent)', () => {
  assert.ok(repoName(buildDesiredRuleset({ ...GH, ruleset_scope: 'org' })));
  assert.strictEqual(repoName(buildDesiredRuleset({ ...GH, ruleset_scope: 'repo' })), undefined);
});

test('CR-001: org --apply POST body carries repository_name; --repo body does not', () => {
  const dirOrg = mkProject(GH);
  const orgCalls = [];
  run(['--apply'], {
    cwd: dirOrg,
    runner: ghStub([['--method POST', { id: 1 }], ['orgs/o/rulesets', []]], orgCalls),
  });
  const orgBody = JSON.parse(orgCalls.find((c) => c.args.includes('POST')).input);
  assert.ok(orgBody.conditions.repository_name, 'org apply body must target repositories');

  const dirRepo = mkProject({ ...GH, org: '', ruleset_scope: 'repo' });
  const repoCalls = [];
  run(['--apply', '--repo', 'acme/widget'], {
    cwd: dirRepo,
    runner: ghStub([['--method POST', { id: 1 }], ['repos/acme/widget/rulesets', []]], repoCalls),
  });
  const repoBody = JSON.parse(repoCalls.find((c) => c.args.includes('POST')).input);
  assert.strictEqual(repoBody.conditions.repository_name, undefined, 'repo apply body must NOT target repositories');
});

test('CR-001: compareRulesets/computeDrift flag a wrong repository_name target as drift', () => {
  const d = buildDesiredRuleset(GH, { orgScope: true });
  const live = JSON.parse(JSON.stringify({ id: 5, ...d }));
  live.conditions.repository_name.include = ['only-one-repo'];
  const res = computeDrift(d, live);
  assert.strictEqual(res.compliant, false);
  assert.ok(res.drift.some((x) => x.field === 'repository_name.include'));
});

// --- VULN-001: security floor is not config-overridable -----------------------

test('VULN-001: a weak config (required_checks:[build], approvals:0) still requires gitleaks+sast and >=1 approval', () => {
  const d = buildDesiredRuleset({ ...GH, required_checks: ['build'], required_approvals: 0 }, { orgScope: true });
  const ctx = checks(d);
  assert.ok(ctx.includes('gitleaks') && ctx.includes('sast'), 'gitleaks+sast are an absolute floor');
  assert.ok(ctx.includes('build'), 'config checks are additive');
  assert.strictEqual(approvals(d), 1, 'approvals clamp to >=1');
});

test('VULN-001: empty/unset required_checks still yields gitleaks+sast', () => {
  assert.deepStrictEqual(checks(buildDesiredRuleset({ ...GH, required_checks: [] }, { orgScope: true })).sort(), ['gitleaks', 'sast']);
  assert.deepStrictEqual(checks(buildDesiredRuleset({ ...GH, required_checks: undefined }, { orgScope: true })).sort(), ['gitleaks', 'sast']);
});

// --- VULN-002: verify anchors to the floor, not just config -------------------

test('VULN-002: a weak-by-config live ruleset is reported DRIFTED, not compliant', () => {
  const dir = mkProject({ ...GH, required_checks: ['build'], required_approvals: 0 });
  const d = buildDesiredRuleset({ ...GH, required_checks: ['build'], required_approvals: 0 }, { orgScope: true });
  const weakLive = JSON.parse(JSON.stringify({ id: 5, ...d }));
  weakLive.rules.find((r) => r.type === 'required_status_checks').parameters.required_status_checks = [{ context: 'build' }];
  weakLive.rules.find((r) => r.type === 'pull_request').parameters.required_approving_review_count = 0;
  const runner = ghStub([
    ['rulesets/5', weakLive],
    ['orgs/o/rulesets', [{ id: 5, name: 'harness-baseline-protection' }]],
  ]);
  const res = capture(() => run(['--verify'], { cwd: dir, runner }));
  assert.notStrictEqual(res.code, 0, 'verify must NOT pass a ruleset missing the gitleaks+sast floor');
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'branch-protection-verify.json'), 'utf8'));
  assert.strictEqual(report.compliant, false);
  assert.ok(report.drift.some((x) => x.rule === 'required_status_checks'));
});

// --- CR-003: ruleset listing is paginated -------------------------------------

test('CR-003: the ruleset-list call passes --paginate (idempotency holds past page 1)', () => {
  const dir = mkProject(GH);
  const calls = [];
  run(['--apply'], {
    cwd: dir,
    runner: ghStub([['--method PUT', { id: 9 }], ['orgs/o/rulesets', [{ id: 9, name: 'harness-baseline-protection' }]]], calls),
  });
  const list = calls.find((c) => c.args.includes('--paginate'));
  assert.ok(list, 'the rulesets list call must use --paginate');
  assert.deepStrictEqual(list.args, ['api', '--paginate', 'orgs/o/rulesets']);
});

// --- VULN-004: API-path segment validation ------------------------------------

test('VULN-004: an org value with path traversal is rejected (exit 2, no gh call)', () => {
  const dir = mkProject({ ...GH, org: '../../orgs/other' });
  const runner = () => { throw new Error('gh must not be called with a traversal org'); };
  const res = capture(() => run(['--apply'], { cwd: dir, runner }));
  assert.strictEqual(res.code, 2);
  assert.match(res.stderr, /invalid org/);
});

test('VULN-004: a --repo slug with an extra segment is rejected', () => {
  const dir = mkProject({ ...GH, org: '', ruleset_scope: 'repo' });
  const runner = () => { throw new Error('gh must not be called with a bad repo slug'); };
  const res = capture(() => run(['--apply', '--repo', 'a/b/c'], { cwd: dir, runner }));
  assert.strictEqual(res.code, 2);
  assert.match(res.stderr, /invalid repo/);
});
