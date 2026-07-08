#!/usr/bin/env node

'use strict';

// Deterministic evidence extraction for the ubiquitous-language glossary
// (docs/superpowers/specs/2026-07-05-ubiquitous-language-design.md), generalized
// from the private-equity-only pe-glossary-pack.js (2026-07-06) into a
// registry-driven engine: any vertical plugin registered in
// .claude/config/scaffold-packs.json (verticalPacks) is a config entry, not a new
// script. No NLP, no invented terms — just what each plugin already says
// about itself in its skill descriptions, grouped under that entry's fixed
// bounded-context table.
//
// Plugins installed via `claude plugin install` live under the user's home
// directory, not this project's own .claude/ — hence the os.homedir() lookup
// rather than a project-relative path.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseSkillFrontmatter } = require('./telemetry-skill-helpers');

function loadRegistry(registryPath) {
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}

function isPluginEnabled(enabledPlugins, prefix) {
  return Object.keys(enabledPlugins || {}).some(
    (key) => key.startsWith(prefix) && enabledPlugins[key]
  );
}

function findSkillsDir(homeDir, entry) {
  const candidates = [entry.marketplace_skills_subpath, entry.cache_skills_subpath].map((p) => path.join(homeDir, p));
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function readSkillDescriptions(skillsDir) {
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((dirEntry) => dirEntry.isDirectory())
    .map((dirEntry) => {
      const skillPath = path.join(skillsDir, dirEntry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) return null;
      const fm = parseSkillFrontmatter(fs.readFileSync(skillPath, 'utf8'));
      return { skill: fm.name || dirEntry.name, description: fm.description || '' };
    })
    .filter(Boolean);
}

function buildPack(skillDescriptions, entry) {
  const bySkill = new Map(skillDescriptions.map((s) => [s.skill, s]));
  return {
    contexts: entry.bounded_contexts.map((ctx) => ({
      name: ctx.name,
      skills: ctx.skills.map((id) => bySkill.get(id)).filter(Boolean),
    })),
  };
}

// --- CLI ----------------------------------------------------------------------

function loadSettings(repoRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude', 'settings.json'), 'utf8'));
  } catch (err) {
    return { enabledPlugins: {} };
  }
}

function loadRepoRegistry(repoRoot) {
  const registryPath = path.join(repoRoot, '.claude', 'config', 'scaffold-packs.json');
  if (!fs.existsSync(registryPath)) return { packs: [] };
  return { packs: loadRegistry(registryPath).verticalPacks || [] };
}

function processEntry(entry, repoRoot) {
  const skillsDir = findSkillsDir(os.homedir(), entry);
  if (!skillsDir) {
    process.stderr.write(
      `vertical-glossary-pack: ${entry.plugin} is enabled but no skills directory was found ` +
      `under ${os.homedir()}/.claude/plugins — check the plugin install.\n`
    );
    return { ok: false };
  }
  const pack = buildPack(readSkillDescriptions(skillsDir), entry);
  const skillCount = pack.contexts.reduce((n, c) => n + c.skills.length, 0);
  if (skillCount === 0) {
    process.stderr.write(
      `vertical-glossary-pack: ${entry.plugin} is enabled and a skills directory exists, ` +
      'but no skill descriptions were found — check the plugin install.\n'
    );
    return { ok: false };
  }
  const outDir = path.join(repoRoot, 'specs', 'brd');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${entry.plugin}-glossary-pack.json`);
  fs.writeFileSync(outPath, JSON.stringify(pack, null, 2) + '\n');
  process.stdout.write(
    `vertical-glossary-pack: ${entry.plugin} OK: ${pack.contexts.length} context(s), ${skillCount} skill(s) -> ${outPath}\n`
  );
  return { ok: true };
}

function main() {
  const repoRoot = process.cwd();
  const settings = loadSettings(repoRoot);
  const registry = loadRepoRegistry(repoRoot);
  const matched = registry.packs.filter((entry) => isPluginEnabled(settings.enabledPlugins, entry.enabled_plugin_prefix));
  if (matched.length === 0) {
    process.stdout.write('vertical-glossary-pack: no vertical glossary packs enabled — nothing to do.\n');
    process.exit(0);
  }
  const results = matched.map((entry) => processEntry(entry, repoRoot));
  process.exit(results.every((r) => r.ok) ? 0 : 2);
}

module.exports = { loadRegistry, isPluginEnabled, findSkillsDir, readSkillDescriptions, buildPack };

if (require.main === module) main();
