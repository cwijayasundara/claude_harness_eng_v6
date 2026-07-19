'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const lib = require(path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'security-baseline.js'));

// Secret-shaped strings are built at runtime so this source file carries no real
// secret (the pre-write gate would otherwise block it).
const fakeAwsKey = 'AKIA' + 'ABCDEFGHIJKLMNOP';

function secretFinding(over = {}) {
  return { tool: 'gitleaks', severity: 'critical', file: 'src/config.js', line: 3, rule: 'aws', message: 'secret', ...over };
}
function sastFinding(over = {}) {
  return { tool: 'semgrep', severity: 'high', file: 'app/db.py', line: 7, rule: 'py.sqli', message: 'SQLi', ...over };
}

test('partitionFindings splits secret tools from SAST tools', () => {
  const { secrets, sast } = lib.partitionFindings([
    secretFinding(), sastFinding(), { tool: 'secrets-regex', severity: 'critical', file: 'a', line: 1 },
  ]);
  assert.strictEqual(secrets.length, 2);
  assert.strictEqual(sast.length, 1);
});

test('sastKeys keeps only >= high findings, sorted and deduped', () => {
  const keys = lib.sastKeys([
    sastFinding({ severity: 'low' }),
    sastFinding({ rule: 'b', file: 'z.py', line: 2 }),
    sastFinding({ rule: 'a', file: 'a.py', line: 1 }),
    sastFinding({ rule: 'a', file: 'a.py', line: 1 }), // dup
  ]);
  assert.deepStrictEqual(keys, ['a:a.py:1', 'b:z.py:2']);
});

// Design test 1: a new secret finding blocks even when SAST count is unchanged.
test('a new secret finding blocks even when the SAST set is unchanged', () => {
  const d = lib.baselineDecision({
    findings: [secretFinding(), sastFinding()],
    prevKeys: ['py.sqli:app/db.py:7'], // SAST unchanged (still 1, in baseline)
  });
  assert.strictEqual(d.secretBlocked, true);
  assert.strictEqual(d.sastBlocked, false, 'SAST is unchanged, so only the secret blocks');
  assert.strictEqual(d.blocked, true);
});

// Design test 2: SAST grandfathering — a pre-existing high in the baseline does
// not block; a new one above baseline does.
test('a pre-existing high SAST finding is grandfathered; a new one blocks', () => {
  const grandfathered = lib.baselineDecision({
    findings: [sastFinding()],
    prevKeys: ['py.sqli:app/db.py:7'],
  });
  assert.strictEqual(grandfathered.blocked, false, 'the baseline finding must not block');

  const grown = lib.baselineDecision({
    findings: [sastFinding(), sastFinding({ rule: 'py.xss', file: 'app/view.py', line: 9 })],
    prevKeys: ['py.sqli:app/db.py:7'],
  });
  assert.strictEqual(grown.sastBlocked, true);
  assert.deepStrictEqual(grown.addedSast, ['py.xss:app/view.py:9'], 'only the newly-added key is named');
});

// Regression (CR-001): a count-neutral SWAP — fix one high/critical finding and
// introduce a different one — must block on the NEW key, not slip through a
// count-only ratchet and then grandfather the new vuln into the baseline.
test('a count-neutral SAST swap (fix one, add another) blocks on the new key', () => {
  const d = lib.baselineDecision({
    findings: [sastFinding({ rule: 'py.rce', file: 'app/exec.py', line: 3 })],
    prevKeys: ['py.sqli:app/db.py:7'], // count unchanged 1 -> 1, but a different key
  });
  assert.strictEqual(d.sastBlocked, true, 'a new key must block even when the count is unchanged');
  assert.deepStrictEqual(d.addedSast, ['py.rce:app/exec.py:3']);
  assert.strictEqual(d.blocked, true);
});

test('first run establishes the SAST baseline without blocking', () => {
  const d = lib.baselineDecision({ findings: [sastFinding()], prevKeys: undefined });
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.sastDecision.baselineRun, true);
});

// Design test 4: harness:secret-ok suppression still works through the gate.
test('harness:secret-ok on the source line suppresses a secret finding', () => {
  const readLine = () => `const k = "${fakeAwsKey}"; // harness:secret-ok`;
  const d = lib.baselineDecision({ findings: [secretFinding()], readLine });
  assert.strictEqual(d.secretBlocked, false, 'a marked line is not a blocking secret');
  assert.strictEqual(d.blockingSecrets.length, 0);
});

test('an unmarked secret line is not suppressed', () => {
  const readLine = () => `const k = "${fakeAwsKey}";`;
  const d = lib.baselineDecision({ findings: [secretFinding()], readLine });
  assert.strictEqual(d.secretBlocked, true);
});

