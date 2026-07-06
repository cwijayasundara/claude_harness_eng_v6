'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'pe-glossary-pack.js');
const {
  isPrivateEquityEnabled, findSkillsDir, readSkillDescriptions, buildPack,
  BOUNDED_CONTEXTS, MARKETPLACE_SKILLS_SUBPATH, CACHE_SKILLS_SUBPATH,
} = require(SCRIPT);

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pe-glossary-'));
}

function writeSkill(skillsDir, dirName, frontmatterName, description) {
  const dir = path.join(skillsDir, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${frontmatterName}\ndescription: ${description}\n---\n\n# ${frontmatterName}\n`
  );
}

test('isPrivateEquityEnabled matches a private-equity@ key with a truthy value', () => {
  assert.strictEqual(isPrivateEquityEnabled({ 'private-equity@claude-for-financial-services': true }), true);
  assert.strictEqual(isPrivateEquityEnabled({ 'private-equity@claude-for-financial-services': false }), false);
  assert.strictEqual(isPrivateEquityEnabled({ 'wealth-management@claude-for-financial-services': true }), false);
  assert.strictEqual(isPrivateEquityEnabled(undefined), false);
  assert.strictEqual(isPrivateEquityEnabled({}), false);
});

test('findSkillsDir prefers the marketplace path over the cache path when both exist', () => {
  const home = mkTmpDir();
  fs.mkdirSync(path.join(home, MARKETPLACE_SKILLS_SUBPATH), { recursive: true });
  fs.mkdirSync(path.join(home, CACHE_SKILLS_SUBPATH), { recursive: true });
  assert.strictEqual(findSkillsDir(home), path.join(home, MARKETPLACE_SKILLS_SUBPATH));
});

test('findSkillsDir falls back to the cache path when only it exists', () => {
  const home = mkTmpDir();
  fs.mkdirSync(path.join(home, CACHE_SKILLS_SUBPATH), { recursive: true });
  assert.strictEqual(findSkillsDir(home), path.join(home, CACHE_SKILLS_SUBPATH));
});

test('findSkillsDir returns null when neither candidate path exists', () => {
  const home = mkTmpDir();
  assert.strictEqual(findSkillsDir(home), null);
});

test('readSkillDescriptions extracts name/description frontmatter from each skill directory', () => {
  const home = mkTmpDir();
  const skillsDir = path.join(home, MARKETPLACE_SKILLS_SUBPATH);
  writeSkill(skillsDir, 'deal-screening', 'deal-screening', 'Quickly screen inbound deal flow — CIMs, teasers, and broker materials.');
  writeSkill(skillsDir, 'ic-memo', 'ic-memo', 'Draft a structured investment committee memo for PE deal approval.');
  const result = readSkillDescriptions(skillsDir);
  assert.deepStrictEqual(result.sort((a, b) => a.skill.localeCompare(b.skill)), [
    { skill: 'deal-screening', description: 'Quickly screen inbound deal flow — CIMs, teasers, and broker materials.' },
    { skill: 'ic-memo', description: 'Draft a structured investment committee memo for PE deal approval.' },
  ]);
});

test('readSkillDescriptions skips directories without a SKILL.md', () => {
  const home = mkTmpDir();
  const skillsDir = path.join(home, MARKETPLACE_SKILLS_SUBPATH);
  fs.mkdirSync(path.join(skillsDir, 'empty-dir'), { recursive: true });
  writeSkill(skillsDir, 'ic-memo', 'ic-memo', 'Draft an IC memo.');
  const result = readSkillDescriptions(skillsDir);
  assert.deepStrictEqual(result, [{ skill: 'ic-memo', description: 'Draft an IC memo.' }]);
});

