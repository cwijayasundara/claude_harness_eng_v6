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

// Install contents come from .claude/config/packs.json — the same partition that
// tools/check-partition.js enforces and tools/pack-install.js composes from. They used
// to be 158 hand-maintained names here, which drifted: run-gate-checks.js had to be
// added by hand, and .claude/config/ was missed entirely (a core scaffold shipped a
// runner with no registry). Deriving them means the lists cannot disagree with reality.
//
// A profile is a union of packs, each a strict superset of the previous one. The
// exported CORE_* names are kept so package-sku.js and the scaffold tests keep working.
const PACKS_CONFIG = path.join(__dirname, '..', 'config', 'packs.json');

function loadPacks() {
  return JSON.parse(fs.readFileSync(PACKS_CONFIG, 'utf8'));
}

// Unit names of one kind for a profile: the kernel plus every pack the profile names.
function profileUnits(profileName, kind) {
  const cfg = loadPacks();
  const profile = cfg.profiles[profileName];
  if (!profile) fail(`unknown scaffold profile: ${profileName}`);
  const names = new Set(cfg.kernel[kind] || []);
  for (const pack of profile.packs) {
    for (const n of (cfg.packs[pack] || {})[kind] || []) names.add(n);
  }
  return [...names].sort();
}

const withExt = (names, ext) => names.map((n) => n + ext);

const CORE_AGENTS = withExt(profileUnits('core', 'agent'), '.md');
const CORE_SKILLS = profileUnits('core', 'skill');
const CORE_SCRIPTS = withExt(profileUnits('core', 'script'), '.js');
const BROWNFIELD_AGENTS = withExt(profileUnits('brownfield', 'agent'), '.md');
const BROWNFIELD_SKILLS = profileUnits('brownfield', 'skill');
const BROWNFIELD_SCRIPTS = withExt(profileUnits('brownfield', 'script'), '.js');
// Skills no profile below `full` installs — the vertical/framework packs.
const OPTIONAL_SKILLS = profileUnits('full', 'skill').filter((s) => !BROWNFIELD_SKILLS.includes(s));

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
    for (const dir of ['agents', 'skills', 'hooks', 'scripts', 'templates', 'workflows', 'git-hooks', 'config']) {
      copyTree(path.join(src, dir), path.join(dotClaude, dir));
    }
  } else {
    copyNamedFiles(path.join(src, 'agents'), path.join(dotClaude, 'agents'), selected.agents);
    copyNamedFiles(path.join(src, 'skills'), path.join(dotClaude, 'skills'), selected.skills);
    copyNamedFiles(path.join(src, 'scripts'), path.join(dotClaude, 'scripts'), selected.scripts);
    // These ship whole even under a profile: machinery, plus the DATA the selected
    // scripts read (run-gate-checks.js cannot run without config/gate-checks.json).
    // workflows/ carries the fix-diagnostics exemplar (Bun Phase C).
    for (const dir of ['hooks', 'templates', 'git-hooks', 'workflows', 'config']) {
      copyTree(path.join(src, dir), path.join(dotClaude, dir));
    }
  }
  for (const file of ['architecture.md', 'program.md', 'settings.json', 'settings.auto.json', 'package.json']) {
    copyTree(path.join(src, file), path.join(dotClaude, file));
  }
  copyDirContents(path.join(src, 'templates', 'state-seeds'), path.join(dotClaude, 'state'));
}

// Copy a locally-bundled framework-skill-pack's skills into <target>/.claude/skills,
// per project-manifest.json#framework_skill_packs (Expert-Generalist scaffold
// composition, docs/superpowers/specs/2026-07-06-expert-generalist-scaffold-composition-design.md).
// "source":"github" packs (langchain, google-adk) are untouched here — those stay
// manual-install-only via install-framework-packs, as today.
function copyFrameworkPackSkills(pluginSource, target, frameworkSkillPacks) {
  // pluginSource is already the harness `.claude` root (see scaffold-apply.js's
  // resolveOpts, which verifies pluginSource/.claude-plugin/plugin.json directly) —
  // do not join another '.claude' segment onto it here.
  const registryPath = path.join(pluginSource, 'config', 'scaffold-packs.json');
  if (!fs.existsSync(registryPath) || !Array.isArray(frameworkSkillPacks) || frameworkSkillPacks.length === 0) return;
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  for (const key of frameworkSkillPacks) {
    const entry = registry.frameworkPacks.find((p) => p.key === key);
    if (!entry || entry.source !== 'local') continue;
    copyNamedFiles(path.join(pluginSource, 'skills'), path.join(target, '.claude', 'skills'), entry.skills);
  }
}

module.exports = {
  copyScaffoldTree,
  pruneSettings,
  resolveScaffoldProfile,
  copyFrameworkPackSkills,
  selectedCopySet,
  CORE_SKILLS,
  OPTIONAL_SKILLS,
  CORE_SCRIPTS,
  CORE_AGENTS,
};
