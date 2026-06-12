'use strict';

// Layer topology is configurable per project via project-manifest.json's
// architecture block; defaults preserve the original src/<layer>/ convention.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { loadLayerConfig, getLayer, getHigherLayers, checkContentViolations } = require(
  path.join(__dirname, '..', '.claude', 'hooks', 'lib', 'layers')
);

const DEFAULT_LAYERS = ['types', 'config', 'repository', 'service', 'api', 'ui'];

function projectWithManifest(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layers-config-'));
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify(manifest));
  return dir;
}

test('loadLayerConfig falls back to defaults without a manifest', () => {
  const cfg = loadLayerConfig(path.join(os.tmpdir(), 'no-such-project'));
  assert.deepStrictEqual(cfg.layers, DEFAULT_LAYERS);
  assert.deepStrictEqual(cfg.roots, ['src']);
});

test('loadLayerConfig reads architecture.layers and layer_roots from the manifest', () => {
  const dir = projectWithManifest({
    architecture: { layers: ['domain', 'application', 'handlers'], layer_roots: ['app', 'internal'] },
  });
  const cfg = loadLayerConfig(dir);
  assert.deepStrictEqual(cfg.layers, ['domain', 'application', 'handlers']);
  assert.deepStrictEqual(cfg.roots, ['app', 'internal']);
});

test('malformed architecture values fall back to defaults', () => {
  const dir = projectWithManifest({ architecture: { layers: 'nope', layer_roots: [] } });
  const cfg = loadLayerConfig(dir);
  assert.deepStrictEqual(cfg.layers, DEFAULT_LAYERS);
  assert.deepStrictEqual(cfg.roots, ['src']);
});

test('getLayer honors custom roots and layer names', () => {
  const cfg = { layers: ['domain', 'application', 'handlers'], roots: ['app'] };
  assert.strictEqual(getLayer('app/handlers/http.js', cfg), 'handlers');
  assert.strictEqual(getLayer('/repo/app/domain/user.js', cfg), 'domain');
  assert.strictEqual(getLayer('src/service/user.js', cfg), null); // src is not a root here
});

test('multi-segment roots like backend/src match', () => {
  const cfg = { layers: DEFAULT_LAYERS, roots: ['backend/src'] };
  assert.strictEqual(getLayer('backend/src/api/routes.py', cfg), 'api');
  assert.strictEqual(getLayer('frontend/src/api/routes.ts', cfg), null);
});

test('getHigherLayers respects the configured order', () => {
  const cfg = { layers: ['domain', 'application', 'handlers'], roots: ['app'] };
  assert.deepStrictEqual(getHigherLayers('domain', cfg), ['application', 'handlers']);
  assert.deepStrictEqual(getHigherLayers('handlers', cfg), []);
});

test('checkContentViolations flags JS upward imports under a custom topology', () => {
  const cfg = { layers: ['domain', 'application', 'handlers'], roots: ['app'] };
  const content = "import { route } from '../handlers/router';\n";
  const violations = checkContentViolations('app/domain/user.js', content, cfg);
  assert.strictEqual(violations.length, 1);
  assert.strictEqual(violations[0].imported, 'handlers');
});

test('checkContentViolations flags Python upward imports under a custom root package', () => {
  const cfg = { layers: ['domain', 'application', 'handlers'], roots: ['app'] };
  const content = 'from app.handlers import router\n';
  const violations = checkContentViolations('app/domain/user.py', content, cfg);
  assert.strictEqual(violations.length, 1);
  assert.strictEqual(violations[0].imported, 'handlers');
});

test('python package root is the last segment of a multi-segment layer root', () => {
  const cfg = { layers: DEFAULT_LAYERS, roots: ['backend/src'] };
  const content = 'from src.api import routes\n';
  const violations = checkContentViolations('backend/src/service/logic.py', content, cfg);
  assert.strictEqual(violations.length, 1);
  assert.strictEqual(violations[0].imported, 'api');
});

test('default behavior is unchanged when no config is passed', () => {
  const content = "from src.api import routes\n";
  const violations = checkContentViolations('src/service/logic.py', content);
  assert.strictEqual(violations.length, 1);
});

test('regex metacharacters in layer roots are treated literally (no ReDoS, no throw)', () => {
  const cfg = { layers: ['domain', 'handlers'], roots: ['app(a+)+$'] };
  const started = Date.now();
  const violations = checkContentViolations('app(a+)+$/domain/user.py', 'from app.handlers import x\n'.repeat(50), cfg);
  assert.ok(Date.now() - started < 2000, 'pathological root must not wedge the gate');
  assert.deepStrictEqual(violations, []); // escaped root cannot match 'app'
});
