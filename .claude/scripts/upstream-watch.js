'use strict';

// Watches anthropics/claude-code for changes that can break this harness:
// the CHANGELOG (hooks/plugin/settings/frontmatter churn) and the plugins
// directory (per-model-generation migration plugins). Snapshots live in
// .github/upstream/ so CI diffs against the last reviewed state.
// Exit codes: 0 = no change, 10 = changes found (report on stdout), 1 = error.

const fs = require('fs');
const path = require('path');

const CHANGELOG_URL =
  'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md';
const PLUGINS_URL =
  'https://api.github.com/repos/anthropics/claude-code/contents/plugins';
const SNAPSHOT_DIR = path.join(__dirname, '..', '..', '.github', 'upstream');

// Lines worth a human look: platform surfaces this harness builds on.
const RELEVANT = /hook|plugin|settings|frontmatter|skill|agent|model|deprecat|marketplace|mcp|slash command|subagent/i;

function addedLines(oldText, newText) {
  const oldSet = new Set(oldText.split('\n'));
  return newText.split('\n').filter((line) => line.trim() !== '' && !oldSet.has(line));
}

function diffPlugins(oldPlugins, newPlugins) {
  const oldSet = new Set(oldPlugins);
  const newSet = new Set(newPlugins);
  return {
    added: newPlugins.filter((p) => !oldSet.has(p)),
    removed: oldPlugins.filter((p) => !newSet.has(p)),
  };
}

function changelogSection(added) {
  const relevant = added.filter((l) => RELEVANT.test(l));
  const lines = ['## Changelog additions', '', '```', ...added, '```'];
  if (relevant.length > 0) {
    lines.push('', '### Harness-relevant lines (hooks/plugins/settings/agents/models)', '');
    for (const l of relevant) lines.push(`- ${l.trim()}`);
  }
  return { text: lines.join('\n'), relevant: relevant.length > 0 };
}

function pluginsSection({ added, removed }) {
  const migrations = added.filter((p) => /migration/i.test(p));
  const lines = ['## Plugins directory changes', ''];
  for (const p of added) lines.push(`- added: \`${p}\``);
  for (const p of removed) lines.push(`- removed: \`${p}\``);
  if (migrations.length > 0) {
    lines.push(
      '',
      `**New migration plugin(s): ${migrations.join(', ')}** — a model generation has shipped.`,
      'Run the model-generation migration ritual (docs/adaptive-ceremony.md).'
    );
  }
  return { text: lines.join('\n'), relevant: added.length > 0 || removed.length > 0 };
}

function buildReport({ oldChangelog, newChangelog, oldPlugins, newPlugins }) {
  const added = addedLines(oldChangelog, newChangelog);
  const plugins = diffPlugins(oldPlugins, newPlugins);
  const sections = [];
  let relevant = false;
  if (added.length > 0) {
    const s = changelogSection(added);
    sections.push(s.text);
    relevant = relevant || s.relevant;
  }
  if (plugins.added.length > 0 || plugins.removed.length > 0) {
    const s = pluginsSection(plugins);
    sections.push(s.text);
    relevant = relevant || s.relevant;
  }
  if (sections.length === 0) return null;
  return { relevant, body: sections.join('\n\n') };
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'claude-harness-upstream-watch' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

async function fetchPluginNames() {
  const body = await fetchText(PLUGINS_URL);
  return JSON.parse(body)
    .filter((entry) => entry.type === 'dir')
    .map((entry) => entry.name)
    .sort();
}

function readSnapshot(file, fallback) {
  const p = path.join(SNAPSHOT_DIR, file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : fallback;
}

function writeSnapshots(changelog, plugins) {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(path.join(SNAPSHOT_DIR, 'changelog.md'), changelog);
  fs.writeFileSync(path.join(SNAPSHOT_DIR, 'plugins.json'), JSON.stringify(plugins, null, 2) + '\n');
}

async function main() {
  const [newChangelog, newPlugins] = await Promise.all([
    fetchText(CHANGELOG_URL),
    fetchPluginNames(),
  ]);
  const oldChangelog = readSnapshot('changelog.md', '');
  const oldPlugins = JSON.parse(readSnapshot('plugins.json', '[]'));
  const firstRun = oldChangelog === '';
  writeSnapshots(newChangelog, newPlugins);
  if (firstRun) {
    console.log('Snapshots seeded — no report on first run.');
    return 0;
  }
  const report = buildReport({ oldChangelog, newChangelog, oldPlugins, newPlugins });
  if (report === null) return 0;
  const header = report.relevant
    ? '# Upstream changes — harness-relevant, review required'
    : '# Upstream changes — looks cosmetic, skim and close';
  console.log(`${header}\n\n${report.body}`);
  return 10;
}

module.exports = { addedLines, buildReport };

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`upstream-watch failed: ${err.message}`);
      process.exit(1);
    });
}
