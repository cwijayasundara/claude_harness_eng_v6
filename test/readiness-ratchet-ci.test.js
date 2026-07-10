'use strict';

// Phase 2: Project Zero readiness ratchet is wired into CI and must pass locally.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');

test('CI workflow hard-fails agent-readiness ratchet', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(yml, /agent-readiness:assert/);
  assert.match(yml, /Agent readiness ratchet/i);
});

test('package.json exposes baseline + retention scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts['agent-readiness:baseline']);
  assert.ok(pkg.scripts.retention);
  assert.ok(pkg.scripts['retention:dry']);
});

test('live agent-readiness assert passes against committed baseline', () => {
  const gen = spawnSync('npm', ['run', 'agent-readiness'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  assert.strictEqual(gen.status, 0, gen.stdout + gen.stderr);

  const assertRun = spawnSync('npm', ['run', 'agent-readiness:assert'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  assert.strictEqual(
    assertRun.status,
    0,
    `readiness ratchet failed:\n${assertRun.stdout}\n${assertRun.stderr}`
  );
  assert.match(assertRun.stdout, /PASS|active \d+\/8/i);
});
