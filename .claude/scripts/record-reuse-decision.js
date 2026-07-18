#!/usr/bin/env node
'use strict';

// C4 decision recorder for the reuse-or-justify loop. Appends one JSON line per
// resolved intake fork to specs/reviews/reuse-decisions.jsonl (append-only,
// gitignored under **/specs/reviews/ — same convention as at-red-receipts.jsonl).
// Immutable: a correction is a NEW line, never an edit. Called by the
// reuse-or-justify skill after the human resolves the decision.
//
// CLI: node .claude/scripts/record-reuse-decision.js --story <id>
//        --decision <extend|new-seam|net-new> [--seam <path>] [--action <a>]
//        --justification "<why>" [--invariant-impact "<txt>"] [--budget '<json>']
//        [--options "<considered>"] [--root DIR] [--out <path>]

const fs = require('fs');
const path = require('path');

const DEFAULT_OUT = path.join('specs', 'reviews', 'reuse-decisions.jsonl');
const DECISIONS = new Set(['extend', 'new-seam', 'net-new']);

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

function resolveOutPath(root, argv) {
  const out = arg(argv, '--out', DEFAULT_OUT);
  return path.isAbsolute(out) ? out : path.join(root, out);
}

function appendRecord(outPath, record) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.appendFileSync(outPath, JSON.stringify(record) + '\n');
}

function usage() {
  process.stderr.write('usage: record-reuse-decision.js --story <id> --decision <extend|new-seam|net-new> --justification "<why>" [--seam <path>] [--action <a>] [--invariant-impact <t>] [--budget <json>] [--options <t>]\n');
}

function run(argv, root, deps) {
  const story = arg(argv, '--story', null);
  const decision = arg(argv, '--decision', null);
  const justification = arg(argv, '--justification', null);
  const seam = arg(argv, '--seam', null);
  if (!story || !DECISIONS.has(decision) || !justification) { usage(); return 2; }
  if ((decision === 'extend' || decision === 'new-seam') && !seam) { usage(); return 2; }
  let budget = null;
  const budgetRaw = arg(argv, '--budget', null);
  if (budgetRaw) { try { budget = JSON.parse(budgetRaw); } catch (_) { budget = null; } }
  const now = (deps && deps.now) || (() => new Date().toISOString());
  appendRecord(resolveOutPath(root, argv), {
    storyId: story,
    decision,
    seam: seam || null,
    action: arg(argv, '--action', null),
    options_considered: arg(argv, '--options', null),
    justification,
    invariant_impact: arg(argv, '--invariant-impact', null),
    budget,
    recordedAt: now(),
  });
  process.stdout.write(`record-reuse-decision: recorded ${decision} for story ${story}.\n`);
  return 0;
}

module.exports = { run, resolveOutPath, appendRecord };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
