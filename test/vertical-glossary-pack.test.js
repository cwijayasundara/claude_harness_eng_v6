'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'vertical-glossary-pack.js');
const {
  loadRegistry, isPluginEnabled, findSkillsDir, readSkillDescriptions, buildPack,
} = require(SCRIPT);

const REGISTRY_PATH = path.join(__dirname, '..', '.claude', 'config', 'vertical-glossary-packs.json');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vertical-glossary-'));
}

function writeSkill(skillsDir, dirName, frontmatterName, description) {
  const dir = path.join(skillsDir, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${frontmatterName}\ndescription: ${description}\n---\n\n# ${frontmatterName}\n`
  );
}

test('loadRegistry reads the real committed registry and finds the private-equity entry', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  assert.ok(Array.isArray(registry.packs));
  const pe = registry.packs.find((p) => p.plugin === 'private-equity');
  assert.ok(pe, 'expected a private-equity entry in the registry');
  assert.strictEqual(pe.enabled_plugin_prefix, 'private-equity@');
  assert.strictEqual(pe.marketplace, 'claude-for-financial-services');
  assert.strictEqual(pe.install_id, 'private-equity@claude-for-financial-services');
  assert.strictEqual(pe.bounded_contexts.length, 3);
  const allSkills = pe.bounded_contexts.flatMap((c) => c.skills);
  assert.deepStrictEqual(allSkills.sort(), [
    'ai-readiness', 'dd-checklist', 'dd-meeting-prep', 'deal-screening', 'deal-sourcing',
    'ic-memo', 'portfolio-monitoring', 'returns-analysis', 'unit-economics', 'value-creation-plan',
  ].sort());
});

test('isPluginEnabled matches a prefixed key with a truthy value', () => {
  assert.strictEqual(isPluginEnabled({ 'private-equity@claude-for-financial-services': true }, 'private-equity@'), true);
  assert.strictEqual(isPluginEnabled({ 'private-equity@claude-for-financial-services': false }, 'private-equity@'), false);
  assert.strictEqual(isPluginEnabled({ 'wealth-management@claude-for-financial-services': true }, 'private-equity@'), false);
  assert.strictEqual(isPluginEnabled(undefined, 'private-equity@'), false);
  assert.strictEqual(isPluginEnabled({}, 'private-equity@'), false);
});

test('findSkillsDir prefers the marketplace path over the cache path when both exist', () => {
  const home = mkTmpDir();
  const entry = {
    marketplace_skills_subpath: path.join('.claude', 'plugins', 'marketplaces', 'test-mp', 'skills'),
    cache_skills_subpath: path.join('.claude', 'plugins', 'cache', 'test-mp', 'skills'),
  };
  fs.mkdirSync(path.join(home, entry.marketplace_skills_subpath), { recursive: true });
  fs.mkdirSync(path.join(home, entry.cache_skills_subpath), { recursive: true });
  assert.strictEqual(findSkillsDir(home, entry), path.join(home, entry.marketplace_skills_subpath));
});

test('findSkillsDir falls back to the cache path when only it exists', () => {
  const home = mkTmpDir();
  const entry = {
    marketplace_skills_subpath: path.join('.claude', 'plugins', 'marketplaces', 'test-mp', 'skills'),
    cache_skills_subpath: path.join('.claude', 'plugins', 'cache', 'test-mp', 'skills'),
  };
  fs.mkdirSync(path.join(home, entry.cache_skills_subpath), { recursive: true });
  assert.strictEqual(findSkillsDir(home, entry), path.join(home, entry.cache_skills_subpath));
});

test('findSkillsDir returns null when neither candidate path exists', () => {
  const home = mkTmpDir();
  const entry = {
    marketplace_skills_subpath: path.join('.claude', 'plugins', 'marketplaces', 'test-mp', 'skills'),
    cache_skills_subpath: path.join('.claude', 'plugins', 'cache', 'test-mp', 'skills'),
  };
  assert.strictEqual(findSkillsDir(home, entry), null);
});

test('readSkillDescriptions extracts name/description frontmatter from each skill directory', () => {
  const home = mkTmpDir();
  const skillsDir = path.join(home, 'skills');
  writeSkill(skillsDir, 'deal-screening', 'deal-screening', 'Quickly screen inbound deal flow.');
  writeSkill(skillsDir, 'ic-memo', 'ic-memo', 'Draft a structured investment committee memo.');
  const result = readSkillDescriptions(skillsDir);
  assert.deepStrictEqual(result.sort((a, b) => a.skill.localeCompare(b.skill)), [
    { skill: 'deal-screening', description: 'Quickly screen inbound deal flow.' },
    { skill: 'ic-memo', description: 'Draft a structured investment committee memo.' },
  ]);
});

test('readSkillDescriptions skips directories without a SKILL.md', () => {
  const home = mkTmpDir();
  const skillsDir = path.join(home, 'skills');
  fs.mkdirSync(path.join(skillsDir, 'empty-dir'), { recursive: true });
  writeSkill(skillsDir, 'ic-memo', 'ic-memo', 'Draft an IC memo.');
  const result = readSkillDescriptions(skillsDir);
  assert.deepStrictEqual(result, [{ skill: 'ic-memo', description: 'Draft an IC memo.' }]);
});

test('buildPack groups skill descriptions under the entry bounded contexts, in order', () => {
  const entry = {
    bounded_contexts: [
      { name: 'Context A', skills: ['skill-1'] },
      { name: 'Context B', skills: ['skill-2'] },
    ],
  };
  const pack = buildPack([
    { skill: 'skill-2', description: 'Second.' },
    { skill: 'skill-1', description: 'First.' },
  ], entry);
  assert.strictEqual(pack.contexts.length, 2);
  assert.strictEqual(pack.contexts[0].name, 'Context A');
  assert.deepStrictEqual(pack.contexts[0].skills, [{ skill: 'skill-1', description: 'First.' }]);
  assert.strictEqual(pack.contexts[1].name, 'Context B');
  assert.deepStrictEqual(pack.contexts[1].skills, [{ skill: 'skill-2', description: 'Second.' }]);
});
