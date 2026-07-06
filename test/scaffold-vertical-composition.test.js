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
