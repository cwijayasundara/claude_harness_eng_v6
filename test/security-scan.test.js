'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const lib = require(path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'security-scan.js'));

// Secret-shaped values are built at runtime (never as a literal) so this source
// file carries no real secret — otherwise the pre-write gate blocks the write.
const fakeAwsKey = 'AKIA' + 'ABCDEFGHIJKLMNOP';

test('severityRank orders every tool vocabulary consistently', () => {
  assert.ok(lib.severityRank('critical') > lib.severityRank('high'));
  assert.ok(lib.severityRank('high') > lib.severityRank('moderate'));
  assert.ok(lib.severityRank('moderate') > lib.severityRank('low'));
  assert.strictEqual(lib.severityRank('error'), lib.severityRank('high'));
  assert.strictEqual(lib.severityRank('unknown-grade'), 0);
});

test('normalizeGitleaks maps findings to the common shape', () => {
  const out = lib.normalizeGitleaks([
    { Description: 'AWS key', File: 'src/aws.js', StartLine: 12, RuleID: 'aws-access-key' },
  ]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(
    { tool: out[0].tool, severity: out[0].severity, file: out[0].file, line: out[0].line, rule: out[0].rule },
    { tool: 'gitleaks', severity: 'critical', file: 'src/aws.js', line: 12, rule: 'aws-access-key' }
  );
});

test('normalizeSemgrep reads nested path/start/extra fields', () => {
  const out = lib.normalizeSemgrep({
    results: [{ check_id: 'py.sqli', path: 'app/db.py', start: { line: 7 }, extra: { severity: 'ERROR', message: 'SQL injection' } }],
  });
  assert.strictEqual(out[0].tool, 'semgrep');
  assert.strictEqual(out[0].severity, 'error');
  assert.strictEqual(out[0].file, 'app/db.py');
  assert.strictEqual(out[0].line, 7);
  assert.match(out[0].message, /SQL injection/);
});

test('normalizeNpmAudit reads the v7+ vulnerabilities map', () => {
  const out = lib.normalizeNpmAudit({ vulnerabilities: { lodash: { name: 'lodash', severity: 'high' } } });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tool, 'npm-audit');
  assert.strictEqual(out[0].severity, 'high');
  assert.strictEqual(out[0].file, 'package.json');
});

test('normalizePipAudit handles both object and bare-array shapes', () => {
  const obj = lib.normalizePipAudit({ dependencies: [{ name: 'jinja2', version: '2.0', vulns: [{ id: 'CVE-2024-1' }] }] });
  const arr = lib.normalizePipAudit([{ name: 'flask', version: '1.0', vulns: [{ id: 'CVE-2024-2' }] }]);
  assert.strictEqual(obj[0].rule, 'CVE-2024-1');
  assert.strictEqual(obj[0].severity, 'high');
  assert.strictEqual(arr[0].tool, 'pip-audit');
  assert.match(arr[0].message, /flask/);
});

test('baselineSecretFindings flags a hardcoded key via the injected reader', () => {
  const files = ['src/config.js', 'README.md'];
  const reader = (f) => (f === 'src/config.js' ? `const k = "${fakeAwsKey}";` : '# docs only');
  const out = lib.baselineSecretFindings(files, reader);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].file, 'src/config.js');
  assert.strictEqual(out[0].severity, 'critical');
});

test('baselineSecretFindings skips files the reader cannot read', () => {
  const reader = () => { throw new Error('ENOENT'); };
  assert.deepStrictEqual(lib.baselineSecretFindings(['gone.js'], reader), []);
});

test('boundaryFiles keeps only security/data/network paths', () => {
  const files = ['src/auth/login.ts', 'src/utils/format.ts', 'src/api/payment.py', 'docs/readme.md'];
  const out = lib.boundaryFiles(files);
  assert.ok(out.includes('src/auth/login.ts'));
  assert.ok(out.includes('src/api/payment.py'));
  assert.ok(!out.includes('src/utils/format.ts'));
});

test('summarize keeps only findings at or above threshold', () => {
  const findings = [
    { severity: 'low', tool: 't', rule: 'r', file: 'f' },
    { severity: 'high', tool: 't', rule: 'r', file: 'f' },
    { severity: 'critical', tool: 't', rule: 'r', file: 'f' },
  ];
  const s = lib.summarize(findings, 'high');
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.blocking, 2);
  assert.ok(s.findings.every((f) => lib.severityRank(f.severity) >= lib.severityRank('high')));
});

test('renderFindings is LLM-legible (what / where) and handles empty', () => {
  assert.match(lib.renderFindings([]), /No security findings/);
  const txt = lib.renderFindings([{ severity: 'high', tool: 'semgrep', rule: 'py.sqli', file: 'db.py', line: 7, message: 'SQLi' }]);
  assert.match(txt, /\[high\] semgrep:py\.sqli/);
  assert.match(txt, /db\.py:7/);
});
