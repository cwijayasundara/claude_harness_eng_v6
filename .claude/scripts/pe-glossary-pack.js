#!/usr/bin/env node

'use strict';

// Deterministic evidence extraction for the ubiquitous-language glossary
// (docs/superpowers/specs/2026-07-05-ubiquitous-language-design.md), seeding
// CONTEXT.md with the vocabulary already encoded in the installed
// private-equity vertical plugin's skill descriptions. No NLP, no invented
// terms — just what the plugin already says about itself, grouped under a
// fixed bounded-context table (Fowler's BoundedContext: vocabulary is grouped
// where it actually shifts, not flattened into one enterprise glossary).
//
// Plugins installed via `claude plugin install` live under the user's home
// directory, not this project's own .claude/ — hence the os.homedir() lookup
// rather than a project-relative path.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseSkillFrontmatter } = require('./telemetry-skill-helpers');

const ENABLED_PLUGIN_RE = /^private-equity@/;

const MARKETPLACE_SKILLS_SUBPATH = path.join(
  '.claude', 'plugins', 'marketplaces', 'claude-for-financial-services',
  'plugins', 'vertical-plugins', 'private-equity', 'skills'
);
const CACHE_SKILLS_SUBPATH = path.join(
  '.claude', 'plugins', 'cache', 'claude-for-financial-services', 'private-equity', 'skills'
);

const BOUNDED_CONTEXTS = [
  {
    name: 'Deal Lifecycle (Sourcing, Screening & Diligence)',
    skills: ['deal-sourcing', 'deal-screening', 'dd-checklist', 'dd-meeting-prep'],
  },
  {
    name: 'Investment Decision & Returns',
    skills: ['ic-memo', 'returns-analysis'],
  },
  {
    name: 'Portfolio Operations & Value Creation',
    skills: ['portfolio-monitoring', 'value-creation-plan', 'unit-economics', 'ai-readiness'],
  },
];

function isPrivateEquityEnabled(enabledPlugins) {
  return Object.keys(enabledPlugins || {}).some(
    (key) => ENABLED_PLUGIN_RE.test(key) && enabledPlugins[key]
  );
}

function findSkillsDir(homeDir) {
  const candidates = [MARKETPLACE_SKILLS_SUBPATH, CACHE_SKILLS_SUBPATH].map((p) => path.join(homeDir, p));
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function readSkillDescriptions(skillsDir) {
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) return null;
      const fm = parseSkillFrontmatter(fs.readFileSync(skillPath, 'utf8'));
      return { skill: fm.name || entry.name, description: fm.description || '' };
    })
    .filter(Boolean);
}

function buildPack(skillDescriptions) {
  const bySkill = new Map(skillDescriptions.map((s) => [s.skill, s]));
  return {
    contexts: BOUNDED_CONTEXTS.map((ctx) => ({
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
    process.stdout.write('pe-glossary-pack: no .claude/settings.json found — nothing to do.\n');
    process.exit(0);
  }
}

function checkPrivateEquityEnabled(settings) {
  if (!isPrivateEquityEnabled(settings.enabledPlugins)) {
    process.stdout.write('pe-glossary-pack: private-equity plugin not enabled — nothing to do.\n');
    process.exit(0);
  }
}

function ensureSkillsDir() {
  const skillsDir = findSkillsDir(os.homedir());
  if (!skillsDir) {
    process.stderr.write(
      'pe-glossary-pack: private-equity plugin is enabled but no skills directory was found ' +
      `under ${os.homedir()}/.claude/plugins — check the plugin install.\n`
    );
    process.exit(2);
  }
  return skillsDir;
}

function writePack(pack, repoRoot) {
  const outDir = path.join(repoRoot, 'specs', 'brd');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'pe-glossary-pack.json');
  fs.writeFileSync(outPath, JSON.stringify(pack, null, 2) + '\n');
  return outPath;
}

function main() {
  const repoRoot = process.cwd();
  const settings = loadSettings(repoRoot);
  checkPrivateEquityEnabled(settings);
  const skillsDir = ensureSkillsDir();
  const pack = buildPack(readSkillDescriptions(skillsDir));
  const skillCount = pack.contexts.reduce((n, c) => n + c.skills.length, 0);
  if (skillCount === 0) {
    process.stderr.write(
      'pe-glossary-pack: private-equity plugin is enabled and a skills directory exists, ' +
      'but no skill descriptions were found — check the plugin install.\n'
    );
    process.exit(2);
  }
  const outPath = writePack(pack, repoRoot);
  process.stdout.write(
    `pe-glossary-pack OK: ${pack.contexts.length} context(s), ${skillCount} skill(s) -> ${outPath}\n`
  );
  process.exit(0);
}

module.exports = {
  isPrivateEquityEnabled, findSkillsDir, readSkillDescriptions, buildPack,
  BOUNDED_CONTEXTS, MARKETPLACE_SKILLS_SUBPATH, CACHE_SKILLS_SUBPATH,
};

if (require.main === module) main();
