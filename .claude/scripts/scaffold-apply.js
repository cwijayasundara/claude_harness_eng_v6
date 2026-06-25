#!/usr/bin/env node

'use strict';

// scaffold-apply.js — deterministic file generation for /scaffold (Steps 2-9).
//
// The interactive /scaffold command (.claude/commands/scaffold.md) is a
// model-executed procedure. In headless `claude -p` mode the model can emit the
// Step 10 "scaffolded successfully" report without writing anything. This script
// is the part that MUST NOT be skipped or hallucinated: given a profile JSON, it
// copies the harness `.claude` tree and writes the manifest, CLAUDE.md, the
// project-tailored README.md / SCAFFOLD_README.md, design.md, init.sh, security files,
// .mcp.json, .gitignore and the specs/ output dirs. Telemetry export stays
// opt-in via --telemetry / profile.telemetry.
//
// Out of scope (still handled by the interactive command): the telemetry/grafana
// stack copy (the dir + compose file), tracker-config files, git init + git-hooks,
// framework-pack installs, subdirectory CLAUDE.md files, and the official-plugins
// enabledPlugins rebuild.
//
// CLI:
//   node scaffold-apply.js --profile <profile.json> \
//     [--plugin-source <harness .claude dir>] [--target <project dir>]
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
//     "frameworkPacks":   string[],          // e.g. ["langchain","google-adk"]
//     "lsp":              [{ name, language }]  // OR auto-derived from stack
//   }

const fs = require('fs');
const path = require('path');
const render = require('./scaffold-render');

const OUTPUT_DIRS = [
  'specs/brd', 'specs/stories', 'specs/design/mockups', 'specs/design/amendments',
  'specs/reviews', 'specs/test_artefacts', 'specs/brownfield', 'sprint-contracts', 'e2e',
];

const SCAFFOLD_PROFILES = new Set(['core', 'brownfield', 'full']);

const CORE_AGENTS = [
  'clean-code-reviewer.md', 'design-critic.md', 'diff-reviewer.md',
  'evaluator.md', 'generator.md', 'planner.md', 'security-reviewer.md',
  'codebase-explorer.md',
];
const BROWNFIELD_AGENTS = [...CORE_AGENTS];

const CORE_SKILLS = [
  'auto', 'brd', 'build', 'clarify', 'code-gen', 'deploy', 'design',
  'evaluate', 'gate', 'implement', 'spec', 'status', 'test',
  'feature', 'brownfield', 'change', 'checking-coverage-before-change',
  'checking-migration-safety', 'code-map', 'keeping-refactors-pure',
  'pinning-down-behavior', 'refactor', 'seam-finder',
  'sprouting-instead-of-editing', 'tracker-publish',
  'upgrading-dependencies', 'vibe',
];
const BROWNFIELD_SKILLS = [
  ...CORE_SKILLS,
];

const CORE_SCRIPTS = [
  'archive-state.js',
  'budget-state.js',
  'build-chain-state.js',
  'build-chain.js',
  'build-lane.js',
  'ci-ingest.js',
  'constraints-extract.js',
  'coverage-diff.js',
  'cr-index.js',
  'flag-scan.js',
  'model-tier.js',
  'mutation-smoke.js',
  'perf-baseline.js',
  'pipeline-snapshot.js',
  'pipeline-state-readers.js',
  'pipeline-status.js',
  'plan-confidence.js',
  'telemetry-ledger-rotate.js',
  'telemetry-memory.js',
  'telemetry-phase-eval.js',
  'telemetry-pipeline-gauges.js',
  'telemetry-skill-helpers.js',
  'trace-check.js',
  'validate-contract.js',
];
const BROWNFIELD_SCRIPTS = [
  ...CORE_SCRIPTS,
];

const LEAN_PLUGIN_ALLOWLIST = {
  'playwright@claude-plugins-official': true,
  'superpowers@claude-plugins-official': true,
};

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
    else fail(`unknown argument: ${key}`);
  }
  return opts;
}

function copyTree(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function copyDirContents(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir)) {
    fs.cpSync(path.join(srcDir, entry), path.join(destDir, entry), { recursive: true });
  }
}

function copyNamedFiles(srcDir, destDir, names) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of names) copyTree(path.join(srcDir, name), path.join(destDir, name));
}

function selectedCopySet(profileName) {
  if (profileName === 'full') return null;
  if (profileName === 'brownfield') {
    return { agents: BROWNFIELD_AGENTS, skills: BROWNFIELD_SKILLS, scripts: BROWNFIELD_SCRIPTS };
  }
  return { agents: CORE_AGENTS, skills: CORE_SKILLS, scripts: CORE_SCRIPTS };
}