test('BOUNDED_CONTEXTS assigns all 10 known private-equity skills across exactly 3 contexts', () => {
  assert.strictEqual(BOUNDED_CONTEXTS.length, 3);
  const allSkills = BOUNDED_CONTEXTS.flatMap((c) => c.skills);
  assert.deepStrictEqual(allSkills.sort(), [
    'ai-readiness', 'dd-checklist', 'dd-meeting-prep', 'deal-screening', 'deal-sourcing',
    'ic-memo', 'portfolio-monitoring', 'returns-analysis', 'unit-economics', 'value-creation-plan',
  ].sort());
});

test('buildPack groups skill descriptions under their bounded context in BOUNDED_CONTEXTS order', () => {
  const pack = buildPack([
    { skill: 'returns-analysis', description: 'IRR/MOIC sensitivity tables.' },
    { skill: 'deal-screening', description: 'Screen inbound deal flow.' },
  ]);
  assert.strictEqual(pack.contexts.length, 3);
  assert.strictEqual(pack.contexts[0].name, 'Deal Lifecycle (Sourcing, Screening & Diligence)');
  assert.deepStrictEqual(pack.contexts[0].skills, [{ skill: 'deal-screening', description: 'Screen inbound deal flow.' }]);
  assert.strictEqual(pack.contexts[1].name, 'Investment Decision & Returns');
  assert.deepStrictEqual(pack.contexts[1].skills, [{ skill: 'returns-analysis', description: 'IRR/MOIC sensitivity tables.' }]);
  assert.deepStrictEqual(pack.contexts[2].skills, []);
});

// --- CLI Integration Tests ---------------------------------------------------------

function mkTmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pe-glossary-repo-'));
}

function writeSettings(repoDir, enabledPlugins) {
  fs.mkdirSync(path.join(repoDir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, '.claude', 'settings.json'),
    JSON.stringify({ enabledPlugins }, null, 2)
  );
}

function runScript(repoDir, homeDir) {
  return execFileSync(process.execPath, [SCRIPT], {
    cwd: repoDir,
    env: { ...process.env, HOME: homeDir },
    encoding: 'utf8',
  });
}

test('CLI: no-ops with no output file when private-equity is not enabled', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  writeSettings(repo, { 'wealth-management@claude-for-financial-services': true });
  const stdout = runScript(repo, home);
  assert.match(stdout, /not enabled/);
  assert.strictEqual(fs.existsSync(path.join(repo, 'specs', 'brd', 'pe-glossary-pack.json')), false);
});

test('CLI: exits 2 when private-equity is enabled but no skills directory is found', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  writeSettings(repo, { 'private-equity@claude-for-financial-services': true });
  assert.throws(
    () => runScript(repo, home),
    (err) => err.status === 2
  );
});

test('CLI: writes pe-glossary-pack.json when private-equity is enabled and skills exist', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  writeSettings(repo, { 'private-equity@claude-for-financial-services': true });
  const skillsDir = path.join(home, MARKETPLACE_SKILLS_SUBPATH);
  writeSkill(skillsDir, 'ic-memo', 'ic-memo', 'Draft an IC memo.');
  const stdout = runScript(repo, home);
  assert.match(stdout, /OK/);
  const outPath = path.join(repo, 'specs', 'brd', 'pe-glossary-pack.json');
  assert.strictEqual(fs.existsSync(outPath), true);
  const pack = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.strictEqual(pack.contexts[1].skills[0].skill, 'ic-memo');
});

test('brd/SKILL.md documents Step 2.7 seeding CONTEXT.md from pe-glossary-pack.json before Step 2.8', () => {
  const brdSkill = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'skills', 'brd', 'SKILL.md'), 'utf8'
  );
  const step27Index = brdSkill.indexOf('### Step 2.7');
  const step28Index = brdSkill.indexOf('### Step 2.8');
  assert.ok(step27Index > -1, 'expected Step 2.7 in brd/SKILL.md');
  assert.ok(step28Index > -1, 'expected Step 2.8 in brd/SKILL.md');
  assert.ok(step27Index < step28Index, 'Step 2.7 must precede Step 2.8');
  assert.match(brdSkill, /pe-glossary-pack\.js/);
  assert.match(brdSkill, /pe-glossary-pack\.json/);
});
