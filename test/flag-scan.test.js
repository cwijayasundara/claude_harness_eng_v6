'use strict';

// Feature-flag inventory: flags are the primary safe-change mechanism in
// production brownfield systems, and flag debt is invisible until mapped.
// flag-scan.js heuristically inventories flag usage (SDKs, env-var gates,
// config flags) into specs/brownfield/flag-inventory.md.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const script = path.join(__dirname, '..', '.claude', 'scripts', 'flag-scan.js');
const { scanContent } = require(script);

test('detects LaunchDarkly variation calls with the flag key', () => {
  const hits = scanContent("const show = await ldClient.variation('new-checkout', user, false);", 'src/checkout.js');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].flag, 'new-checkout');
  assert.strictEqual(hits[0].mechanism, 'launchdarkly');
});

test('detects Unleash isEnabled calls', () => {
  const hits = scanContent('if (unleash.isEnabled("beta-search")) {', 'src/search.js');
  assert.strictEqual(hits[0].flag, 'beta-search');
  assert.strictEqual(hits[0].mechanism, 'unleash');
});

test('detects env-var feature gates in JS and Python', () => {
  const js = scanContent('if (process.env.FEATURE_NEW_BILLING === "1") {', 'src/billing.js');
  assert.strictEqual(js[0].flag, 'FEATURE_NEW_BILLING');
  assert.strictEqual(js[0].mechanism, 'env');
  const py = scanContent("if os.environ.get('FEATURE_DARK_MODE'):", 'app/views.py');
  assert.strictEqual(py[0].flag, 'FEATURE_DARK_MODE');
});

test('detects django-waffle and config-dict flags', () => {
  const waffle = scanContent("if waffle.flag_is_active(request, 'new_onboarding'):", 'app/views.py');
  assert.strictEqual(waffle[0].mechanism, 'waffle');
  const cfg = scanContent("if settings.FEATURE_FLAGS['fast_export']:", 'app/export.py');
  assert.strictEqual(cfg[0].flag, 'fast_export');
  assert.strictEqual(cfg[0].mechanism, 'config');
});

test('ignores ordinary code', () => {
  assert.deepStrictEqual(scanContent('const total = items.reduce((a, b) => a + b);', 'src/sum.js'), []);
});

test('CLI writes flag-inventory.md grouped by flag with file:line references', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flag-scan-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'),
    'if (process.env.FEATURE_X) { go(); }\n' +
    'const y = await ldClient.variation("new-checkout", user, false);\n');
  fs.writeFileSync(path.join(dir, 'src', 'b.js'),
    'if (process.env.FEATURE_X) { goElsewhere(); }\n');
  const res = spawnSync('node', [script, '--root', dir], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const out = fs.readFileSync(path.join(dir, 'specs', 'brownfield', 'flag-inventory.md'), 'utf8');
  assert.ok(out.includes('FEATURE_X'), out);
  assert.ok(out.includes('new-checkout'), out);
  assert.ok(out.includes('src/a.js:1'), out);
  assert.ok(out.includes('src/b.js:1'), out);
});

test('CLI reports zero flags without failing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flag-scan-empty-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'const a = 1;\n');
  const res = spawnSync('node', [script, '--root', dir], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.ok(/no feature flags detected/i.test(res.stdout), res.stdout);
});
