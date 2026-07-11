'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyScaffold } = require('../.claude/scripts/scaffold-apply');
const { buildManifest, renderProjectReadme } = require('../.claude/scripts/scaffold-render');

const README_TEMPLATE = fs.readFileSync(
  path.resolve(__dirname, '..', '.claude', 'templates', 'project-readme.template.md'), 'utf8');

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
    assert.deepStrictEqual(manifest.token_governor, {
      enabled: true,
      mode: 'advisory',
      living_navigation: true,
      context_search_required: true,
      max_source_read_lines: 300,
      tool_output_token_estimates: true,
      compress_tool_output: true,
      ccr_enabled: true,
      preserve_full_outputs: true,
      budget_warn_pct: 80,
    });

    const claudeMd = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    assert.ok(claudeMd.length > 0, 'CLAUDE.md should be non-empty');
    assert.ok(claudeMd.includes('sample-cli'), 'CLAUDE.md should mention the project name');

    // Project-tailored dashboard guide (not a verbatim harness-README copy):
    // names the project, recommends the lite lane for this type-D CLI, and
    // omits harness-dev-only sections that a project user shouldn't see.
    const scaffoldReadme = fs.readFileSync(path.join(target, 'SCAFFOLD_README.md'), 'utf8');
    const readme = fs.readFileSync(path.join(target, 'README.md'), 'utf8');
    assert.strictEqual(readme, scaffoldReadme, 'empty scaffolded projects should receive README.md too');
    assert.ok(readme.includes('sample-cli'), 'README must name the project');
    assert.match(readme, /Pick The Work Route/, 'README must use the route dashboard');
    assert.match(readme, /\/build --lite/, 'a type-D CLI must be steered to the lite lane');
    assert.match(readme, /Telemetry/, 'guide must cover telemetry');
    assert.doesNotMatch(readme, /\{\{[A-Z_]+\}\}/, 'no unrendered placeholders');
    assert.doesNotMatch(readme, /npm run test:smoke|Testing This Harness/, 'must not carry harness-dev-only sections');

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

    // Telemetry ships ON in scaffolded projects (both interactive + headless),
    // only when explicitly requested. The lean default keeps record-run wired
    // but leaves push/OTEL env absent so small projects do not start with ops
    // machinery in their first-run surface.
    for (const s of [settings, autoSettings]) {
      assert.ok(!('CLAUDE_CODE_ENABLE_TELEMETRY' in s.env), 'telemetry must be opt-in');
      assert.ok(!('HARNESS_PUSHGATEWAY_URL' in s.env), 'record-run push must be opt-in');
      assert.ok(!('OTEL_EXPORTER_OTLP_ENDPOINT' in s.env), 'OTEL export must be opt-in');
      assert.strictEqual(s.env.CLAUDE_AUTO_CONTINUE, '1', 'existing env keys must be preserved');
    }
    // HARNESS_USER stays unset — the record-run hook derives it from git/OS.
    assert.ok(!('HARNESS_USER' in settings.env), 'HARNESS_USER must be left for the hook to derive');

    const initSh = fs.readFileSync(path.join(target, 'init.sh'), 'utf8');
    assert.ok(!initSh.includes('{{'), 'init.sh must not contain leftover {{ placeholders');
    assert.ok((fs.statSync(path.join(target, 'init.sh')).mode & 0o100) !== 0, 'init.sh should be executable');

    for (const d of ['specs/brd', 'specs/stories', 'specs/design/mockups', 'sprint-contracts', 'e2e']) {
      assert.ok(fs.statSync(path.join(target, d)).isDirectory(), `${d} should exist`);
    }

    const navStatus = JSON.parse(fs.readFileSync(path.join(target, '.claude', 'state', 'navigation-status.json'), 'utf8'));
    assert.strictEqual(navStatus.status, 'placeholder');
    assert.strictEqual(navStatus.graph, 'placeholder');
    assert.strictEqual(navStatus.wiki, 'placeholder');
    assert.strictEqual(navStatus.source_files, 0);
    const graph = JSON.parse(fs.readFileSync(path.join(target, 'specs', 'brownfield', 'code-graph.json'), 'utf8'));
    assert.deepStrictEqual(graph.nodes, []);
    assert.deepStrictEqual(graph.edges, []);
    assert.strictEqual(graph.meta.status, 'empty');
    assert.strictEqual(graph.meta.reason, 'no source files');
    const wiki = fs.readFileSync(path.join(target, 'specs', 'brownfield', 'wiki', 'WIKI.md'), 'utf8');
    assert.match(wiki, /No source code has been created yet/);

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

