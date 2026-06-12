#!/usr/bin/env node

'use strict';

// Feature-flag inventory — flags are the primary safe-change mechanism in
// production brownfield systems; unmapped flags are unmapped risk (which code
// paths are dark? which flags are retired-but-present debt?). Heuristic scan:
// SDK calls (LaunchDarkly, Unleash, Flipper, waffle, GrowthBook, PostHog),
// env-var gates (FEATURE_*/FF_*), and config-dict flags, into
// specs/brownfield/flag-inventory.md grouped by flag name.
// CLI: node .claude/scripts/flag-scan.js [--root DIR] [--out FILE]

const fs = require('fs');
const path = require('path');

const SOURCE_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.java', '.cs']);
const EXCLUDES = new Set(['node_modules', '.git', '.venv', 'venv', 'dist', 'build', 'target', 'vendor', '__pycache__', 'coverage']);

// [mechanism, regex with the flag name in group 1 (optional)]
const PATTERNS = [
  ['launchdarkly', /(?:ldclient|ldClient|LDClient|launchdarkly)\S*\.(?:variation|boolVariation|stringVariation|jsonVariation)\(\s*['"]([^'"]+)['"]/],
  ['unleash', /\bisEnabled\(\s*['"]([^'"]+)['"]/],
  ['flipper', /Flipper\.enabled\?\(\s*[:'"]([\w-]+)/],
  ['waffle', /waffle\.(?:flag_is_active|switch_is_active|sample_is_active)\([^,)]*,\s*['"]([^'"]+)['"]/],
  ['growthbook', /(?:growthbook|gb)\.(?:isOn|getFeatureValue)\(\s*['"]([^'"]+)['"]/],
  ['posthog', /posthog\.(?:isFeatureEnabled|getFeatureFlag)\(\s*['"]([^'"]+)['"]/],
  ['env', /process\.env\.((?:FEATURE|FF)_[A-Z0-9_]+)/],
  ['env', /os\.environ(?:\.get)?\(?\s*['"]((?:FEATURE|FF)_[A-Z0-9_]+)['"]/],
  ['config', /(?:FEATURE_FLAGS|feature_flags|featureFlags)\[\s*['"]([^'"]+)['"]\s*\]/],
];

function scanContent(content, rel) {
  const hits = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const [mechanism, re] of PATTERNS) {
      const m = lines[i].match(re);
      if (m) {
        hits.push({ flag: m[1] || '(dynamic)', mechanism, file: rel, line: i + 1 });
        break; // one mechanism per line is enough
      }
    }
  }
  return hits;
}

function walk(root, dir = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDES.has(entry.name) && !entry.name.startsWith('.')) {
        walk(root, path.join(dir, entry.name), out);
      }
    } else if (SOURCE_EXTS.has(path.extname(entry.name).toLowerCase())) {
      out.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/'));
    }
  }
  return out;
}

function render(byFlag) {
  const lines = ['# Feature-Flag Inventory', '',
    `Heuristic scan at ${new Date().toISOString()} — SDK calls, FEATURE_*/FF_* env gates, config-dict flags. A flag listed here gates a dark code path; a flag NOT listed may still exist (dynamic keys show as "(dynamic)").`, '',
    '| flag | mechanism | references |', '|---|---|---|'];
  for (const [flag, hits] of [...byFlag.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const refs = hits.map((h) => `${h.file}:${h.line}`).join(', ');
    lines.push(`| \`${flag}\` | ${hits[0].mechanism} | ${refs} |`);
  }
  lines.push('', '## Change-safety notes', '',
    '- Before touching a flagged code path, learn the flag\'s production state — the "off" branch may be the live one.',
    '- Flags referenced from exactly one site are removal-debt candidates; flags with many sites are de facto architecture.',
    '');
  return lines.join('\n');
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = path.resolve(rootIdx === -1 ? '.' : argv[rootIdx + 1]);
  const outIdx = argv.indexOf('--out');
  const out = outIdx === -1 ? path.join(root, 'specs', 'brownfield', 'flag-inventory.md') : argv[outIdx + 1];

  const byFlag = new Map();
  for (const rel of walk(root)) {
    let content;
    try {
      content = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch (_) {
      continue;
    }
    for (const hit of scanContent(content, rel)) {
      if (!byFlag.has(hit.flag)) byFlag.set(hit.flag, []);
      byFlag.get(hit.flag).push(hit);
    }
  }
  if (byFlag.size === 0) {
    process.stdout.write('No feature flags detected.\n');
    return 0;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, render(byFlag));
  process.stdout.write(`Wrote ${out} (${byFlag.size} flag(s))\n`);
  return 0;
}

module.exports = { scanContent };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
