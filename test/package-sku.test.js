'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { packageSku, SKU_META, readRootVersion } = require('../.claude/scripts/package-sku');

test('packageSku core emits plugin.json and excludes pe-ic-memo', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sku-'));
  const dest = packageSku('core', out, readRootVersion());
  assert.ok(fs.existsSync(path.join(dest, '.claude-plugin', 'plugin.json')));
  const meta = JSON.parse(fs.readFileSync(path.join(dest, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.strictEqual(meta.name, SKU_META.core.pluginName);
  assert.ok(fs.existsSync(path.join(dest, 'skills', 'build', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(dest, 'hooks', 'lib', 'gate-registry.js')));
  assert.ok(!fs.existsSync(path.join(dest, 'skills', 'pe-ic-memo')));
  assert.ok(!fs.existsSync(path.join(dest, 'skills', 'install-framework-packs')));
  assert.ok(fs.existsSync(path.join(dest, 'SKU.md')));
});

test('packageSku lite emits artifact-only loadout', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sku-'));
  const dest = packageSku('lite', out, '9.9.9-test');
  assert.ok(fs.existsSync(path.join(dest, '.claude-plugin', 'plugin.json')));
  const meta = JSON.parse(fs.readFileSync(path.join(dest, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.strictEqual(meta.name, 'claude-harness-lite');
  assert.strictEqual(meta.version, '9.9.9-test');
  // lite has skills, not full SDLC agents
  assert.ok(fs.existsSync(path.join(dest, 'skills')));
});

test('packageSku full includes optional skills', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sku-'));
  const dest = packageSku('full', out, readRootVersion());
  assert.ok(fs.existsSync(path.join(dest, 'skills', 'pe-ic-memo')) ||
    fs.existsSync(path.join(dest, 'skills', 'install-framework-packs')),
  'full profile should include optional surface');
});
