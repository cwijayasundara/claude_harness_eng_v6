#!/usr/bin/env node

'use strict';

// Short pointer BRD for lean /brd --prd. Does not restate the spine.

const fs = require('fs');
const path = require('path');
const { risksFromClarifications } = require('../hooks/lib/analysis-seed');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function titleFrom(sourceMd) {
  const line = String(sourceMd || '').split('\n').find((l) => /^#\s+/.test(l));
  return line ? line.replace(/^#\s+/, '').replace(/^PRD:\s*/i, '').trim() : 'Project';
}

function render({ title, sourceRel, reqs, safeguards, questions, clarifications, risks }) {
  const outScope = (safeguards || []).map((s) => `- ${s.text}`).join('\n') || '- (none recorded)';
  const oq = (questions || []).map((q) => `- ${q.text}`).join('\n') || '- none';
  const cs = (clarifications || []).map((c) => `- **${c.id}** ${c.question} → ${c.answer}`).join('\n')
    || '- none — lean adopt does not invent decisions the PRD did not ask';
  const fromPrd = (risks || []).map((r) => `- ${r.text}`);
  const fromClar = risksFromClarifications(clarifications)
    .map((r) => `- **${r.id}** (clarification) ${r.text}`);
  const rs = [...fromPrd, ...fromClar].join('\n') || '- none listed in the PRD';
  return [
    `# BRD: ${title}`,
    '',
    `Mode: \`--prd\` adopt-only. Source: \`${sourceRel}\` (copied to \`specs/brd/source-frd.md\`).`,
    `Spine: \`specs/brd/brd-requirements.json\` — **${(reqs || []).length} requirements**, adopted verbatim. Do not restate them here.`,
    '',
    '## In scope',
    '',
    `${(reqs || []).length} adopted requirements. Machine spine + acceptance: \`brd-requirements.json\`, \`brd-acceptance.json\`.`,
    '',
    '## Out of scope',
    '',
    outScope,
    '',
    '## Open questions',
    '',
    oq,
    '',
    '## Clarifications',
    '',
    cs,
    '',
    '## Risks',
    '',
    rs,
    '',
    '## Gates',
    '',
    '- Grounding and taxonomy are the scripts in Step 4.4 / 4.45 — not a restated analysis pack.',
    '- No `brd-analysis.json`. Domain/risk seed: `analysis-seed.json`. SPDD Canvas is a `/design` artifact.',
    '',
  ].join('\n');
}

function writeDir(dir, sourceRel) {
  const sourceMd = fs.readFileSync(path.join(dir, 'source-frd.md'), 'utf8');
  const body = render({
    title: titleFrom(sourceMd),
    sourceRel,
    reqs: readJson(path.join(dir, 'brd-requirements.json'), []),
    safeguards: readJson(path.join(dir, 'brd-safeguards.json'), []),
    questions: readJson(path.join(dir, 'brd-open-questions.json'), []),
    clarifications: readJson(path.join(dir, 'clarification-log.json'), []),
    risks: readJson(path.join(dir, 'brd-risks.json'), []),
  });
  const lines = body.split('\n').length;
  if (lines > 80) {
    process.stderr.write(`brd-lean-write: warning — brd.md is ${lines} lines (lean cap is 80)\n`);
  }
  const out = path.join(dir, 'brd.md');
  fs.writeFileSync(out, body);
  return { out, lines };
}

function parseArgs(argv) {
  const opts = { root: process.cwd(), dir: null, source: 'prd.md' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') opts.root = argv[++i];
    else if (argv[i] === '--dir') opts.dir = argv[++i];
    else if (argv[i] === '--source') opts.source = argv[++i];
  }
  opts.dir = path.resolve(opts.root, opts.dir || path.join('specs', 'brd'));
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  const result = writeDir(opts.dir, opts.source);
  process.stdout.write(`brd-lean-write: ${result.out} (${result.lines} lines)\n`);
}

module.exports = { render, writeDir };

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`brd-lean-write: ${err.message}\n`);
    process.exit(2);
  }
}
