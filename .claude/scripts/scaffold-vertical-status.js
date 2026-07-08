#!/usr/bin/env node

'use strict';

// Deterministic install-status report for domain-vertical plugins, read by
// /scaffold's own Step 10 reporting (docs/superpowers/specs/2026-07-06-
// expert-generalist-scaffold-composition-design.md, Part 3). Deliberately
// separate from install-framework-packs — that skill's identity is scoped to
// npx-skills-add-installed tech packs; verticals are Claude Code marketplace
// plugins, installed via a different command family (claude plugin install).

const fs = require('fs');
const path = require('path');
const { loadRegistry, isPluginEnabled } = require('./vertical-glossary-pack');

function checkVerticalStatus(enabledPlugins, entries) {
  return entries.map((entry) => ({
    plugin: entry.plugin,
    installed: isPluginEnabled(enabledPlugins, entry.enabled_plugin_prefix),
    marketplace: entry.marketplace,
    install_id: entry.install_id,
  }));
}

function printReport(statuses) {
  for (const s of statuses) {
    if (s.installed) {
      process.stdout.write(`${s.plugin}: INSTALLED\n`);
      continue;
    }
    process.stdout.write(
      `${s.plugin}: PENDING MANUAL INSTALL\n` +
      `  claude plugin marketplace add ${s.marketplace}\n` +
      `  claude plugin install ${s.install_id}\n`
    );
  }
}

function main() {
  const repoRoot = process.cwd();
  const registryPath = path.join(repoRoot, '.claude', 'config', 'scaffold-packs.json');
  if (!fs.existsSync(registryPath)) {
    process.stdout.write('scaffold-vertical-status: no scaffold-packs.json registry found — nothing to report.\n');
    process.exit(0);
  }
  let settings = { enabledPlugins: {} };
  try {
    settings = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude', 'settings.json'), 'utf8'));
  } catch (err) {
    // no settings.json yet — every entry reports as not-installed, which is correct.
  }
  const registry = loadRegistry(registryPath);
  printReport(checkVerticalStatus(settings.enabledPlugins, registry.verticalPacks || []));
  process.exit(0);
}

module.exports = { checkVerticalStatus };

if (require.main === module) main();
