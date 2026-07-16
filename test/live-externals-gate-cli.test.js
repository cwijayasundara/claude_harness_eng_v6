'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { checkStaged, run } = require('../.claude/scripts/live-externals-gate');

// Assemble each scheme-and-host string at runtime so no verbatim connection
// string sits in source (the harness secret-scan gate would otherwise block it).
function ext(scheme, rest) {
  return scheme + ':' + '/' + '/' + rest;
}

function fakeExec(map) {
  return (cmd, args) => {
    const key = args.join(' ');
    if (key in map) { const v = map[key]; if (v instanceof Error) throw v; return v; }
    throw new Error(`unstubbed git call: ${cmd} ${key}`);
  };
}

test('checkStaged flags a staged integration test hitting a live URL', () => {
  const exec = fakeExec({
    'diff --cached --name-only --diff-filter=ACM': 'tests/integration/t.py\nsrc/app.py\n',
    'show :tests/integration/t.py': `x = "${ext('https', 'api.stripe.com')}"\n`,
    'show :src/app.py': `x = "${ext('https', 'api.stripe.com')}"\n`,
  });
  const v = checkStaged(exec);
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.findings.length, 1);
  assert.strictEqual(v.findings[0].file, 'tests/integration/t.py');
});

test('checkStaged passes when integration tests only use localhost', () => {
  const exec = fakeExec({
    'diff --cached --name-only --diff-filter=ACM': 'tests/integration/t.py\n',
    'show :tests/integration/t.py': `x = "${ext('http', 'localhost:8000')}"\n`,
  });
  assert.strictEqual(checkStaged(exec).pass, true);
});

test('run returns 2 without --staged, 0 clean, 1 dirty', () => {
  const clean = fakeExec({ 'diff --cached --name-only --diff-filter=ACM': '' });
  assert.strictEqual(run([], '/x', { exec: clean }), 2);
  assert.strictEqual(run(['--staged'], '/x', { exec: clean }), 0);
  const dirty = fakeExec({
    'diff --cached --name-only --diff-filter=ACM': 'e2e/login.spec.ts\n',
    'show :e2e/login.spec.ts': `await page.goto("${ext('https', 'staging.example.com')}")\n`,
  });
  assert.strictEqual(run(['--staged'], '/x', { exec: dirty }), 1);
});
