#!/usr/bin/env node

'use strict';

// scaffold-apply.js — deterministic file generation for /scaffold (Steps 2-9).
//
// The interactive /scaffold command (.claude/commands/scaffold.md) is a
// model-executed procedure. In headless `claude -p` mode the model can emit the
// Step 10 "scaffolded successfully" report without writing anything. This script
// is the part that MUST NOT be skipped or hallucinated: given a profile JSON, it
// copies the harness `.claude` tree and writes the manifest, CLAUDE.md, design.md,
// init.sh, security files, .mcp.json, .gitignore and the specs/ output dirs.
//
// Out of scope (still handled by the interactive command): telemetry/grafana
// copy, tracker-config files, git init + git-hooks, framework-pack installs,
// subdirectory CLAUDE.md files, and the official-plugins enabledPlugins rebuild.
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

// Copy the harness `.claude` tree into <target>/.claude per scaffold Step 3.
function copyScaffoldTree(src, target) {
  const dotClaude = path.join(target, '.claude');
  copyTree(path.join(src, '.claude-plugin'), path.join(dotClaude, '.claude-plugin'));
  for (const dir of ['agents', 'skills', 'hooks', 'scripts', 'templates', 'workflows']) {
    copyTree(path.join(src, dir), path.join(dotClaude, dir));
  }
  for (const file of ['architecture.md', 'program.md', 'settings.json', 'settings.auto.json']) {
    copyTree(path.join(src, file), path.join(dotClaude, file));
  }
  copyDirContents(path.join(src, 'templates', 'state-seeds'), path.join(dotClaude, 'state'));
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
  fs.mkdirSync(target, { recursive: true });
  copyScaffoldTree(pluginSource, target);
  const written = [
    writeManifest(target, profile), writeClaudeMd(target, pluginSource, profile),
    writeDesignMd(target, pluginSource), writeInitSh(target, pluginSource, profile),
  ];
  copyStarterFiles(target, pluginSource);
  makeDirs(target);
  writeStateFiles(target, profile);
  const cal = writeCalibration(target, profile);
  if (cal) written.push(cal);
  return { target, written, profileName: profile.name || 'untitled-project' };
}

function run() {
  const result = applyScaffold(parseArgs(process.argv.slice(2)));
  report(result);
}

function report(result) {
  process.stdout.write(`scaffold applied for "${result.profileName}" into ${result.target}\n`);
  process.stdout.write('  .claude/ tree copied (agents, skills, hooks, scripts, templates, workflows, state)\n');
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
