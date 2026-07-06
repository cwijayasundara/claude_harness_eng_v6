#!/usr/bin/env node

'use strict';

// Deterministic evidence extraction for the ubiquitous-language glossary
// (docs/superpowers/specs/2026-07-05-ubiquitous-language-design.md), generalized
// from the private-equity-only pe-glossary-pack.js (2026-07-06) into a
// registry-driven engine: any vertical plugin registered in
// .claude/config/vertical-glossary-packs.json is a config entry, not a new
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

module.exports = { loadRegistry, isPluginEnabled, findSkillsDir, readSkillDescriptions, buildPack };
