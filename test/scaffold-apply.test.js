'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyScaffold } = require('../.claude/scripts/scaffold-apply');
const { buildManifest } = require('../.claude/scripts/scaffold-render');

// The harness's own .claude is the plugin source. This file lives in <repo>/test/,
// so the harness .claude root is ../.claude from here.
const PLUGIN_SOURCE = path.resolve(__dirname, '..', '.claude');

const MINIMAL_NODE_PROFILE = {
  name: 'sample-cli',
  description: 'A tiny Node CLI utility for testing the scaffold-apply script.',
  stack: {
    backend: {
      language: 'typescript', version: 'node20', framework: null,
      package_manager: 'npm', linter: 'eslint', typechecker: 'tsc', test_runner: 'node:test',
    },
    frontend: null,
    database: null,
  },
  projectType: 'D',
  verificationMode: 'C',
  modelTier: 'balanced',
  tracker: 'A',
  frameworkPacks: [],
  lsp: [{ name: 'typescript-language-server', language: 'typescript' }],
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-apply-'));
}

function writeProfile(dir, profile) {
  const p = path.join(dir, 'profile.json');
  fs.writeFileSync(p, JSON.stringify(profile));
  return p;
}

test('applyScaffold produces a real scaffold from a Minimal Node profile', () => {
  const workDir = makeTempDir();
  const target = path.join(workDir, 'project');
  try {
    const profilePath = writeProfile(workDir, MINIMAL_NODE_PROFILE);
    applyScaffold({ profile: profilePath, pluginSource: PLUGIN_SOURCE, target });

    const manifestRaw = fs.readFileSync(path.join(target, 'project-manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw);
    assert.strictEqual(manifest.name, 'sample-cli');
    assert.strictEqual(manifest.execution.model_tier, 'balanced');
    assert.strictEqual(manifest.verification.mode, 'stub');
    assert.deepStrictEqual(manifest.architecture, { enabled: false });

    const claudeMd = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    assert.ok(claudeMd.length > 0, 'CLAUDE.md should be non-empty');
    assert.ok(claudeMd.includes('sample-cli'), 'CLAUDE.md should mention the project name');

    assert.ok(fs.statSync(path.join(target, '.claude', 'agents')).isDirectory());
    assert.ok(fs.statSync(path.join(target, '.claude', 'skills')).isDirectory());
    assert.ok(fs.statSync(path.join(target, '.claude', 'state')).isDirectory());

    // The interactive settings ships auto-continue on; the unattended profile
    // ships the no-prompt permission set used by headless `--auto` runs.
    const settings = JSON.parse(fs.readFileSync(path.join(target, '.claude', 'settings.json'), 'utf8'));
    assert.strictEqual(settings.env.CLAUDE_AUTO_CONTINUE, '1', 'scaffolded settings.json must enable auto-continue');
    const autoSettings = JSON.parse(fs.readFileSync(path.join(target, '.claude', 'settings.auto.json'), 'utf8'));
    assert.ok(autoSettings.permissions.allow.includes('Bash(*)'), 'settings.auto.json must allow Bash for unattended runs');
    assert.strictEqual(autoSettings.env.CLAUDE_AUTO_CONTINUE, '1', 'settings.auto.json must force auto-continue');

    const initSh = fs.readFileSync(path.join(target, 'init.sh'), 'utf8');
    assert.ok(!initSh.includes('{{'), 'init.sh must not contain leftover {{ placeholders');
    assert.ok((fs.statSync(path.join(target, 'init.sh')).mode & 0o100) !== 0, 'init.sh should be executable');

    for (const d of ['specs/brd', 'specs/stories', 'specs/design/mockups', 'sprint-contracts', 'e2e']) {
      assert.ok(fs.statSync(path.join(target, d)).isDirectory(), `${d} should exist`);
    }

    assert.ok(fs.existsSync(path.join(target, '.mcp.json')));
    assert.ok(fs.existsSync(path.join(target, '.gitignore')));
    assert.ok(fs.existsSync(path.join(target, 'features.json')));
    assert.ok(fs.existsSync(path.join(target, 'claude-progress.txt')));

    // Minimal (type D) skips calibration-profile.json.
    assert.ok(!fs.existsSync(path.join(target, 'calibration-profile.json')),
      'type D must not write calibration-profile.json');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('applyScaffold throws clearly when plugin source is invalid', () => {
  const workDir = makeTempDir();
  try {
    const profilePath = writeProfile(workDir, MINIMAL_NODE_PROFILE);
    assert.throws(
      () => applyScaffold({ profile: profilePath, pluginSource: workDir, target: path.join(workDir, 'p') }),
      /plugin source is not a harness/i,
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('applyScaffold throws when --profile is missing', () => {
  assert.throws(() => applyScaffold({ pluginSource: PLUGIN_SOURCE }), /--profile/);
});

test('lite-shaped projects default to the cheap cost posture', () => {
  // A type-D CLI with no explicit posture fields gets cost + trimmed + local.
  const m = buildManifest({ name: 'cli', projectType: 'D', stack: {} });
  assert.strictEqual(m.execution.model_tier, 'cost');
  assert.strictEqual(m.execution.ceremony, 'trimmed');
  assert.strictEqual(m.verification.mode, 'local');
  assert.deepStrictEqual(m.architecture, { enabled: false });
});

test('explicit posture fields override the lite defaults', () => {
  const m = buildManifest({
    name: 'cli', projectType: 'D', stack: {},
    modelTier: 'balanced', ceremony: 'full', verificationMode: 'C',
  });
  assert.strictEqual(m.execution.model_tier, 'balanced');
  assert.strictEqual(m.execution.ceremony, 'full');
  assert.strictEqual(m.verification.mode, 'stub');
});

test('full-stack projects keep balanced + full + docker', () => {
  const m = buildManifest({
    name: 'app', projectType: 'A',
    stack: { backend: { language: 'python' }, frontend: { language: 'react' } },
  });
  assert.strictEqual(m.execution.model_tier, 'balanced');
  assert.strictEqual(m.execution.ceremony, 'full');
  assert.strictEqual(m.verification.mode, 'docker');
  assert.strictEqual(m.architecture, undefined);
});