test('a secret finding with no line number is kept (regex tier already suppressed marked lines)', () => {
  const d = lib.baselineDecision({ findings: [secretFinding({ tool: 'secrets-regex', line: null })] });
  assert.strictEqual(d.secretBlocked, true);
});

// --- C3 wiring invariant -----------------------------------------------------

const GOOD_WORKFLOW = [
  'name: Security',
  'on:',
  '  pull_request:',
  'jobs:',
  '  gitleaks:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: gitleaks/gitleaks-action@v2',
  '  sast:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: semgrep ci --error',
  '',
].join('\n');

test('parseWorkflowJobs finds top-level jobs and continue-on-error downgrades', () => {
  const jobs = lib.parseWorkflowJobs(GOOD_WORKFLOW);
  assert.ok(jobs.gitleaks && jobs.sast);
  assert.strictEqual(jobs.gitleaks.continueOnError, false);
});

// Design test 5: each downgrade/absence blocks.
test('wiringViolations passes a correctly-wired baseline', () => {
  const v = lib.wiringViolations({ workflowText: GOOD_WORKFLOW, gitleaksTomlExists: true, sastEngine: 'semgrep' });
  assert.deepStrictEqual(v, []);
});

test('wiringViolations flags a deleted security.yml', () => {
  const v = lib.wiringViolations({ workflowText: null, gitleaksTomlExists: true, sastEngine: 'semgrep' });
  assert.ok(v.some((x) => /security\.yml is absent/.test(x)));
});

test('wiringViolations flags a continue-on-error (non-blocking) sast job', () => {
  const downgraded = GOOD_WORKFLOW.replace('  sast:\n', '  sast:\n    continue-on-error: true\n');
  const v = lib.wiringViolations({ workflowText: downgraded, gitleaksTomlExists: true, sastEngine: 'semgrep' });
  assert.ok(v.some((x) => /sast.*non-blocking/.test(x)));
});

// VULN-002: name-only wiring is evadable. A job that is present but gated off,
// gutted, or soft-failed via a quoted/expression continue-on-error must all flag.
test('wiringViolations flags a job-level if: (job can be gated off in CI)', () => {
  const gated = GOOD_WORKFLOW.replace('  sast:\n', '  sast:\n    if: false\n');
  const v = lib.wiringViolations({ workflowText: gated, gitleaksTomlExists: true, sastEngine: 'semgrep' });
  assert.ok(v.some((x) => /sast.*(conditional|if:)/i.test(x)), `expected an if: violation, got ${JSON.stringify(v)}`);
});

test('wiringViolations flags a gutted sast job that never invokes the scanner', () => {
  const gutted = GOOD_WORKFLOW.replace('      - run: semgrep ci --error', "      - run: 'true'");
  const v = lib.wiringViolations({ workflowText: gutted, gitleaksTomlExists: true, sastEngine: 'semgrep' });
  assert.ok(v.some((x) => /sast.*(does not|invoke|scanner)/i.test(x)), `expected a scanner-invocation violation, got ${JSON.stringify(v)}`);
});

test('wiringViolations flags a quoted continue-on-error downgrade', () => {
  const quoted = GOOD_WORKFLOW.replace('  sast:\n', '  sast:\n    continue-on-error: "true"\n');
  const v = lib.wiringViolations({ workflowText: quoted, gitleaksTomlExists: true, sastEngine: 'semgrep' });
  assert.ok(v.some((x) => /sast.*non-blocking/.test(x)), `expected a continue-on-error violation, got ${JSON.stringify(v)}`);
});

test('wiringViolations flags a missing gitleaks job', () => {
  const noGitleaks = GOOD_WORKFLOW.replace(/  gitleaks:\n(    .*\n)+/, '');
  const v = lib.wiringViolations({ workflowText: noGitleaks, gitleaksTomlExists: true, sastEngine: 'semgrep' });
  assert.ok(v.some((x) => /missing a blocking "gitleaks" job/.test(x)));
});

test('wiringViolations flags a missing .gitleaks.toml', () => {
  const v = lib.wiringViolations({ workflowText: GOOD_WORKFLOW, gitleaksTomlExists: false, sastEngine: 'semgrep' });
  assert.ok(v.some((x) => /\.gitleaks\.toml is absent/.test(x)));
});

// VULN-003: a catch-all allowlist neuters gitleaks while the file still exists.
test('wiringViolations flags a catch-all .gitleaks.toml allowlist', () => {
  const catchAll = "[allowlist]\npaths = [\n  '''.*''',\n]\n";
  const v = lib.wiringViolations({ workflowText: GOOD_WORKFLOW, gitleaksTomlExists: true, gitleaksTomlText: catchAll, sastEngine: 'semgrep' });
  assert.ok(v.some((x) => /catch-all allowlist/.test(x)), `expected a catch-all violation, got ${JSON.stringify(v)}`);
});

