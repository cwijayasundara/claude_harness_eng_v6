#!/usr/bin/env node

'use strict';

// scaffold-apply.js — deterministic file generation for /scaffold (Steps 2-9).
//
// The interactive /scaffold command (.claude/commands/scaffold.md) is a
// model-executed procedure. In headless `claude -p` mode the model can emit the
// Step 10 "scaffolded successfully" report without writing anything. This script
// is the part that MUST NOT be skipped or hallucinated: given a profile JSON, it
// copies the harness `.claude` tree (via scaffold-copy.js) and writes the
// manifest, CLAUDE.md, the project-tailored README.md / SCAFFOLD_README.md,
// design.md, init.sh, security files, .mcp.json, .gitignore and the specs/ output
// dirs. Telemetry export stays opt-in via --telemetry / profile.telemetry.
//
// Out of scope (still handled by the interactive command): the telemetry/grafana
// stack copy (the dir + compose file), tracker-config files, git init and the
// `git config core.hooksPath .claude/git-hooks` wiring (the git-hooks/ tree
// itself IS copied here), framework-pack installs, subdirectory CLAUDE.md files,
// and the official-plugins enabledPlugins rebuild.
//
// CLI:
//   node scaffold-apply.js --profile <profile.json> \
//     [--plugin-source <harness .claude dir>] [--target <project dir>]
//     [--drift-workflow]
//
// --plugin-source defaults to env CLAUDE_PLUGIN_ROOT, else it is an error.
// --target defaults to process.cwd().
//
// Profile schema (all optional fields default sensibly):
//   {
//     "name": string,                 // default "untitled-project"
//     "description": string,          // free-text Q1 answer (default "")
//     "stack": {
//       "backend":  { language, version, framework, package_manager,
//                     linter, typechecker, test_runner } | null,
//       "frontend": { ...same fields } | null,
//       "database": { primary, secondary } | null
//     },
//     "projectType":      "A"|"B"|"C"|"D",   // A consumer / B internal / C api / D minimal
//     "verificationMode": "A"|"B"|"C",       // A docker / B local / C stub
//     "modelTier":        "cost"|"balanced"|"max-quality",
//     "scaffoldProfile":  "core"|"brownfield"|"full",
//     "telemetry":        boolean,
//     "tracker":          "A"|"B"|"C"|"D",   // recorded only; files out of scope
//     "frameworkPacks":   string[],          // e.g. ["python-ai-agents","langchain","google-adk"]
//     "domainVerticalPacks": string[],       // e.g. ["private-equity"]
//     "lsp":              [{ name, language }]  // OR auto-derived from stack
//   }

const fs = require('fs');
const path = require('path');
const render = require('./scaffold-render');
const encoding = require('./scaffold-encoding');
const { copyScaffoldTree, pruneSettings, resolveScaffoldProfile, copyFrameworkPackSkills } = require('./scaffold-copy');
const { refreshNavigation } = require('./navigation-refresh');

const OUTPUT_DIRS = [
  'specs/brd', 'specs/stories', 'specs/design/mockups', 'specs/design/amendments',
  'specs/reviews', 'specs/test_artefacts', 'specs/brownfield', 'sprint-contracts', 'e2e',
];

// Throw rather than process.exit so applyScaffold stays testable as a library.
// main() catches and turns this into a non-zero CLI exit with a stderr message.
function fail(msg) {
  throw new Error(msg);
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--profile') opts.profile = argv[++i];
    else if (key === '--plugin-source') opts.pluginSource = argv[++i];
    else if (key === '--target') opts.target = argv[++i];
    else if (key === '--scaffold-profile') opts.scaffoldProfile = argv[++i];
    else if (key === '--telemetry') opts.telemetry = true;
    else if (key === '--no-telemetry') opts.telemetry = false;
    else if (key === '--drift-workflow') opts.driftWorkflow = true;
    else fail(`unknown argument: ${key}`);
  }
  return opts;
}

function telemetryEnabled(profile, opts = {}) {
  if (typeof opts.telemetry === 'boolean') return opts.telemetry;
  return profile.telemetry === true;
}

// Telemetry env is opt-in. When enabled, these keys are injected into the copied
// settings, not the source. HARNESS_USER stays unset on purpose — record-run
// derives it from git user.name / the OS user.
const TELEMETRY_ENV = {
  CLAUDE_CODE_ENABLE_TELEMETRY: '1',
  OTEL_METRICS_EXPORTER: 'otlp',
  OTEL_LOGS_EXPORTER: 'otlp',
  OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4317',
  OTEL_LOG_TOOL_DETAILS: '1',
  HARNESS_PUSHGATEWAY_URL: 'http://localhost:9091',
};

