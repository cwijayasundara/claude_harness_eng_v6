'use strict';

// PR4: scaffold-render writes quality.sensor_tier; core copy excludes optional skills.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { buildManifest, defaultSensorTier } = require('../.claude/scripts/scaffold-render');
const {
  CORE_SKILLS,
  OPTIONAL_SKILLS,
  selectedCopySet,
  copyScaffoldTree,
} = require('../.claude/scripts/scaffold-copy');

const PLUGIN_SOURCE = path.resolve(__dirname, '..', '.claude');

test('defaultSensorTier: cli-or-library → minimal, web-app → standard', () => {
  assert.strictEqual(defaultSensorTier({}, 'cli-or-library'), 'minimal');
  assert.strictEqual(defaultSensorTier({}, 'web-app'), 'standard');
  assert.strictEqual(defaultSensorTier({}, 'api-service'), 'standard');
});

test('defaultSensorTier honors explicit profile.sensorTier', () => {
  assert.strictEqual(defaultSensorTier({ sensorTier: 'strict' }, 'cli-or-library'), 'strict');
  assert.strictEqual(
    defaultSensorTier({ quality: { sensor_tier: 'minimal' } }, 'web-app'),
    'minimal'
  );
});

test('buildManifest writes quality.sensor_tier for lite-shaped profiles', () => {
  const manifest = buildManifest({
    name: 'cli-tool',
    projectType: 'D',
    stack: { backend: { language: 'javascript' }, frontend: null, database: null },
  });
  assert.strictEqual(manifest.topology, 'cli-or-library');
  assert.strictEqual(manifest.quality.sensor_tier, 'minimal');
  assert.strictEqual(manifest.quality.agent_readiness.mode, 'report');
});

test('buildManifest writes quality.sensor_tier standard for web-app shapes', () => {
  const manifest = buildManifest({
    name: 'web',
    projectType: 'A',
    stack: {
      backend: { language: 'python', framework: 'fastapi' },
      frontend: { language: 'typescript', framework: 'react' },
      database: null,
    },
  });
  assert.strictEqual(manifest.topology, 'web-app');
  assert.strictEqual(manifest.quality.sensor_tier, 'standard');
});

test('OPTIONAL_SKILLS are excluded from CORE_SKILLS', () => {
  const core = new Set(CORE_SKILLS);
  for (const name of OPTIONAL_SKILLS) {
    assert.ok(!core.has(name), `${name} must not be in CORE_SKILLS`);
  }
  assert.ok(OPTIONAL_SKILLS.includes('pe-ic-memo'));
  assert.ok(OPTIONAL_SKILLS.includes('install-framework-packs'));
});

test('core selectedCopySet does not include optional skills', () => {
  const set = selectedCopySet('core');
  assert.ok(set);
  const skills = new Set(set.skills);
  for (const name of OPTIONAL_SKILLS) {
    assert.ok(!skills.has(name), `core copy must exclude ${name}`);
  }
  assert.ok(skills.has('build'));
  assert.ok(skills.has('feature'));
  assert.ok(skills.has('writing-acceptance-tests-first'));
});

test('full selectedCopySet is null (copies entire skills tree)', () => {
  assert.strictEqual(selectedCopySet('full'), null);
});

test('copyScaffoldTree(core) does not copy pe-ic-memo or install-framework-packs', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-lean-'));
  const target = path.join(workDir, 'project');
  try {
    copyScaffoldTree(PLUGIN_SOURCE, target, 'core');
    assert.ok(!fs.existsSync(path.join(target, '.claude', 'skills', 'pe-ic-memo')));
    assert.ok(!fs.existsSync(path.join(target, '.claude', 'skills', 'install-framework-packs')));
    assert.ok(!fs.existsSync(path.join(target, '.claude', 'skills', 'fastapi-code')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'build', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'writing-acceptance-tests-first', 'SKILL.md')));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('scaffold.md documents quality.sensor_tier', () => {
  const md = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'commands', 'scaffold.md'),
    'utf8'
  );
  assert.match(md, /quality\.sensor_tier/);
  assert.match(md, /minimal/);
  assert.match(md, /cli-or-library/);
});
