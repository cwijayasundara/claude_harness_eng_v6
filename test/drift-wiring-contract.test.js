'use strict';

// Locks the G2 drift-monitor wiring so it can't be silently dropped: the CLI
// must exist and reuse the pure lib + the security-scan dep runner, package.json
// must expose `npm run drift`, and the manifest must register the drift sensors.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('drift CLI exists and reuses the pure lib and security-scan runDeps', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/drift-report.js')));
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/hooks/lib/drift.js')));
  const cli = read('.claude/scripts/drift-report.js');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/drift'\)/, 'CLI must use the tested drift lib');
  assert.match(cli, /require\('\.\/security-scan'\)/, 'CLI must reuse security-scan runDeps');
});

test('package.json exposes the drift script', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.strictEqual(pkg.scripts.drift, 'node .claude/scripts/drift-report.js');
});

test('manifest registers the active drift sensors at the drift cadence', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  // Sensors the drift *monitor* itself registers (other drift-cadence sensors,
  // if any, would be wired elsewhere).
  const driftSensors = m.sensors.filter(
    (s) => s.status === 'active' && s.wired_at === '.claude/scripts/drift-report.js'
  );
  const ids = driftSensors.map((s) => s.id).sort();
  assert.deepStrictEqual(ids, [
    'drift-architecture', 'drift-dead-code', 'drift-deps', 'drift-design-code',
    'modularity-review-staleness',
  ]);
  assert.ok(driftSensors.every((s) => s.cadence === 'drift'));
});

test('modularity-review itself is honestly cadence:planning, not drift (gap G19)', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'modularity-review');
  assert.ok(s, 'expected a modularity-review sensor entry');
  assert.strictEqual(s.cadence, 'planning', 'the review itself has no periodic trigger of its own');
});

test('the new modularity-review-staleness sensor reuses drift-report.js and record-modularity-review.js', () => {
  const cli = read('.claude/scripts/drift-report.js');
  assert.match(cli, /withModularityStaleness/, 'CLI must compose the new drift dimension');
  assert.ok(
    fs.existsSync(path.join(ROOT, '.claude/scripts/record-modularity-review.js')),
    'expected the marker-writing script gap G19 introduces'
  );
});

test('security-scan.js is require-safe (does not run main on import)', () => {
  // Importing must not call process.exit; if the guard regressed, this throws.
  const mod = require(path.join(ROOT, '.claude/scripts/security-scan.js'));
  assert.strictEqual(typeof mod.runDeps, 'function');
});