// Merge TELEMETRY_ENV into the copied settings files (interactive + headless).
// Existing env keys are preserved.
function enableTelemetry(target) {
  for (const file of ['settings.json', 'settings.auto.json']) {
    const p = path.join(target, '.claude', file);
    if (!fs.existsSync(p)) continue;
    const settings = JSON.parse(fs.readFileSync(p, 'utf8'));
    settings.env = { ...(settings.env || {}), ...TELEMETRY_ENV };
    fs.writeFileSync(p, `${JSON.stringify(settings, null, 2)}\n`);
  }
}

function requireTemplate(src, rel) {
  const p = path.join(src, rel);
  if (!fs.existsSync(p)) fail(`missing required template: ${p}`);
  return p;
}

function writeManifest(target, profile) {
  const file = path.join(target, 'project-manifest.json');
  const manifest = render.buildManifest(profile);
  // custom-sensor-runner (sensors-cli parity): opt-in slot for project-declared
  // sensor commands, alongside quality. Added here rather than in buildManifest
  // itself (scaffold-render.js) because that file is already at the pre-write-gate
  // file-length hard limit (300 lines) and cannot accept new lines. The runner
  // tolerates the key's absence, so this is a convenience default only.
  manifest.custom_sensors = [];
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

function writeClaudeMd(target, src, profile) {
  const body = fs.readFileSync(requireTemplate(src, 'templates/claude-md.template.md'), 'utf8');
  const out = path.join(target, 'CLAUDE.md');
  const rendered = render.renderClaudeMd(body, profile)
    .replace('{project-encoding}', encoding.projectEncodingBlock(render.buildManifest(profile)));
  fs.writeFileSync(out, rendered);
  return out;
}
function writeReviewMd(target, src, profile) {
  const body = fs.readFileSync(requireTemplate(src, 'templates/review.template.md'), 'utf8');
  const out = path.join(target, 'REVIEW.md');
  fs.writeFileSync(out, encoding.renderReviewMd(body, profile, render));
  return out;
}

// Project-tailored user guide. New/empty repos get README.md. Brownfield repos
// keep any existing product README intact and still receive SCAFFOLD_README.md.
function writeProjectReadme(target, src, profile) {
  const body = fs.readFileSync(requireTemplate(src, 'templates/project-readme.template.md'), 'utf8');
  const rendered = render.renderProjectReadme(body, profile);
  const scaffoldReadme = path.join(target, 'SCAFFOLD_README.md');
  fs.writeFileSync(scaffoldReadme, rendered);
  const readme = path.join(target, 'README.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, rendered);
    return [scaffoldReadme, readme];
  }
  return [scaffoldReadme];
}

function writeDesignMd(target, src) {
  // design.template.md carries no {{PLACEHOLDER}} markers — copy verbatim.
  const out = path.join(target, 'design.md');
  fs.copyFileSync(requireTemplate(src, 'templates/design.template.md'), out);
  return out;
}

function writeInitSh(target, src, profile) {
  const body = fs.readFileSync(requireTemplate(src, 'templates/init-sh.template'), 'utf8');
  const out = path.join(target, 'init.sh');
  fs.writeFileSync(out, render.renderTemplate(body, render.initShValues(profile)));
  fs.chmodSync(out, 0o755);
  return out;
}

// Copy the four starter files from templates/ (Steps 3 + 8). No telemetry,
// tracker, framework-pack, or optional GitHub workflow activation files — those
// stay with the interactive command. The optional drift cadence workflow ships
// as `.claude/templates/github-workflows/harness-drift.yml` so teams can opt in
// by copying it to `.github/workflows/`.
function copyStarterFiles(target, src) {
  const map = [
    ['templates/mcp-config.template.json', '.mcp.json'],
    ['templates/claude-security-guidance.template.md', '.claude/claude-security-guidance.md'],
    ['templates/security-patterns.template.yaml', '.claude/security-patterns.yaml'],
    ['templates/gitignore.template', '.gitignore'],
    ['templates/constitution-template.md', 'specs/design/constitution.md'],
  ];
  for (const [from, to] of map) {
    const toPath = path.join(target, to);
    fs.mkdirSync(path.dirname(toPath), { recursive: true });
    fs.copyFileSync(requireTemplate(src, from), toPath);
  }
}

function driftWorkflowEnabled(profile, opts = {}) {
  return opts.driftWorkflow === true || profile?.quality?.drift?.workflow === true;
}

function copyDriftWorkflow(target, src) {
  const from = requireTemplate(src, 'templates/github-workflows/harness-drift.yml');
  const to = path.join(target, '.github', 'workflows', 'harness-drift.yml');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return to;
}

function makeDirs(target) {
  for (const d of OUTPUT_DIRS) fs.mkdirSync(path.join(target, d), { recursive: true });
}

function progressText(profile) {
  const next = profile.projectType === 'D' ? 'Run /build --lite to start' : 'Run /brd to start';
  return [
    '=== Session 0 ===', `date: ${new Date().toISOString()}`, 'mode: full',
    'groups_completed: []', 'groups_remaining: []', 'current_group: none',
    'current_stories: []', 'sprint_contract: none', 'last_commit: none',
    'features_passing: 0 / 0', 'coverage: 0%', 'learned_rules: 0',
    'blocked_stories: none', `next_action: ${next}`, '',
  ].join('\n');
}

function writeStateFiles(target, profile) {
  fs.writeFileSync(path.join(target, 'features.json'), '[]\n');
  fs.writeFileSync(path.join(target, 'claude-progress.txt'), progressText(profile));
}

// Calibration profile is skipped for type C (api-only) and D (minimal).
function writeCalibration(target, profile) {
  const cal = render.calibrationProfile(profile.projectType);
  if (!cal) return null;
  const file = path.join(target, 'calibration-profile.json');
  fs.writeFileSync(file, `${JSON.stringify(cal, null, 2)}\n`);
  return file;
}

function resolveOpts(opts) {
  if (!opts.profile) fail('--profile <profile.json> is required');
  if (!fs.existsSync(opts.profile)) fail(`profile not found: ${opts.profile}`);
  const pluginSource = opts.pluginSource || process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginSource) fail('--plugin-source or env CLAUDE_PLUGIN_ROOT is required');
  if (!fs.existsSync(path.join(pluginSource, '.claude-plugin', 'plugin.json'))) {
    fail(`plugin source is not a harness .claude root (no .claude-plugin/plugin.json): ${pluginSource}`);
  }
  return { profile: opts.profile, pluginSource, target: opts.target || process.cwd() };
}

