#!/usr/bin/env node

'use strict';

// Assemble a human-facing quality receipt from specs/reviews/* artifacts.
// Written at the end of /gate so PRs and humans share one trust surface.
//
//   node quality-card.js [--root <dir>] [--range <base..head>]
//
// Writes:
//   specs/reviews/quality-card.md
//   specs/reviews/quality-card.json
// Exit 0 always (report); pass=false when any BLOCK-class input is red.

const fs = require('fs');
const path = require('path');
const { normalize } = require('../hooks/lib/sensor-schema');

const REVIEWS = path.join('specs', 'reviews');

const SOURCES = [
  { key: 'evaluator', file: 'evaluator-report.md', kind: 'md_verdict' },
  { key: 'code_review', file: 'code-review-verdict.json', kind: 'json_pass' },
  { key: 'security', file: 'security-verdict.json', kind: 'json_pass', optional: true },
  { key: 'security_scan', file: 'security-scan.json', kind: 'json_pass', optional: true },
  { key: 'ownership', file: 'ownership-check.json', kind: 'json_pass', optional: true },
  { key: 'regression', file: 'regression-gate-verdict.json', kind: 'json_verdict', optional: true },
  { key: 'contract_drift', file: 'contract-drift-verdict.json', kind: 'json_verdict', optional: true },
  { key: 'approved_fixtures', file: 'approved-fixtures-verdict.json', kind: 'json_verdict', optional: true },
  { key: 'verification_matrix', file: 'verification-matrix-verdict.json', kind: 'json_pass', optional: true },
  { key: 'observability', file: 'observability-verdict.json', kind: 'json_pass', optional: true },
  { key: 'perf_smell', file: 'perf-smell-verdict.json', kind: 'json_pass', optional: true },
  { key: 'slo', file: 'slo-verdict.json', kind: 'json_pass', optional: true },
  { key: 'mutation', file: 'mutation-gate-verdict.json', kind: 'json_pass', optional: true },
  { key: 'deep_mutation', file: 'deep-mutation-verdict.json', kind: 'json_pass', optional: true },
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return null;
  }
}

function statusFromPass(pass, present) {
  if (!present) return 'missing';
  if (pass === true) return 'pass';
  if (pass === false) return 'fail';
  return 'unknown';
}

function interpretMdVerdict(text) {
  const r = normalize(text == null ? null : text, 'md_verdict');
  return { present: r.extra.present, pass: r.extra.pass };
}

function interpretJson(obj, kind) {
  const r = normalize(obj, kind);
  return { present: r.extra.present, pass: r.extra.pass, detail: r.extra.detail };
}

function interpretSource(abs, src) {
  return src.kind === 'md_verdict'
    ? interpretMdVerdict(readText(abs))
    : interpretJson(readJson(abs), src.kind);
}

function buildCheckEntry(root, src, interp) {
  const status = statusFromPass(interp.pass, interp.present);
  if (!interp.present && src.optional) {
    return {
      key: src.key,
      file: src.file,
      status: 'skipped',
      pass: true,
      optional: true,
      detail: 'not present',
    };
  }
  return {
    key: src.key,
    file: src.file,
    status,
    pass: status === 'pass' || status === 'skipped',
    optional: Boolean(src.optional),
    detail: interp.detail || null,
    summary: loadFindingSummary(root, src),
  };
}

function loadChecks(root) {
  const checks = [];
  for (const src of SOURCES) {
    const abs = path.join(root, REVIEWS, src.file);
    const interp = interpretSource(abs, src);
    checks.push(buildCheckEntry(root, src, interp));
  }
  return checks;
}

function loadFindingSummary(root, src) {
  if (src.key !== 'code_review') return null;
  const v = readJson(path.join(root, REVIEWS, 'code-review-verdict.json'));
  if (!v || !v.summary) return null;
  return v.summary;
}

function collectWikiLinks(root) {
  const links = [];
  const candidates = [
    'docs/CODEBASE.md',
    'specs/brownfield/wiki/WIKI.md',
    'specs/brownfield/symbol-map.md',
    'specs/brownfield/wiki/concepts/INDEX.md',
    'specs/reviews/walkthrough.md',
  ];
  for (const rel of candidates) {
    if (fs.existsSync(path.join(root, rel))) links.push(rel);
  }
  return links;
}

