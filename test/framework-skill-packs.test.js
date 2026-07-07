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

// The fixture is built at the pluginSource root itself (src/config/..., src/skills/...),
// matching how scaffold-apply.js actually calls copyFrameworkPackSkills: pluginSource
// is already the harness `.claude` root (verified via .claude-plugin/plugin.json
// directly inside it), not a directory that itself contains a nested `.claude/`.
function mkHarnessFixture() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-src-'));
  fs.mkdirSync(path.join(src, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(src, 'config', 'framework-skill-packs.json'),
    JSON.stringify({
      packs: [
        { key: 'python-ai-agents', source: 'local', skills: ['langgraph-code', 'langchain-code'] },
        { key: 'langchain', source: 'github', repo: 'cwijayasundara/agent_cli_langchain', prefix: 'langchain-agents-', expected_skills: 9 },
      ],
    }, null, 2)
  );
  for (const skillName of ['langgraph-code', 'langchain-code']) {
    const dir = path.join(src, 'skills', skillName);
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

// Regression test for the pluginSource double-nesting bug: copyFrameworkPackSkills
// used to join('.claude', ...) onto a pluginSource that scaffold-apply.js's
// resolveOpts already requires to BE the harness `.claude` root, producing a
// nonexistent .claude/.claude/... path and silently no-op'ing for every real
// core/brownfield-profile invocation. The unit tests above build their fixture
// directly at the pluginSource root, so they can't catch that mismatch — only
// running the real CLI against the real harness `.claude` tree with a
// core-profile + selected pack can. This is the exact scenario that shipped broken.
const { execFileSync } = require('child_process');

test('CLI: scaffold-apply.js --scaffold-profile core with frameworkPacks copies the local pack into the target', () => {
  const SCAFFOLD_APPLY = path.join(__dirname, '..', '.claude', 'scripts', 'scaffold-apply.js');
  const PLUGIN_SOURCE = path.join(__dirname, '..', '.claude');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-apply-fwpack-'));
  const target = path.join(workDir, 'project');
  try {
    const profilePath = path.join(workDir, 'profile.json');
    fs.writeFileSync(profilePath, JSON.stringify({
      name: 'fwpack-cli',
      stack: { backend: { language: 'typescript' }, frontend: null, database: null },
      projectType: 'D',
      verificationMode: 'C',
      frameworkPacks: ['python-ai-agents'],
    }));
    execFileSync(process.execPath, [
      SCAFFOLD_APPLY,
      '--profile', profilePath,
      '--plugin-source', PLUGIN_SOURCE,
      '--target', target,
      '--scaffold-profile', 'core',
    ], { encoding: 'utf8' });

    assert.strictEqual(
      fs.existsSync(path.join(target, '.claude', 'skills', 'langgraph-code', 'SKILL.md')), true,
      'core-profile scaffold-apply with frameworkPacks:["python-ai-agents"] must copy langgraph-code'
    );
    assert.strictEqual(
      fs.existsSync(path.join(target, '.claude', 'skills', 'langchain-code', 'SKILL.md')), true,
      'core-profile scaffold-apply with frameworkPacks:["python-ai-agents"] must copy langchain-code'
    );
    assert.strictEqual(
      fs.existsSync(path.join(target, '.claude', 'skills', 'deepagents-code', 'SKILL.md')), true,
      'core-profile scaffold-apply with frameworkPacks:["python-ai-agents"] must copy deepagents-code'
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('langgraph-code skill exists with correct frontmatter and reference files', () => {
  const skillDir = path.join(__dirname, '..', '.claude', 'skills', 'langgraph-code');
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: langgraph-code\n/);
  assert.match(skill, /LangGraph/);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'graph-api.md')), true);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'persistence-and-checkpointing.md')), true);
  const graphApi = fs.readFileSync(path.join(skillDir, 'references', 'graph-api.md'), 'utf8');
  assert.match(graphApi, /docs\.langchain\.com\/oss\/python\/langgraph\/graph-api/);
  const persistence = fs.readFileSync(path.join(skillDir, 'references', 'persistence-and-checkpointing.md'), 'utf8');
  assert.match(persistence, /docs\.langchain\.com\/oss\/python\/langgraph\/persistence/);
});

