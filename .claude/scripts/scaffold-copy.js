'use strict';

// scaffold-copy.js — the `.claude` tree copy + scaffold-profile selection.
//
// Split out of scaffold-apply.js so each file stays within the harness length
// gate and so "which files get copied" (here) is separate from "what content
// gets generated" (scaffold-apply.js). copyScaffoldTree, pruneSettings, and
// resolveScaffoldProfile moved here verbatim; copyScaffoldTree additionally:
//   - copies a {"type":"commonjs"} `.claude/package.json` marker so an app whose
//     root package.json declares "type":"module" cannot reparse the harness's
//     require()-based hooks/scripts as ESM (which crashes every hook with
//     "require is not defined");
//   - copies the `git-hooks/` tree so Step 8's `git config core.hooksPath
//     .claude/git-hooks` resolves the hooks' __dirname-relative require()s.

const fs = require('fs');
const path = require('path');

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
  'canvas-sync-check.js',
  'build-lane.js',
  'ci-ingest.js',
  'constraints-extract.js',
  'coverage-diff.js',
  'cr-index.js',
  'deep-mutation.js',
  'flag-scan.js',
  'flake-history.js',
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
  'validate-sensor-waivers.js',
  'validate-contract.js',
];
const BROWNFIELD_SCRIPTS = [
  ...CORE_SCRIPTS,
];

const LEAN_PLUGIN_ALLOWLIST = {
  'playwright@claude-plugins-official': true,
  'superpowers@claude-plugins-official': true,
};

function fail(msg) {
  throw new Error(msg);
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
// git-hooks/ is copied in every profile (Step 8 wires it via core.hooksPath);
// package.json pins .claude/** to CommonJS for "type":"module" apps.
function copyScaffoldTree(src, target, profileName) {
  const dotClaude = path.join(target, '.claude');
  copyTree(path.join(src, '.claude-plugin'), path.join(dotClaude, '.claude-plugin'));
  const selected = selectedCopySet(profileName);
  if (!selected) {
    for (const dir of ['agents', 'skills', 'hooks', 'scripts', 'templates', 'workflows', 'git-hooks']) {
      copyTree(path.join(src, dir), path.join(dotClaude, dir));
    }
  } else {
    copyNamedFiles(path.join(src, 'agents'), path.join(dotClaude, 'agents'), selected.agents);
    copyNamedFiles(path.join(src, 'skills'), path.join(dotClaude, 'skills'), selected.skills);
    copyNamedFiles(path.join(src, 'scripts'), path.join(dotClaude, 'scripts'), selected.scripts);
    copyTree(path.join(src, 'hooks'), path.join(dotClaude, 'hooks'));
    copyTree(path.join(src, 'templates'), path.join(dotClaude, 'templates'));
    copyTree(path.join(src, 'git-hooks'), path.join(dotClaude, 'git-hooks'));
  }
  for (const file of ['architecture.md', 'program.md', 'settings.json', 'settings.auto.json', 'package.json']) {
    copyTree(path.join(src, file), path.join(dotClaude, file));
  }
  copyDirContents(path.join(src, 'templates', 'state-seeds'), path.join(dotClaude, 'state'));
}

module.exports = { copyScaffoldTree, pruneSettings, resolveScaffoldProfile };
