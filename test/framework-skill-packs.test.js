'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const REGISTRY_PATH = path.join(__dirname, '..', '.claude', 'config', 'framework-skill-packs.json');

test('framework-skill-packs.json registers the local python-ai-agents pack and both existing external packs', () => {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  assert.ok(Array.isArray(registry.packs));

  const local = registry.packs.find((p) => p.key === 'python-ai-agents');
  assert.ok(local, 'expected a python-ai-agents entry');
  assert.strictEqual(local.source, 'local');
  assert.deepStrictEqual(local.skills.sort(), ['deepagents-code', 'langchain-code', 'langgraph-code'].sort());

  const langchain = registry.packs.find((p) => p.key === 'langchain');
  assert.ok(langchain, 'expected the existing langchain entry to survive migration');
  assert.strictEqual(langchain.source, 'github');
  assert.strictEqual(langchain.repo, 'cwijayasundara/agent_cli_langchain');
  assert.strictEqual(langchain.prefix, 'langchain-agents-');
  assert.strictEqual(langchain.expected_skills, 9);

  const googleAdk = registry.packs.find((p) => p.key === 'google-adk');
  assert.ok(googleAdk, 'expected the existing google-adk entry to survive migration');
  assert.strictEqual(googleAdk.source, 'github');
  assert.strictEqual(googleAdk.repo, 'google/agents-cli');
  assert.strictEqual(googleAdk.prefix, 'google-agents-cli-');
  assert.strictEqual(googleAdk.expected_skills, 7);
});

test('install-framework-packs/SKILL.md references the registry file instead of a hardcoded table', () => {
  const skill = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'skills', 'install-framework-packs', 'SKILL.md'), 'utf8'
  );
  assert.match(skill, /framework-skill-packs\.json/);
});

const os = require('os');
const { copyFrameworkPackSkills } = require(
  path.join(__dirname, '..', '.claude', 'scripts', 'scaffold-copy.js')
);

function mkHarnessFixture() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-src-'));
  fs.mkdirSync(path.join(src, '.claude', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(src, '.claude', 'config', 'framework-skill-packs.json'),
    JSON.stringify({
      packs: [
        { key: 'python-ai-agents', source: 'local', skills: ['langgraph-code', 'langchain-code'] },
        { key: 'langchain', source: 'github', repo: 'cwijayasundara/agent_cli_langchain', prefix: 'langchain-agents-', expected_skills: 9 },
      ],
    }, null, 2)
  );
  for (const skillName of ['langgraph-code', 'langchain-code']) {
    const dir = path.join(src, '.claude', 'skills', skillName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${skillName}\ndescription: test\n---\n`);
  }
  return src;
}

test('copyFrameworkPackSkills copies a local pack\'s skill directories when selected', () => {
  const src = mkHarnessFixture();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'target-'));
  copyFrameworkPackSkills(src, target, ['python-ai-agents']);
  assert.strictEqual(fs.existsSync(path.join(target, '.claude', 'skills', 'langgraph-code', 'SKILL.md')), true);
  assert.strictEqual(fs.existsSync(path.join(target, '.claude', 'skills', 'langchain-code', 'SKILL.md')), true);
});

test('copyFrameworkPackSkills does nothing for a github-source pack (external, manual install)', () => {
  const src = mkHarnessFixture();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'target-'));
  copyFrameworkPackSkills(src, target, ['langchain']);
  assert.strictEqual(fs.existsSync(path.join(target, '.claude', 'skills', 'langgraph-code')), false);
});

test('copyFrameworkPackSkills does nothing when frameworkSkillPacks is empty or undefined', () => {
  const src = mkHarnessFixture();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'target-'));
  copyFrameworkPackSkills(src, target, []);
  copyFrameworkPackSkills(src, target, undefined);
  assert.strictEqual(fs.existsSync(path.join(target, '.claude', 'skills')), false);
});
