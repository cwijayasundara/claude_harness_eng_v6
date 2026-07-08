'use strict';

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { buildManifest, deriveFrameworkPacks } = require(
  path.join(__dirname, '..', '.claude', 'scripts', 'scaffold-render.js')
);

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
    path.join(repo, '.claude', 'config', 'scaffold-packs.json'),
    JSON.stringify({ verticalPacks: [testRegistryEntry('private-equity'), testRegistryEntry('wealth-management')] }, null, 2)
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

test('scaffold.md documents the combined tech-stack + domain-vertical question and both report families', () => {
  const scaffoldMd = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'commands', 'scaffold.md'), 'utf8'
  );
  assert.match(scaffoldMd, /domainVerticalPacks/);
  assert.match(scaffoldMd, /scaffold-packs\.json/);
  assert.match(scaffoldMd, /scaffold-vertical-status\.js/);
  assert.match(scaffoldMd, /claude plugin marketplace add/);
  assert.match(scaffoldMd, /claude plugin install/);
  // The existing framework-pack flow must still be present, unchanged in spirit:
  assert.match(scaffoldMd, /npx --yes skills add cwijayasundara\/agent_cli_langchain/);
  assert.match(scaffoldMd, /framework_skill_packs/);
});

test('scaffold.md wires the local tech pack and domain vertical into Step 1\'s question flow, not just the reference section', () => {
  const scaffoldMd = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'commands', 'scaffold.md'), 'utf8'
  );
  const referenceSectionIndex = scaffoldMd.indexOf('### Optional Agent-Framework Skill Packs & Domain Vertical Plugins');
  assert.notStrictEqual(referenceSectionIndex, -1, 'reference section heading should exist');
  const step1Section = scaffoldMd.slice(0, referenceSectionIndex);

  assert.match(step1Section, /Enable a domain-vertical plugin\?/);
  assert.match(step1Section, /Python AI Agents \(LangGraph \/ LangChain \/ DeepAgents\)/);

  const scaffoldApplyJs = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'scripts', 'scaffold-apply.js'), 'utf8'
  );
  assert.match(scaffoldApplyJs, /domainVerticalPacks/);
});

test('scaffold.md Step 2 auto-attaches fastapi-code and react-code based on the chosen stack', () => {
  const scaffoldMd = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'commands', 'scaffold.md'), 'utf8'
  );
  const step2Index = scaffoldMd.indexOf('## Step 2: Generate project-manifest.json');
  const step3Index = scaffoldMd.indexOf('## Step 3');
  assert.ok(step2Index > -1, 'expected Step 2 heading in scaffold.md');
  assert.ok(step3Index > step2Index, 'expected Step 3 to follow Step 2');
  const step2Section = scaffoldMd.slice(step2Index, step3Index);
  assert.match(step2Section, /fastapi-code/);
  assert.match(step2Section, /react-code/);
  assert.match(step2Section, /stack\.backend\.framework/);
  assert.match(step2Section, /stack\.frontend\.framework/);
  assert.match(step2Section, /nextjs/);
});

test('copyFrameworkPackSkills copies fastapi-code when selected via an auto-attached frameworkPacks entry', () => {
  const { copyFrameworkPackSkills } = require(
    path.join(__dirname, '..', '.claude', 'scripts', 'scaffold-copy.js')
  );
  const src = path.join(__dirname, '..', '.claude');
  const target = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fastapi-attach-'));
  // Simulates what Step 2's auto-attach rule produces for a FastAPI-backend profile:
  // frameworkPacks includes "fastapi-code" even though the user never answered a
  // separate framework-pack question about it.
  copyFrameworkPackSkills(src, target, ['fastapi-code', 'react-code']);
  assert.strictEqual(fs.existsSync(path.join(target, '.claude', 'skills', 'fastapi-code', 'SKILL.md')), true);
  assert.strictEqual(fs.existsSync(path.join(target, '.claude', 'skills', 'react-code', 'SKILL.md')), true);
});

test('deriveFrameworkPacks adds fastapi-code when stack.backend.framework is fastapi', () => {
  const packs = deriveFrameworkPacks({ stack: { backend: { framework: 'fastapi' } } });
  assert.deepStrictEqual(packs, ['fastapi-code']);
});

test('deriveFrameworkPacks adds react-code when stack.frontend.framework is react', () => {
  const packs = deriveFrameworkPacks({ stack: { frontend: { framework: 'react' } } });
  assert.deepStrictEqual(packs, ['react-code']);
});

test('deriveFrameworkPacks does NOT add react-code for nextjs', () => {
  const packs = deriveFrameworkPacks({ stack: { frontend: { framework: 'nextjs' } } });
  assert.deepStrictEqual(packs, []);
});

test('deriveFrameworkPacks combines an explicit pack with both auto-derived ones, deduped', () => {
  const packs = deriveFrameworkPacks({
    frameworkPacks: ['python-ai-agents'],
    stack: { backend: { framework: 'fastapi' }, frontend: { framework: 'react' } },
  });
  assert.deepStrictEqual(packs.sort(), ['fastapi-code', 'python-ai-agents', 'react-code'].sort());
});

test('deriveFrameworkPacks returns explicit packs unchanged when stack is absent or non-matching', () => {
  assert.deepStrictEqual(deriveFrameworkPacks({ frameworkPacks: ['google-adk'] }), ['google-adk']);
  assert.deepStrictEqual(deriveFrameworkPacks({}), []);
});

test('buildManifest.framework_skill_packs reflects auto-derived packs even with an empty explicit frameworkPacks', () => {
  const manifest = buildManifest({
    name: 'auto-attach-test',
    stack: { backend: { framework: 'fastapi' }, frontend: { framework: 'react' } },
  });
  assert.deepStrictEqual(manifest.framework_skill_packs.sort(), ['fastapi-code', 'react-code'].sort());
});

test('CLI: scaffold-apply.js copies fastapi-code and react-code for a matching stack with NO explicit frameworkPacks selection', () => {
  const SCAFFOLD_APPLY = path.join(__dirname, '..', '.claude', 'scripts', 'scaffold-apply.js');
  const PLUGIN_SOURCE = path.join(__dirname, '..', '.claude');
  const workDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'scaffold-apply-autopack-'));
  const target = path.join(workDir, 'project');
  try {
    const profilePath = path.join(workDir, 'profile.json');
    fs.writeFileSync(profilePath, JSON.stringify({
      name: 'autopack-cli',
      stack: {
        backend: { language: 'python', framework: 'fastapi' },
        frontend: { language: 'typescript', framework: 'react' },
        database: null,
      },
      projectType: 'A',
      verificationMode: 'C',
      // frameworkPacks intentionally omitted — proves the auto-attach fires without an explicit selection.
    }));
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath, [
      SCAFFOLD_APPLY,
      '--profile', profilePath,
      '--plugin-source', PLUGIN_SOURCE,
      '--target', target,
      '--scaffold-profile', 'core',
    ], { encoding: 'utf8' });

    assert.strictEqual(fs.existsSync(path.join(target, '.claude', 'skills', 'fastapi-code', 'SKILL.md')), true);
    assert.strictEqual(fs.existsSync(path.join(target, '.claude', 'skills', 'react-code', 'SKILL.md')), true);
    const manifest = JSON.parse(fs.readFileSync(path.join(target, 'project-manifest.json'), 'utf8'));
    assert.deepStrictEqual(manifest.framework_skill_packs.sort(), ['fastapi-code', 'react-code'].sort());
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
