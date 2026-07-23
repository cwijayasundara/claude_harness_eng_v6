'use strict';
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('duplication-gate CLI exists and reuses the tested lib', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/duplication-gate.js')));
  const cli = read('.claude/scripts/duplication-gate.js');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/duplication-gate'\)/, 'CLI must use the tested lib');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/cycle-gate'\)/, 'CLI must reuse gateDecision');
  assert.match(cli, /require\.main === module/, 'CLI must be require-safe');
});

test('package.json exposes the duplication-gate script', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.strictEqual(pkg.scripts['duplication-gate'], 'node .claude/scripts/duplication-gate.js');
});

test('CLI degrades loudly (exit 0) when jscpd is unavailable', () => {
  // Force jscpd absent by running with an empty PATH; the gate must exit 0 and announce.
  const { execFileSync } = require('child_process');
  let out = '';
  let code = 0;
  try {
    // Use the absolute path to the running node binary (process.execPath), not
    // the bare 'node' string: on machines where node isn't on the OS's
    // fallback search path (e.g. Homebrew installs), an empty PATH would fail
    // to resolve 'node' itself, before ever reaching the jscpd spawn under test.
    out = execFileSync(process.execPath, ['.claude/scripts/duplication-gate.js', '.'],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PATH: '' } });
  } catch (e) { code = e.status; out = `${e.stdout || ''}${e.stderr || ''}`; }
  assert.strictEqual(code, 0, 'must not block when the tool is missing');
  assert.match(out, /jscpd.*(not installed|unprovisioned|unavailable)/i, 'must announce the skip loudly');
});

test('/auto Gate 4 runs the duplication ratchet', () => {
  assert.match(readSkillCorpus('auto'), /duplication-gate\.js/, 'Gate 4 must run the duplication ratchet');
});

test('/gate runs the duplication ratchet', () => {
  // Registry membership, not skill prose: /gate runs the pack-contributed check set.
  const { loadRegistry } = require('../.claude/scripts/run-gate-checks.js');
  const entry = loadRegistry(process.cwd()).find((c) => c.script === 'duplication-gate.js');
  assert.ok(entry, '/gate must run the duplication ratchet (via .claude/config/gate-checks.json)');
  assert.strictEqual(entry.blocking, true, 'the duplication ratchet must block, not warn');
});
