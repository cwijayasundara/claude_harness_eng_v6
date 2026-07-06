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

const { execFileSync } = require('child_process');

function mkTmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vertical-glossary-repo-'));
}

function writeSettings(repoDir, enabledPlugins) {
  fs.mkdirSync(path.join(repoDir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, '.claude', 'settings.json'),
    JSON.stringify({ enabledPlugins }, null, 2)
  );
}

function writeRepoRegistry(repoDir, packs) {
  fs.mkdirSync(path.join(repoDir, '.claude', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, '.claude', 'config', 'vertical-glossary-packs.json'),
    JSON.stringify({ packs }, null, 2)
  );
}

function runScript(repoDir, homeDir) {
  return execFileSync(process.execPath, [SCRIPT], {
    cwd: repoDir,
    env: { ...process.env, HOME: homeDir },
    encoding: 'utf8',
  });
}

function testEntry(name) {
  return {
    plugin: name,
    enabled_plugin_prefix: `${name}@`,
    marketplace: 'test-marketplace',
    install_id: `${name}@test-marketplace`,
    marketplace_skills_subpath: path.join('.claude', 'plugins', 'marketplaces', 'test-marketplace', 'plugins', name, 'skills'),
    cache_skills_subpath: path.join('.claude', 'plugins', 'cache', 'test-marketplace', name, 'skills'),
    bounded_contexts: [{ name: 'Everything', skills: ['a-skill'] }],
  };
}

test('CLI: no-ops with no output files when no registry entry is enabled', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  writeSettings(repo, { 'wealth-management@claude-for-financial-services': true });
  writeRepoRegistry(repo, [testEntry('vertical-a')]);
  const stdout = runScript(repo, home);
  assert.match(stdout, /no vertical glossary packs enabled/);
  assert.strictEqual(fs.existsSync(path.join(repo, 'specs', 'brd', 'vertical-a-glossary-pack.json')), false);
});

test('CLI: exits 2 when an enabled entry has no skills directory', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  writeSettings(repo, { 'vertical-a@test-marketplace': true });
  writeRepoRegistry(repo, [testEntry('vertical-a')]);
  assert.throws(
    () => runScript(repo, home),
    (err) => err.status === 2
  );
});

test('CLI: exits 2 when an enabled entry has an empty skills directory', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  const entry = testEntry('vertical-a');
  writeSettings(repo, { 'vertical-a@test-marketplace': true });
  writeRepoRegistry(repo, [entry]);
  fs.mkdirSync(path.join(home, entry.marketplace_skills_subpath), { recursive: true });
  assert.throws(
    () => runScript(repo, home),
    (err) => err.status === 2 && /no skill descriptions were found/.test(err.stderr.toString())
  );
});

test('CLI: writes a pack per enabled entry and still writes the healthy one when another entry is broken', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  const healthy = testEntry('vertical-a');
  const broken = testEntry('vertical-b');
  writeSettings(repo, { 'vertical-a@test-marketplace': true, 'vertical-b@test-marketplace': true });
  writeRepoRegistry(repo, [healthy, broken]);
  const skillsDir = path.join(home, healthy.marketplace_skills_subpath);
  writeSkill(skillsDir, 'a-skill', 'a-skill', 'Does a thing.');
  // broken entry's skills dir intentionally left absent
  assert.throws(
    () => runScript(repo, home),
    (err) => err.status === 2
  );
  const healthyOut = path.join(repo, 'specs', 'brd', 'vertical-a-glossary-pack.json');
  assert.strictEqual(fs.existsSync(healthyOut), true, 'the healthy entry must still write its pack');
  const pack = JSON.parse(fs.readFileSync(healthyOut, 'utf8'));
  assert.strictEqual(pack.contexts[0].skills[0].skill, 'a-skill');
});

test('CLI: writes private-equity-glossary-pack.json (not pe-glossary-pack.json) for the private-equity entry', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  const entry = testEntry('private-equity');
  entry.enabled_plugin_prefix = 'private-equity@';
  writeSettings(repo, { 'private-equity@test-marketplace': true });
  writeRepoRegistry(repo, [entry]);
  const skillsDir = path.join(home, entry.marketplace_skills_subpath);
  writeSkill(skillsDir, 'a-skill', 'a-skill', 'Does a thing.');
  runScript(repo, home);
  assert.strictEqual(fs.existsSync(path.join(repo, 'specs', 'brd', 'private-equity-glossary-pack.json')), true);
  assert.strictEqual(fs.existsSync(path.join(repo, 'specs', 'brd', 'pe-glossary-pack.json')), false);
});

test('brd/SKILL.md Step 2.7 is generalized to any registered vertical, not private-equity-only', () => {
  const brdSkill = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'skills', 'brd', 'SKILL.md'), 'utf8'
  );
  const step27Index = brdSkill.indexOf('### Step 2.7');
  const step28Index = brdSkill.indexOf('### Step 2.8');
  assert.ok(step27Index > -1, 'expected Step 2.7 in brd/SKILL.md');
  assert.ok(step28Index > -1, 'expected Step 2.8 in brd/SKILL.md');
  assert.ok(step27Index < step28Index, 'Step 2.7 must precede Step 2.8');
  assert.match(brdSkill, /vertical-glossary-pack\.js/);
  assert.match(brdSkill, /vertical-glossary-packs\.json/);
  assert.doesNotMatch(brdSkill, /private-equity projects only/);
});
