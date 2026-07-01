'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude/scripts/validate-sensor-waivers.js');

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sensor-waivers-'));
  fs.mkdirSync(path.join(root, 'specs/reviews'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude/templates'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, '.claude/templates/sensor-waivers.schema.json'),
    path.join(root, '.claude/templates/sensor-waivers.schema.json'),
  );
  return root;
}

function writeWaivers(root, waivers) {
  fs.writeFileSync(
    path.join(root, 'specs/reviews/sensor-waivers.json'),
    JSON.stringify({ waivers }, null, 2),
  );
}

function run(root) {
  return cp.spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' });
}

test('missing sensor-waivers.json passes and writes a verdict', () => {
  const root = tmpProject();
  const r = run(root);
  assert.strictEqual(r.status, 0, r.stderr);
  const verdict = JSON.parse(fs.readFileSync(path.join(root, 'specs/reviews/sensor-waivers-verdict.json'), 'utf8'));
  assert.strictEqual(verdict.verdict, 'no-waivers');
});

test('valid waiver passes', () => {
  const root = tmpProject();
  writeWaivers(root, [{
    sensor_id: 'mutation-smoke',
    scope: 'src/billing/service.py',
    reason: 'Legacy boundary is pinned by external approval tests for this release.',
    expires: 'release-2026.08',
    approved_by: 'human-review',
  }]);
  const r = run(root);
  assert.strictEqual(r.status, 0, r.stderr);
  const verdict = JSON.parse(fs.readFileSync(path.join(root, 'specs/reviews/sensor-waivers-verdict.json'), 'utf8'));
  assert.strictEqual(verdict.verdict, 'pass');
});

test('missing required waiver field fails', () => {
  const root = tmpProject();
  writeWaivers(root, [{
    sensor_id: 'mutation-smoke',
    scope: 'src/billing/service.py',
    reason: 'Legacy boundary is pinned by external approval tests for this release.',
    expires: 'release-2026.08',
  }]);
  const r = run(root);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /missing approved_by/);
});

test('expired ISO date waiver fails', () => {
  const root = tmpProject();
  writeWaivers(root, [{
    sensor_id: 'mutation-smoke',
    scope: 'src/billing/service.py',
    reason: 'Legacy boundary is pinned by external approval tests for this release.',
    expires: '2000-01-01',
    approved_by: 'human-review',
  }]);
  const r = run(root);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /expired/);
});