test('applyScaffold bootstraps code-map and wiki immediately for source-bearing repos', () => {
  const workDir = makeTempDir();
  const target = path.join(workDir, 'project');
  try {
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    fs.writeFileSync(path.join(target, 'src', 'index.py'), 'def greet(name: str) -> str:\n    return f"hello {name}"\n');
    const profilePath = writeProfile(workDir, MINIMAL_NODE_PROFILE);
    const result = applyScaffold({ profile: profilePath, pluginSource: PLUGIN_SOURCE, target });

    assert.strictEqual(result.navigation.status, 'fresh');
    assert.strictEqual(result.navigation.mode, 'bootstrap');
    const navStatus = JSON.parse(fs.readFileSync(path.join(target, '.claude', 'state', 'navigation-status.json'), 'utf8'));
    assert.strictEqual(navStatus.status, 'fresh');
    assert.ok(navStatus.source_files >= 1, JSON.stringify(navStatus));
    assert.ok(navStatus.indexed_files >= 1, JSON.stringify(navStatus));
    const graph = JSON.parse(fs.readFileSync(path.join(target, 'specs', 'brownfield', 'code-graph.json'), 'utf8'));
    assert.notStrictEqual(graph.meta.status, 'empty');
    assert.ok(graph.files.some((file) => file.path === 'src/index.py'), 'source file should be indexed');
    const map = fs.readFileSync(path.join(target, 'specs', 'brownfield', 'symbol-map.md'), 'utf8');
    assert.match(map, /greet/);
    const wiki = fs.readFileSync(path.join(target, 'specs', 'brownfield', 'wiki', 'WIKI.md'), 'utf8');
    assert.match(wiki, /Codebase Wiki/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('applyScaffold preserves an existing README.md while writing SCAFFOLD_README.md', () => {
  const workDir = makeTempDir();
  const target = path.join(workDir, 'project');
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'README.md'), '# Existing product README\n');
    const profilePath = writeProfile(workDir, MINIMAL_NODE_PROFILE);
    applyScaffold({ profile: profilePath, pluginSource: PLUGIN_SOURCE, target });

    const readme = fs.readFileSync(path.join(target, 'README.md'), 'utf8');
    const scaffoldReadme = fs.readFileSync(path.join(target, 'SCAFFOLD_README.md'), 'utf8');
    assert.strictEqual(readme, '# Existing product README\n');
    assert.match(scaffoldReadme, /Claude Harness Dashboard/);
    assert.match(scaffoldReadme, /Pick The Work Route/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('core scaffold profile ships the lean product-development spine by default', () => {
  const workDir = makeTempDir();
  const target = path.join(workDir, 'project');
  try {
    const profilePath = writeProfile(workDir, MINIMAL_NODE_PROFILE);
    const result = applyScaffold({ profile: profilePath, pluginSource: PLUGIN_SOURCE, target });

    assert.strictEqual(result.scaffoldProfile, 'core');
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'build', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'auto', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'gate', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'feature', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'brownfield', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'code-map', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'change', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'refactor', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'vibe', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'tracker-publish', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'scripts', 'build-chain.js')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'scripts', 'navigation-refresh.js')),
      'core must copy living navigation refresh because graph-refresh depends on it');
    assert.ok(fs.existsSync(path.join(target, '.claude', 'scripts', 'ci-ingest.js')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'scripts', 'flag-scan.js')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'scripts', 'telemetry-memory.js')),
      'record-run dependency stays copied even when telemetry export is off');
    assert.ok(fs.existsSync(path.join(target, '.claude', 'agents', 'codebase-explorer.md')),
      'core keeps the read-only explorer because Sprint 2+ is brownfield');

    assert.ok(!fs.existsSync(path.join(target, '.claude', 'skills', 'install-framework-packs')),
      'core should not ship framework-pack installer');
    assert.ok(!fs.existsSync(path.join(target, '.claude', 'skills', 'pe-ic-memo')),
      'core should not ship vertical PE IC memo skill');
    assert.ok(!fs.existsSync(path.join(target, '.claude', 'scripts', 'replay-telemetry.js')),
      'core should not ship telemetry replay tooling');
    assert.ok(!fs.existsSync(path.join(target, '.claude', 'scripts', 'upstream-watch.js')),
      'core should not ship upstream ops watch tooling');

    const manifest = JSON.parse(fs.readFileSync(path.join(target, 'project-manifest.json'), 'utf8'));
    assert.ok(manifest.quality && manifest.quality.sensor_tier,
      'scaffold must write quality.sensor_tier');
    assert.ok(['minimal', 'standard', 'strict'].includes(manifest.quality.sensor_tier));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('brownfield scaffold profile is a backward-compatible alias for core product development', () => {
  const workDir = makeTempDir();
  const target = path.join(workDir, 'project');
  try {
    const profile = { ...MINIMAL_NODE_PROFILE, scaffoldProfile: 'brownfield' };
    const profilePath = writeProfile(workDir, profile);
    const result = applyScaffold({ profile: profilePath, pluginSource: PLUGIN_SOURCE, target });

    assert.strictEqual(result.scaffoldProfile, 'brownfield');
    for (const skill of ['feature', 'brownfield', 'change', 'refactor', 'vibe', 'code-map', 'seam-finder', 'tracker-publish']) {
      assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', skill, 'SKILL.md')), `${skill} should be copied`);
    }
    assert.ok(fs.existsSync(path.join(target, '.claude', 'agents', 'codebase-explorer.md')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'scripts', 'ci-ingest.js')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'scripts', 'flag-scan.js')));
    assert.ok(!fs.existsSync(path.join(target, '.claude', 'scripts', 'upstream-watch.js')));
    assert.ok(!fs.existsSync(path.join(target, '.claude', 'scripts', 'replay-telemetry.js')));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('full-stack projects also default to core; full is explicit only', () => {
  const workDir = makeTempDir();
  const target = path.join(workDir, 'project');
  try {
    const profile = {
      ...MINIMAL_NODE_PROFILE,
      name: 'sample-app',
      projectType: 'A',
      stack: {
        backend: { language: 'python', framework: 'fastapi' },
        frontend: { language: 'typescript', framework: 'react' },
        database: { primary: 'postgres' },
      },
    };
    const profilePath = writeProfile(workDir, profile);
    const result = applyScaffold({ profile: profilePath, pluginSource: PLUGIN_SOURCE, target });

    assert.strictEqual(result.scaffoldProfile, 'core');
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'feature', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'brownfield', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(target, '.claude', 'scripts', 'upstream-watch.js')));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('full scaffold profile preserves the complete harness copy and can opt into telemetry', () => {
  const workDir = makeTempDir();
  const target = path.join(workDir, 'project');
  try {
    const profile = { ...MINIMAL_NODE_PROFILE, scaffoldProfile: 'full', telemetry: true };
    const profilePath = writeProfile(workDir, profile);
    const result = applyScaffold({ profile: profilePath, pluginSource: PLUGIN_SOURCE, target });

    assert.strictEqual(result.scaffoldProfile, 'full');
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'tracker-publish', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'skills', 'brownfield', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'scripts', 'upstream-watch.js')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'scripts', 'replay-telemetry.js')));

    const settings = JSON.parse(fs.readFileSync(path.join(target, '.claude', 'settings.json'), 'utf8'));
    const autoSettings = JSON.parse(fs.readFileSync(path.join(target, '.claude', 'settings.auto.json'), 'utf8'));
    for (const s of [settings, autoSettings]) {
      assert.strictEqual(s.env.CLAUDE_CODE_ENABLE_TELEMETRY, '1');
      assert.strictEqual(s.env.HARNESS_PUSHGATEWAY_URL, 'http://localhost:9091');
      assert.strictEqual(s.env.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://localhost:4317');
      assert.strictEqual(s.env.CLAUDE_AUTO_CONTINUE, '1');
    }
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

test('non-web CLI/library stacks default to the lite posture even with backend metadata', () => {
  const m = buildManifest({
    name: 'url-summarizer',
    description: 'Python CLI utility that summarizes URLs',
    stack: {
      backend: { language: 'python', version: '3.12', package_manager: 'uv', test_runner: 'pytest' },
      frontend: null,
      database: null,
    },
  });

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

test('the project README is tailored per shape (lite CLI vs full-stack)', () => {
  const cli = renderProjectReadme(README_TEMPLATE, {
    name: 'todo-cli', description: 'a todo manager', projectType: 'D', stack: {},
  });
  assert.match(cli, /todo-cli/);
  assert.match(cli, /Minimal — CLI \/ library \/ single-script/);
  assert.match(cli, /\/build --lite "todo-cli: a todo manager"/);
  assert.match(cli, /cost \(Sonnet generation\)/);
  assert.doesNotMatch(cli, /\{\{[A-Z_]+\}\}/);

  const app = renderProjectReadme(README_TEMPLATE, {
    name: 'shop', projectType: 'A',
    stack: { backend: { language: 'python' }, frontend: { language: 'react' } },
  });
  assert.match(app, /Consumer-facing app/);
  assert.match(app, /\/build docs\/prd\.md --auto/);
  assert.match(app, /cost \(Sonnet generation\)/);
  assert.doesNotMatch(app, /\{\{[A-Z_]+\}\}/);
});

test('full-stack projects default to cost + full + docker (enterprise Token Saver)', () => {
  const m = buildManifest({
    name: 'app', projectType: 'A',
    stack: { backend: { language: 'python' }, frontend: { language: 'react' } },
  });
  assert.strictEqual(m.execution.model_tier, 'cost');
  assert.strictEqual(m.execution.ceremony, 'full');
  assert.strictEqual(m.verification.mode, 'docker');
  assert.strictEqual(m.architecture, undefined);
});
