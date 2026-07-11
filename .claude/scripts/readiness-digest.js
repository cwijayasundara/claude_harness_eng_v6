#!/usr/bin/env node

'use strict';

// Weekly/ops digest over agent-readiness + quality-card freshness.
// Report-only; exit 0. Intended for /schedule or npm run readiness-digest.
//
//   node readiness-digest.js [--root <dir>]

const fs = require('fs');
const path = require('path');
const { buildPillars, summarize, renderMd } = require('./agent-readiness');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function ageHours(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.round((Date.now() - t) / 3600000);
}

function buildDigest(root = process.cwd()) {
  const generatedAt = new Date().toISOString();
  // agent-readiness exports buildPillars — re-run live
  let pillars;
  let summary;
  try {
    pillars = buildPillars(root);
    summary = summarize(pillars);
  } catch (_) {
    pillars = [];
    summary = { active: 0, partial: 0, planned: 8 };
  }

  const card = readJson(path.join(root, 'specs', 'reviews', 'quality-card.json'));
  const receipt = readJson(path.join(root, '.claude', 'state', 'gate-receipt.json'));
  const nav = readJson(path.join(root, '.claude', 'state', 'navigation-status.json'));
  const human = readJson(path.join(root, '.claude', 'state', 'human-codebase.json'));

  const digest = {
    generated_at: generatedAt,
    readiness: { summary, pillars },
    quality_card: card
      ? { pass: card.pass, generated_at: card.generated_at, age_hours: ageHours(card.generated_at) }
      : null,
    gate_receipt: receipt,
    navigation: nav,
    human_codebase: human,
    alerts: [],
  };

  if (summary.active < 5) {
    digest.alerts.push(`Only ${summary.active}/8 readiness pillars active — autonomy risk`);
  }
  for (const p of pillars) {
    if (p.status !== 'active' && p.remediation) {
      digest.alerts.push(`${p.label}: ${p.remediation}`);
    }
  }
  if (!card) digest.alerts.push('No quality-card yet — run /gate');
  else if (card.pass === false) digest.alerts.push('Latest quality-card is FAIL');
  else if (digest.quality_card.age_hours != null && digest.quality_card.age_hours > 168) {
    digest.alerts.push(`quality-card is ${digest.quality_card.age_hours}h old (>1 week)`);
  }
  if (!human) digest.alerts.push('docs/CODEBASE.md not generated — run npm run human-codebase');

  const md = [
    '# Agent readiness digest',
    '',
    `Generated: ${generatedAt}`,
    '',
    `## Readiness: ${summary.active} active · ${summary.partial} partial · ${summary.planned} planned`,
    '',
    renderMd(pillars, summary, generatedAt).split('\n').slice(4).join('\n'),
    '',
    '## Quality card',
    '',
    card
      ? `- pass: **${card.pass}** · age: ${digest.quality_card.age_hours ?? '?'}h · \`${card.generated_at}\``
      : '- _missing_',
    '',
    '## Navigation / human docs',
    '',
    `- navigation-status: ${nav ? nav.status || nav.mode || 'present' : '_missing_'}`,
    `- human-codebase: ${human ? `${human.out || 'docs/CODEBASE.md'} (${human.files || '?'} files)` : '_missing_'}`,
    '',
    '## Alerts',
    '',
    digest.alerts.length
      ? digest.alerts.map((a) => `- ⚠️ ${a}`).join('\n')
      : '- ✅ No alerts',
    '',
    '## Actions',
    '',
    '```bash',
    'npm run agent-readiness',
    'npm run human-codebase',
    'npm run quality-card',
    '/gate',
    '```',
    '',
  ].join('\n');

  return { digest, md };
}

function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--root');
  const root = i === -1 ? process.cwd() : argv[i + 1];
  const { digest, md } = buildDigest(root);
  const outDir = path.join(root, 'specs', 'reviews');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'readiness-digest.json'), `${JSON.stringify(digest, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'readiness-digest.md'), md);
  process.stdout.write(md);
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    process.stderr.write(`readiness-digest: ${e.message}\n`);
    process.exit(2);
  }
}

module.exports = { buildDigest, main };
