#!/usr/bin/env node

'use strict';

// Semantic half of code->prompt sync. Where canvas-sync-check.js checks path-level
// membership (are changed files in the Canvas Governs/Operations lists), this builds
// the packet an agent uses to judge whether the Canvas PROSE still describes the
// changed governed code. It is deterministic (it selects the claims); the judgement
// is delegated to /gate's dispatched agent, so the script is advisory (always exit 0).

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { buildSemanticReview, renderSemanticReview } = require('../hooks/lib/canvas-sync');

function arg(argv, name, fallback = null) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

function changedFiles(root) {
  const out = cp.execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function run(argv = process.argv.slice(2), root = process.cwd()) {
  const canvasPath = arg(argv, '--canvas', path.join(root, 'specs', 'design', 'reasons-canvas.md'));
  const outPath = arg(argv, '--out', path.join(root, 'specs', 'reviews', 'canvas-semantic-review.md'));
  if (!fs.existsSync(canvasPath)) {
    process.stdout.write('canvas-semantic: no reasons-canvas.md found; skipping\n');
    return 0;
  }
  const filesArg = arg(argv, '--files', null);
  const files = filesArg ? filesArg.split(',').map((s) => s.trim()).filter(Boolean) : changedFiles(root);
  const canvasDisplay = path.relative(root, canvasPath) || path.basename(canvasPath);
  const review = buildSemanticReview({ canvasText: fs.readFileSync(canvasPath, 'utf8'), changedFiles: files });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, renderSemanticReview(review, { canvasPath: canvasDisplay }));
  process.stdout.write(`canvas-semantic: ${review.changedGoverned.length} governed file(s), ${review.claims.length} claim(s) to verify\n`);
  return 0; // advisory — the packet is the seam; the judgement is the dispatched agent's
}

if (require.main === module) {
  try {
    process.exit(run());
  } catch (err) {
    process.stderr.write(`canvas-semantic: ${err.message}\n`);
    process.exit(2);
  }
}

module.exports = { run };