function resolveScaffoldProfile(profile, opts = {}) {
  const requested = opts.scaffoldProfile || profile.scaffoldProfile || null;
  const resolved = requested || 'core';
  if (!SCAFFOLD_PROFILES.has(resolved)) {
    fail(`unknown scaffold profile: ${resolved} (expected core, brownfield, or full)`);
  }
  return resolved;
}

function telemetryEnabled(profile, opts = {}) {
  if (typeof opts.telemetry === 'boolean') return opts.telemetry;
  return profile.telemetry === true;
}

function pruneSettings(target, profileName) {
  if (profileName === 'full') return;
  for (const file of ['settings.json', 'settings.auto.json']) {
    const p = path.join(target, '.claude', file);
    if (!fs.existsSync(p)) continue;
    const settings = JSON.parse(fs.readFileSync(p, 'utf8'));
    settings.enabledPlugins = { ...LEAN_PLUGIN_ALLOWLIST };
    fs.writeFileSync(p, `${JSON.stringify(settings, null, 2)}\n`);
  }
}

// Copy the harness `.claude` tree into <target>/.claude per scaffold Step 3.
function copyScaffoldTree(src, target, profileName) {
  const dotClaude = path.join(target, '.claude');
  copyTree(path.join(src, '.claude-plugin'), path.join(dotClaude, '.claude-plugin'));
  const selected = selectedCopySet(profileName);
  if (!selected) {
    for (const dir of ['agents', 'skills', 'hooks', 'scripts', 'templates', 'workflows']) {
      copyTree(path.join(src, dir), path.join(dotClaude, dir));
    }
  } else {
    copyNamedFiles(path.join(src, 'agents'), path.join(dotClaude, 'agents'), selected.agents);
    copyNamedFiles(path.join(src, 'skills'), path.join(dotClaude, 'skills'), selected.skills);
    copyNamedFiles(path.join(src, 'scripts'), path.join(dotClaude, 'scripts'), selected.scripts);
    copyTree(path.join(src, 'hooks'), path.join(dotClaude, 'hooks'));
    copyTree(path.join(src, 'templates'), path.join(dotClaude, 'templates'));
  }
  for (const file of ['architecture.md', 'program.md', 'settings.json', 'settings.auto.json']) {
    copyTree(path.join(src, file), path.join(dotClaude, file));
  }
  copyDirContents(path.join(src, 'templates', 'state-seeds'), path.join(dotClaude, 'state'));
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
  fs.writeFileSync(file, `${JSON.stringify(render.buildManifest(profile), null, 2)}\n`);
  return file;
}

function writeClaudeMd(target, src, profile) {
  const body = fs.readFileSync(requireTemplate(src, 'templates/claude-md.template.md'), 'utf8');
  const out = path.join(target, 'CLAUDE.md');
  fs.writeFileSync(out, render.renderClaudeMd(body, profile));
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
// tracker, or framework-pack files — those stay with the interactive command.
function copyStarterFiles(target, src) {
  const map = [
    ['templates/mcp-config.template.json', '.mcp.json'],
    ['templates/claude-security-guidance.template.md', '.claude/claude-security-guidance.md'],
    ['templates/security-patterns.template.yaml', '.claude/security-patterns.yaml'],
    ['templates/gitignore.template', '.gitignore'],
  ];
  for (const [from, to] of map) {
    const toPath = path.join(target, to);
    fs.mkdirSync(path.dirname(toPath), { recursive: true });
    fs.copyFileSync(requireTemplate(src, from), toPath);
  }
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
  pruneSettings(target, scaffoldProfile);
  if (telemetryEnabled(profile, rawOpts)) enableTelemetry(target);
  const written = [
    writeManifest(target, profile), writeClaudeMd(target, pluginSource, profile),
    ...writeProjectReadme(target, pluginSource, profile),
    writeDesignMd(target, pluginSource), writeInitSh(target, pluginSource, profile),
  ];
  copyStarterFiles(target, pluginSource);
  makeDirs(target);
  writeStateFiles(target, profile);
  const cal = writeCalibration(target, profile);
  if (cal) written.push(cal);
  return { target, written, profileName: profile.name || 'untitled-project', scaffoldProfile };
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
  process.stdout.write('  wrote .mcp.json, .gitignore, .claude/claude-security-guidance.md, .claude/security-patterns.yaml\n');
  process.stdout.write('  wrote features.json, claude-progress.txt\n');
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