test('wiringViolations accepts a narrow (fixture-only) allowlist', () => {
  const narrow = "[allowlist]\npaths = [\n  '''(^|/)test/fixtures/''',\n]\n";
  const v = lib.wiringViolations({ workflowText: GOOD_WORKFLOW, gitleaksTomlExists: true, gitleaksTomlText: narrow, sastEngine: 'semgrep' });
  assert.deepStrictEqual(v, []);
});

test('wiringViolations flags an unset/invalid sast_engine', () => {
  const v = lib.wiringViolations({ workflowText: GOOD_WORKFLOW, gitleaksTomlExists: true, sastEngine: undefined });
  assert.ok(v.some((x) => /sast_engine is unset/.test(x)));
});

// --- C4: deploy-approval environment wiring ----------------------------------

const fs = require('fs');
// The REAL deploy.yml skeleton, env-stamped as materializeDeployWorkflow does.
const DEPLOY_TEMPLATE = fs.readFileSync(
  path.resolve(__dirname, '..', '.claude', 'templates', 'github-workflows', 'deploy.yml'), 'utf8');
function renderDeploy(envName) {
  return DEPLOY_TEMPLATE.replace(/^(\s*environment:\s*).*$/m, `$1${envName}`);
}
const CLEAN = { workflowText: GOOD_WORKFLOW, gitleaksTomlExists: true, sastEngine: 'semgrep' };

test('deployEnvironmentRefs reads a scalar environment: reference from the real skeleton', () => {
  assert.deepStrictEqual(lib.deployEnvironmentRefs(renderDeploy('production')), ['production']);
});

test('deployEnvironmentRefs reads a mapping-form environment: name reference', () => {
  const text = 'jobs:\n  deploy:\n    environment:\n      name: staging\n    steps: []\n';
  assert.deepStrictEqual(lib.deployEnvironmentRefs(text), ['staging']);
});

test('deployEnvironmentRefs strips a trailing inline YAML comment (scalar and mapping)', () => {
  assert.deepStrictEqual(lib.deployEnvironmentRefs('    environment: production # deploy gate\n'), ['production']);
  const mapping = 'jobs:\n  deploy:\n    environment:\n      name: staging  # gate\n    steps: []\n';
  assert.deepStrictEqual(lib.deployEnvironmentRefs(mapping), ['staging']);
});

test('C4: a configured env named in deploy.yml with an inline comment still matches (no false violation)', () => {
  const withComment = renderDeploy('production').replace('environment: production', 'environment: production # prod gate');
  const v = lib.wiringViolations({ ...CLEAN, environments: ['production'], deployWorkflowText: withComment });
  assert.deepStrictEqual(v, []);
});

test('C4: no environments configured ⇒ no deploy-wiring requirement', () => {
  assert.deepStrictEqual(lib.wiringViolations({ ...CLEAN, environments: [] }), []);
  assert.deepStrictEqual(lib.wiringViolations({ ...CLEAN, environments: undefined }), []);
});

test('C4: environments configured + deploy.yml absent ⇒ violation', () => {
  const v = lib.wiringViolations({ ...CLEAN, environments: ['production'], deployWorkflowText: null });
  assert.ok(v.some((x) => /deploy\.yml is absent/.test(x)), JSON.stringify(v));
});

test('C4: environments configured + deploy.yml references a DIFFERENT env ⇒ violation', () => {
  const v = lib.wiringViolations({ ...CLEAN, environments: ['production'], deployWorkflowText: renderDeploy('staging') });
  assert.ok(v.some((x) => /does not reference a configured environment/.test(x)), JSON.stringify(v));
});

test('C4: environments configured + real deploy.yml referencing a configured env ⇒ clean', () => {
  const v = lib.wiringViolations({ ...CLEAN, environments: ['production'], deployWorkflowText: renderDeploy('production') });
  assert.deepStrictEqual(v, []);
});

test('C4: the deploy requirement does not regress the Increment-1 checks (both fire together)', () => {
  const v = lib.wiringViolations({ workflowText: null, gitleaksTomlExists: false, sastEngine: 'semgrep', environments: ['production'], deployWorkflowText: null });
  assert.ok(v.some((x) => /security\.yml is absent/.test(x)), 'Increment-1 check still fires');
  assert.ok(v.some((x) => /\.gitleaks\.toml is absent/.test(x)), 'Increment-1 check still fires');
  assert.ok(v.some((x) => /deploy\.yml is absent/.test(x)), 'Increment-3 check also fires');
});
