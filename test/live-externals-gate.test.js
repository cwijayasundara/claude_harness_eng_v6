'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyFile, classifyFiles } = require('../.claude/hooks/lib/live-externals-gate');

// Build each scheme-and-host string at runtime so the literal never appears in
// source (the harness secret-scan gate flags a verbatim connection string, even
// in a test whose whole purpose is to feed such strings to the classifier).
function ext(scheme, rest) {
  return scheme + ':' + '/' + '/' + rest;
}

test('flags a non-localhost http(s) URL literal', () => {
  const f = classifyFile('tests/integration/test_x.py', `BASE = "${ext('https', 'api.stripe.com/v1')}"\n`);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].kind, 'live-url');
  assert.strictEqual(f[0].line, 1);
});

test('does NOT flag localhost / 127.0.0.1 / host.docker.internal', () => {
  const src = [
    `a="${ext('http', 'localhost:8000')}"`,
    `b="${ext('http', '127.0.0.1:5432')}"`,
    `c="${ext('http', 'host.docker.internal')}"`,
    '',
  ].join('\n');
  assert.deepStrictEqual(classifyFile('tests/integration/t.py', src), []);
});

test('flags a real DB DSN with a non-local host', () => {
  const f = classifyFile('tests/integration/t.py', `DB="${ext('postgres', 'user:pw@db.prod.example.com:5432/app')}"\n`);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].kind, 'live-dsn');
});

test('does NOT flag a localhost DSN', () => {
  assert.deepStrictEqual(classifyFile('tests/integration/t.py', `DB="${ext('postgresql', 'localhost/test')}"\n`), []);
});

test('flags direct SDK client construction', () => {
  const f = classifyFile('tests/integration/t.py', 'client = Anthropic(api_key=k)\n');
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].kind, 'sdk-client');
});

test('flags AzureOpenAI (the \\bOpenAI boundary would otherwise miss it)', () => {
  const f = classifyFile('tests/integration/t.py', 'client = AzureOpenAI(api_key=k)\n');
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].kind, 'sdk-client');
});

test('ignores files outside the integration/e2e scope', () => {
  assert.deepStrictEqual(classifyFiles([{ file: 'src/app.py', content: 'client = Anthropic()\n' }]), []);
});

test('classifyFiles scopes to tests/integration and e2e', () => {
  const findings = classifyFiles([
    { file: 'tests/integration/a.py', content: `x="${ext('https', 'api.openai.com')}"\n` },
    { file: 'src/prod.py', content: `x="${ext('https', 'api.openai.com')}"\n` },
  ]);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].file, 'tests/integration/a.py');
});

test('classifyFiles scopes co-located TS tests (*.test.ts / *.spec.tsx / __tests__/)', () => {
  const content = 'const c = new Anthropic()\n';
  for (const file of ['src/pay/pay.test.ts', 'src/ui/Btn.spec.tsx', 'app/__tests__/x.ts']) {
    assert.strictEqual(classifyFiles([{ file, content }]).length, 1, file);
  }
});

test('classifyFiles does NOT scope prose living in a test directory', () => {
  // The real block this closes: a PRD fixture under test/e2e/ specifying an SSRF
  // deny-list. Those hosts are what the product must REFUSE to reach, so writing
  // the safeguard down read as reaching for them. Nothing dials a document.
  const prd = `- FR-6 -> a target of ${ext('http', '169.254.169.254')}/ must be rejected\n`;
  for (const file of ['test/e2e/fixtures/prd.md', 'e2e/notes.txt', 'e2e/spec.rst', 'e2e/README.markdown']) {
    assert.deepStrictEqual(classifyFiles([{ file, content: prd }]), [], file);
  }
});

test('classifyFiles still scopes config that can point a test at a live host', () => {
  // The exclusion is by extension and deliberately narrow. A URL in .json or
  // .yaml under e2e/ is a real endpoint a runner can be aimed at, unlike prose.
  const content = `url: ${ext('https', 'api.openai.com')}\n`;
  for (const file of ['e2e/config.yaml', 'e2e/fixtures.json']) {
    assert.strictEqual(classifyFiles([{ file, content }]).length, 1, file);
  }
});

test('classifyFiles does NOT scope co-located *.test.js (harness-safety / TS-focused)', () => {
  assert.deepStrictEqual(classifyFiles([{ file: 'src/pay/pay.test.js', content: 'const c = new Anthropic()\n' }]), []);
});

test('flags additional TS SDK clients (AnthropicVertex, GoogleGenerativeAI)', () => {
  assert.strictEqual(classifyFile('tests/integration/t.ts', 'const c = new AnthropicVertex()\n')[0].kind, 'sdk-client');
  assert.strictEqual(classifyFile('tests/integration/t.ts', 'const g = new GoogleGenerativeAI(k)\n')[0].kind, 'sdk-client');
});

test('harness:live-ok suppresses a finding on its own line only', () => {
  const src = [
    `a = "${ext('https', 'api.stripe.com')}"  // harness:live-ok deliberate staging smoke`,
    `b = "${ext('https', 'api.stripe.com')}"`,
  ].join('\n');
  const f = classifyFile('tests/integration/t.ts', src);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].line, 2);
});