function applyScaffold(rawOpts) {
  const { profile: profilePath, pluginSource, target } = resolveOpts(rawOpts);
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const scaffoldProfile = resolveScaffoldProfile(profile, rawOpts);
  fs.mkdirSync(target, { recursive: true });
  copyScaffoldTree(pluginSource, target, scaffoldProfile);
  copyFrameworkPackSkills(pluginSource, target, render.deriveFrameworkPacks(profile));
  pruneSettings(target, scaffoldProfile);
  if (telemetryEnabled(profile, rawOpts)) enableTelemetry(target);
  const written = [
    writeManifest(target, profile), writeClaudeMd(target, pluginSource, profile), writeReviewMd(target, pluginSource, profile),
    ...writeProjectReadme(target, pluginSource, profile),
    writeDesignMd(target, pluginSource), writeInitSh(target, pluginSource, profile),
  ];
  copyStarterFiles(target, pluginSource);
  if (driftWorkflowEnabled(profile, rawOpts)) written.push(copyDriftWorkflow(target, pluginSource));
  makeDirs(target);
  writeStateFiles(target, profile);
  const navigation = refreshNavigation({ projectDir: target, mode: 'scaffold' });
  const cal = writeCalibration(target, profile);
  if (cal) written.push(cal);
  return { target, written, profileName: profile.name || 'untitled-project', scaffoldProfile, navigation };
}

function run() {
  const result = applyScaffold(parseArgs(process.argv.slice(2)));
  report(result);
}

function report(result) {
  process.stdout.write(`scaffold applied for "${result.profileName}" into ${result.target}\n`);
  process.stdout.write(`  .claude/ tree copied (${result.scaffoldProfile} profile)\n`);
  for (const f of result.written) process.stdout.write(`  wrote ${path.relative(result.target, f)}\n`);
  process.stdout.write(`  created output dirs: ${OUTPUT_DIRS.join(', ')}\n`);
  process.stdout.write('  wrote .mcp.json, .gitignore, .claude/claude-security-guidance.md, .claude/security-patterns.yaml, specs/design/constitution.md\n');
  process.stdout.write('  wrote features.json, claude-progress.txt\n');
  process.stdout.write(`  navigation: ${result.navigation.status} (${result.navigation.graph}/${result.navigation.wiki})\n`);
}

module.exports = { applyScaffold, parseArgs };

if (require.main === module) {
  try {
    run();
  } catch (err) {
    process.stderr.write(`scaffold-apply: ${err.message}\n`);
    process.exit(1);
  }
}
