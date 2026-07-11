#!/usr/bin/env node

'use strict';

// Human-facing "ask the codebase" CLI (Devin Ask / DeepWiki Q&A analogue).
// Wraps context-pack + optional structural queries into readable markdown.
//
//   node ask-codebase.js "where is session validation?"
//   npm run ask -- "how do payments fail?"
//
// Exit 0 always (report). Writes specs/reviews/ask-last.md for shareability.

const fs = require('fs');
const path = require('path');
const { buildContextPack } = require('./context-pack');

function arg(argv, name, fb) {
  const i = argv.indexOf(name);
  return i === -1 ? fb : argv[i + 1];
}

function renderAnswer(question, pack) {
  const lines = [
    '# Ask the codebase',
    '',
    `**Question:** ${question}`,
    '',
    `**Confidence:** ${pack.confidence || 'unknown'}`
      + (pack.confidence_reasons && pack.confidence_reasons.length
        ? ` (${pack.confidence_reasons.join(', ')})`
        : ''),
    '',
    `**Status:** ${pack.status || 'ok'} · ~${pack.estimated_tokens || '?'} tokens (budget ${pack.budget_tokens || '?'})`,
    '',
  ];

  if (pack.task_map && pack.task_map.clarify_options && pack.task_map.clarify_options.length) {
    lines.push('## Clarify first', '');
    for (const c of pack.task_map.clarify_options) lines.push(`- ${c}`);
    lines.push('');
  }

  lines.push('## Where to look', '');
  const results = pack.results || [];
  if (!results.length) {
    lines.push('_No strong matches. Try different terms or run `/code-map` / `nav-query refresh`._', '');
  } else {
    for (const r of results.slice(0, 12)) {
      const span = r.start != null ? `:${r.start}` + (r.end != null ? `-${r.end}` : '') : '';
      lines.push(
        `- **\`${r.path}${span}\`**`
        + (r.symbol ? ` — \`${r.symbol}\`` : '')
        + (r.kind ? ` (${r.kind})` : '')
        + (r.reason ? ` — ${r.reason}` : ''),
      );
    }
    lines.push('');
  }

  if (pack.read_next && pack.read_next.length) {
    lines.push('## Read next (slice, do not open whole files)', '');
    for (const r of pack.read_next.slice(0, 10)) lines.push(`- ${r}`);
    lines.push('');
  }

  if (pack.task_map) {
    const tm = pack.task_map;
    if (tm.entrypoints && tm.entrypoints.length) {
      lines.push('## Entry points', '');
      for (const e of tm.entrypoints.slice(0, 8)) {
        lines.push(`- \`${e.path}\`${e.symbol ? ` · \`${e.symbol}\`` : ''}`);
      }
      lines.push('');
    }
    if (tm.must_not_break && tm.must_not_break.length) {
      lines.push('## Must not break', '');
      for (const m of tm.must_not_break.slice(0, 8)) lines.push(`- ${typeof m === 'string' ? m : JSON.stringify(m)}`);
      lines.push('');
    }
    if (tm.tests_to_run && tm.tests_to_run.length) {
      lines.push('## Related tests', '');
      for (const t of tm.tests_to_run.slice(0, 10)) lines.push(`- \`${t}\``);
      lines.push('');
    }
  }

  lines.push(
    '## Deeper tools',
    '',
    '```bash',
    `node .claude/scripts/nav-query.js pack --budget 1600 "${question.replace(/"/g, '\\"')}"`,
    `node .claude/scripts/nav-query.js semantic "${question.replace(/"/g, '\\"')}"`,
    'node .claude/scripts/nav-query.js hubs',
    '```',
    '',
    'Homepage: `docs/CODEBASE.md` · DeepWiki: `specs/brownfield/wiki/WIKI.md`',
    '',
  );
  return lines.join('\n');
}

function ask({ root = process.cwd(), question, budget = 1600 } = {}) {
  const pack = buildContextPack({
    projectDir: root,
    question,
    budgetTokens: budget,
    depth: 2,
    useDiff: false,
    writeReceipt: true,
  });
  const md = renderAnswer(question, pack);
  return { pack, md };
}

function main(argv = process.argv.slice(2)) {
  const root = arg(argv, '--root', process.cwd());
  const budget = parseInt(arg(argv, '--budget', '1600'), 10) || 1600;
  const jsonOut = arg(argv, '--json-out', null);
  // question = remaining non-flag args
  const parts = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' || argv[i] === '--budget' || argv[i] === '--json-out') {
      i += 1;
      continue;
    }
    if (argv[i].startsWith('--')) continue;
    parts.push(argv[i]);
  }
  const question = parts.join(' ').trim();
  if (!question) {
    process.stderr.write('usage: ask-codebase.js [--budget N] "question"\n');
    return 2;
  }

  const { pack, md } = ask({ root, question, budget });
  const outDir = path.join(root, 'specs', 'reviews');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'ask-last.md'), md);
  fs.writeFileSync(path.join(outDir, 'ask-last.json'), `${JSON.stringify({ question, pack }, null, 2)}\n`);
  if (jsonOut) {
    fs.writeFileSync(path.join(root, jsonOut), `${JSON.stringify({ question, pack }, null, 2)}\n`);
  }
  process.stdout.write(md);
  if (!md.endsWith('\n')) process.stdout.write('\n');
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    process.stderr.write(`ask-codebase: ${e.message}\n`);
    process.exit(2);
  }
}

module.exports = { ask, renderAnswer, main };
