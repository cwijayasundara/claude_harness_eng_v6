'use strict';

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { buildManifest } = require(path.join(__dirname, '..', '.claude', 'scripts', 'scaffold-render.js'));

test('buildManifest includes domain_vertical_packs when profile.domainVerticalPacks is a non-empty array', () => {
  const manifest = buildManifest({ name: 'test-project', domainVerticalPacks: ['private-equity'] });
  assert.deepStrictEqual(manifest.domain_vertical_packs, ['private-equity']);
});

test('buildManifest omits domain_vertical_packs when profile.domainVerticalPacks is absent or empty', () => {
  const withoutField = buildManifest({ name: 'test-project' });
  assert.strictEqual('domain_vertical_packs' in withoutField, false);
  const withEmptyArray = buildManifest({ name: 'test-project', domainVerticalPacks: [] });
  assert.strictEqual('domain_vertical_packs' in withEmptyArray, false);
});

test('buildManifest still includes framework_skill_packs unaffected by the new field (regression check)', () => {
  const manifest = buildManifest({
    name: 'test-project',
    frameworkPacks: ['python-ai-agents'],
    domainVerticalPacks: ['private-equity'],
  });
  assert.deepStrictEqual(manifest.framework_skill_packs, ['python-ai-agents']);
  assert.deepStrictEqual(manifest.domain_vertical_packs, ['private-equity']);
});

const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const STATUS_SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'scaffold-vertical-status.js');
const { checkVerticalStatus } = require(STATUS_SCRIPT);

function testRegistryEntry(plugin) {
  return {
    plugin,
    enabled_plugin_prefix: `${plugin}@`,
    marketplace: 'claude-for-financial-services',
    install_id: `${plugin}@claude-for-financial-services`,
  };
}

test('checkVerticalStatus reports installed:true when the plugin is enabled', () => {
  const result = checkVerticalStatus(
    { 'private-equity@claude-for-financial-services': true },
    [testRegistryEntry('private-equity')]
  );
  assert.deepStrictEqual(result, [{
    plugin: 'private-equity', installed: true,
    marketplace: 'claude-for-financial-services', install_id: 'private-equity@claude-for-financial-services',
  }]);
});

test('checkVerticalStatus reports installed:false when the plugin is not enabled', () => {
  const result = checkVerticalStatus({}, [testRegistryEntry('private-equity')]);
  assert.strictEqual(result[0].installed, false);
});

test('checkVerticalStatus reports every registry entry independently', () => {
  const result = checkVerticalStatus(
    { 'private-equity@claude-for-financial-services': true },
    [testRegistryEntry('private-equity'), testRegistryEntry('wealth-management')]
  );
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result.find((r) => r.plugin === 'private-equity').installed, true);
  assert.strictEqual(result.find((r) => r.plugin === 'wealth-management').installed, false);
});

test('CLI: prints INSTALLED for an enabled vertical and a manual-install block for a pending one', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-vertical-status-'));
  fs.mkdirSync(path.join(repo, '.claude', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.claude', 'config', 'vertical-glossary-packs.json'),
    JSON.stringify({ packs: [testRegistryEntry('private-equity'), testRegistryEntry('wealth-management')] }, null, 2)
  );
  fs.writeFileSync(
    path.join(repo, '.claude', 'settings.json'),
    JSON.stringify({ enabledPlugins: { 'private-equity@claude-for-financial-services': true } }, null, 2)
  );
  const stdout = execFileSync(process.execPath, [STATUS_SCRIPT], { cwd: repo, encoding: 'utf8' });
  assert.match(stdout, /private-equity: INSTALLED/);
  assert.match(stdout, /wealth-management: PENDING MANUAL INSTALL/);
  assert.match(stdout, /claude plugin marketplace add claude-for-financial-services/);
  assert.match(stdout, /claude plugin install wealth-management@claude-for-financial-services/);
});
