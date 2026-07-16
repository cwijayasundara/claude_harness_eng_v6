'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { scanSecrets } = require('../.claude/hooks/lib/secrets');

// Assemble a credentialed connection string at runtime so this test file itself
// does not carry a verbatim one (which its own subject would flag).
const dsn = (host) => 'postgres' + ':' + '/' + '/' + 'user:pw@' + host;

test('a connection-string on a line WITHOUT the marker is still flagged', () => {
  const findings = scanSecrets(`DB = "${dsn('db.prod.example.com')}"\n`);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].label, 'Connection String');
});

test('the same line WITH harness:secret-ok is suppressed', () => {
  const findings = scanSecrets(`DB = "${dsn('db.prod.example.com')}"  # harness:secret-ok test fixture\n`);
  assert.deepStrictEqual(findings, []);
});

test('the marker only suppresses ITS line, not other lines', () => {
  const content = [
    `A = "${dsn('a.example.com')}"  // harness:secret-ok`,
    `B = "${dsn('b.example.com')}"`,
  ].join('\n');
  const findings = scanSecrets(content);
  assert.strictEqual(findings.length, 1); // only line B
});

test('a real AWS key on an unmarked line is still flagged (no weakening)', () => {
  const findings = scanSecrets('KEY = "AKIA' + 'ABCDEFGHIJKLMNOP"\n');
  assert.ok(findings.some((f) => f.label === 'AWS Access Key'));
});

test('a real AWS key IS suppressible on a marked line (explicit, greppable exception)', () => {
  const findings = scanSecrets('KEY = "AKIA' + 'ABCDEFGHIJKLMNOP"  # harness:secret-ok\n');
  assert.deepStrictEqual(findings, []);
});