function buildCard({ root = process.cwd(), range = null } = {}) {
  const generatedAt = new Date().toISOString();
  const checks = loadChecks(root);
  // "optional" means OK if missing; if present and fail, it still fails the card.
  const anyFailed = checks.filter((c) => c.status === 'fail');
  // Evaluator + code review are required for a full gate receipt; others optional until present.
  const coreKeys = new Set(['evaluator', 'code_review']);
  const coreMissing = checks.filter((c) => coreKeys.has(c.key) && c.status === 'missing');
  const coreFailed = checks.filter((c) => coreKeys.has(c.key) && c.status === 'fail');
  const pass = coreMissing.length === 0 && coreFailed.length === 0 && anyFailed.length === 0;

  const card = {
    gate: 'quality-card',
    pass,
    generated_at: generatedAt,
    range: range || null,
    checks,
    wiki: collectWikiLinks(root),
    summary: {
      pass: checks.filter((c) => c.status === 'pass').length,
      fail: checks.filter((c) => c.status === 'fail').length,
      missing: checks.filter((c) => c.status === 'missing').length,
      skipped: checks.filter((c) => c.status === 'skipped').length,
    },
  };

  const md = renderMd(card);
  return { card, md };
}

function icon(status) {
  if (status === 'pass') return '✅';
  if (status === 'fail') return '❌';
  if (status === 'skipped') return '⏭️';
  if (status === 'missing') return '⬜';
  return '❓';
}

function renderHeader(card) {
  return [
    '# Quality card',
    '',
    `Generated: ${card.generated_at}`,
    card.range ? `Range: \`${card.range}\`` : null,
    '',
    `**Overall: ${card.pass ? 'PASS' : 'FAIL'}** — ${card.summary.pass} pass · ${card.summary.fail} fail · ${card.summary.missing} missing · ${card.summary.skipped} skipped`,
    '',
    '| Check | Status | Detail |',
    '|---|---|---|',
  ].filter((x) => x !== null);
}

function renderCheckRows(checks) {
  const rows = [];
  for (const c of checks) {
    if (c.status === 'skipped') continue;
    const detail = c.detail
      || (c.summary ? `block=${c.summary.block || 0} warn=${c.summary.warn || 0}` : '—');
    rows.push(`| ${c.key} | ${icon(c.status)} ${c.status} | ${String(detail).replace(/\|/g, '\\|')} |`);
  }
  return rows;
}

function renderWikiSection(wiki) {
  const lines = ['', '## Human navigation', ''];
  if (wiki.length) {
    for (const w of wiki) lines.push(`- [\`${w}\`](../../${w})`);
  } else {
    lines.push('_No wiki/homepage artifacts yet. Run `npm run human-codebase` and `/code-map`._');
  }
  return lines;
}

function renderMd(card) {
  const lines = renderHeader(card)
    .concat(renderCheckRows(card.checks))
    .concat(renderWikiSection(card.wiki));

  lines.push(
    '',
    '## How to use this card',
    '',
    '1. Confirm **Overall PASS** before opening or merging a PR.',
    '2. Read `specs/reviews/walkthrough.md` for a logical (non-alphabetical) change tour.',
    '3. Read `docs/CODEBASE.md` for system orientation without opening every source file.',
    '4. Drill into failing rows via the matching file under `specs/reviews/`.',
    '',
  );
  return lines.join('\n');
}

function writeCard(root, { card, md }) {
  const dir = path.join(root, REVIEWS);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'quality-card.json'), `${JSON.stringify(card, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'quality-card.md'), md);
  // Gate receipt stamp for PR/CI consumers
  fs.writeFileSync(
    path.join(root, '.claude', 'state', 'gate-receipt.json'),
    `${JSON.stringify({
      generated_at: card.generated_at,
      pass: card.pass,
      quality_card: 'specs/reviews/quality-card.json',
      walkthrough: fs.existsSync(path.join(root, REVIEWS, 'walkthrough.md'))
        ? 'specs/reviews/walkthrough.md'
        : null,
    }, null, 2)}\n`,
  );
}

function arg(argv, name, fb) {
  const i = argv.indexOf(name);
  return i === -1 ? fb : argv[i + 1];
}

function main(argv = process.argv.slice(2)) {
  const root = arg(argv, '--root', process.cwd());
  const range = arg(argv, '--range', null);
  fs.mkdirSync(path.join(root, '.claude', 'state'), { recursive: true });
  const built = buildCard({ root, range });
  writeCard(root, built);
  process.stdout.write(
    `quality-card: ${built.card.pass ? 'PASS' : 'FAIL'} → specs/reviews/quality-card.md\n`,
  );
  return built.card.pass ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    process.stderr.write(`quality-card: ${e.message}\n`);
    process.exit(2);
  }
}

module.exports = {
  buildCard,
  writeCard,
  renderMd,
  loadChecks,
  interpretMdVerdict,
  interpretJson,
  main,
  SOURCES,
};