test('langchain-code skill exists with correct frontmatter and reference files', () => {
  const skillDir = path.join(__dirname, '..', '.claude', 'skills', 'langchain-code');
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: langchain-code\n/);
  assert.match(skill, /create_agent/);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'agents.md')), true);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'models.md')), true);
  const agents = fs.readFileSync(path.join(skillDir, 'references', 'agents.md'), 'utf8');
  assert.match(agents, /docs\.langchain\.com\/oss\/python\/langchain\/agents/);
  const models = fs.readFileSync(path.join(skillDir, 'references', 'models.md'), 'utf8');
  assert.match(models, /docs\.langchain\.com\/oss\/python\/langchain\/models/);
});

test('deepagents-code skill exists with correct frontmatter and reference file', () => {
  const skillDir = path.join(__dirname, '..', '.claude', 'skills', 'deepagents-code');
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: deepagents-code\n/);
  assert.match(skill, /create_deep_agent/);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'architecture-and-api.md')), true);
  const arch = fs.readFileSync(path.join(skillDir, 'references', 'architecture-and-api.md'), 'utf8');
  assert.match(arch, /docs\.langchain\.com\/oss\/python\/deepagents\/overview/);
  assert.match(arch, /HarnessProfile/);
});

test('python-ai-agents pack registers exactly the three skills this plan built', () => {
  const registry = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'config', 'framework-skill-packs.json'), 'utf8'
  ));
  const local = registry.packs.find((p) => p.key === 'python-ai-agents');
  for (const skillName of local.skills) {
    assert.strictEqual(
      fs.existsSync(path.join(__dirname, '..', '.claude', 'skills', skillName, 'SKILL.md')),
      true,
      `expected .claude/skills/${skillName}/SKILL.md to exist`
    );
  }
});

test('framework-skill-packs.json registers fastapi-code and react-code as local, single-skill packs', () => {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));

  const fastapi = registry.packs.find((p) => p.key === 'fastapi-code');
  assert.ok(fastapi, 'expected a fastapi-code entry');
  assert.strictEqual(fastapi.source, 'local');
  assert.deepStrictEqual(fastapi.skills, ['fastapi-code']);

  const react = registry.packs.find((p) => p.key === 'react-code');
  assert.ok(react, 'expected a react-code entry');
  assert.strictEqual(react.source, 'local');
  assert.deepStrictEqual(react.skills, ['react-code']);

  // Existing entries must survive untouched
  const local = registry.packs.find((p) => p.key === 'python-ai-agents');
  assert.deepStrictEqual(local.skills.sort(), ['deepagents-code', 'langchain-code', 'langgraph-code'].sort());
});

test('fastapi-code skill exists with correct frontmatter and reference files', () => {
  const skillDir = path.join(__dirname, '..', '.claude', 'skills', 'fastapi-code');
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: fastapi-code\n/);
  assert.match(skill, /Depends/);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'dependency-injection-and-validation.md')), true);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'async-and-testing.md')), true);
  const di = fs.readFileSync(path.join(skillDir, 'references', 'dependency-injection-and-validation.md'), 'utf8');
  assert.match(di, /fastapi\.tiangolo\.com\/tutorial\/dependencies/);
  assert.match(di, /pydantic\.dev/);
  const asyncTesting = fs.readFileSync(path.join(skillDir, 'references', 'async-and-testing.md'), 'utf8');
  assert.match(asyncTesting, /fastapi\.tiangolo\.com\/async/);
  assert.match(asyncTesting, /fastapi\.tiangolo\.com\/tutorial\/testing/);
});

test('react-code skill exists with correct frontmatter and reference files', () => {
  const skillDir = path.join(__dirname, '..', '.claude', 'skills', 'react-code');
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: react-code\n/);
  assert.match(skill, /useEffect/);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'hooks-and-state.md')), true);
  assert.strictEqual(fs.existsSync(path.join(skillDir, 'references', 'vite-and-testing.md')), true);
  const hooks = fs.readFileSync(path.join(skillDir, 'references', 'hooks-and-state.md'), 'utf8');
  assert.match(hooks, /react\.dev\/learn\/synchronizing-with-effects/);
  const vite = fs.readFileSync(path.join(skillDir, 'references', 'vite-and-testing.md'), 'utf8');
  assert.match(vite, /vite\.dev\/guide\/env-and-mode/);
});

test('python-ai-agents, fastapi-code, and react-code packs all register skills that exist on disk', () => {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  for (const key of ['python-ai-agents', 'fastapi-code', 'react-code']) {
    const entry = registry.packs.find((p) => p.key === key);
    for (const skillName of entry.skills) {
      assert.strictEqual(
        fs.existsSync(path.join(__dirname, '..', '.claude', 'skills', skillName, 'SKILL.md')),
        true,
        `expected .claude/skills/${skillName}/SKILL.md to exist`
      );
    }
  }
});
