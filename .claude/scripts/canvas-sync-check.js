#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { checkCanvasSync, renderSyncReport, applyCanvasProposal } = require('../hooks/lib/canvas-sync');

function arg(argv, name, fallback = null) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

function changedFiles(root) {
  const out = cp.execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

// --write path: apply the deterministic proposal in place, re-check, and report.
// `applied` is driven off the post-apply re-check, not the fact that --write ran:
// if a section was absent the insert is a no-op, so the report must not claim success.
function applyAndReport(canvasPath, canvasDisplay, outPath, canvasText, files, result) {
  const updated = applyCanvasProposal(canvasText, result);
  fs.writeFileSync(canvasPath, updated);
  const after = checkCanvasSync({ canvasText: updated, changedFiles: files });
  const remaining = after.missingFromGoverns.length + after.missingFromOperations.length;
  fs.writeFileSync(outPath, renderSyncReport(result, { applied: remaining === 0, canvasPath: canvasDisplay }));
  process.stdout.write(`canvas-sync: applied proposal to ${path.basename(canvasPath)}; ${remaining} issue(s) remaining\n`);
  return remaining ? 1 : 0;
}

function run(argv = process.argv.slice(2), root = process.cwd()) {
  const canvasPath = arg(argv, '--canvas', path.join(root, 'specs', 'design', 'reasons-canvas.md'));
  const outPath = arg(argv, '--out', path.join(root, 'specs', 'reviews', 'canvas-sync-check.md'));
  if (!fs.existsSync(canvasPath)) {
    process.stdout.write('canvas-sync: no reasons-canvas.md found; skipping\n');
    return 0;
  }
  const filesArg = arg(argv, '--files', null);
  const write = argv.includes('--write');
  const files = filesArg ? filesArg.split(',').map((s) => s.trim()).filter(Boolean) : changedFiles(root);
  // Repo-relative form for report prose so a --canvas override is named honestly
  // (default resolves to specs/design/reasons-canvas.md).
  const canvasDisplay = path.relative(root, canvasPath) || path.basename(canvasPath);
  const canvasText = fs.readFileSync(canvasPath, 'utf8');
  const result = checkCanvasSync({ canvasText, changedFiles: files });
  const issues = result.missingFromGoverns.length + result.missingFromOperations.length;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // --write applies the deterministic proposal in place; without it (or with nothing
  // to fix) the Canvas is never mutated — detect + propose only.
  if (write && issues) return applyAndReport(canvasPath, canvasDisplay, outPath, canvasText, files, result);

  fs.writeFileSync(outPath, renderSyncReport(result, { canvasPath: canvasDisplay }));
  process.stdout.write(`canvas-sync: ${issues} issue(s)\n`);
  return issues ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exit(run());
  } catch (err) {
    process.stderr.write(`canvas-sync: ${err.message}\n`);
    process.exit(2);
  }
}

module.exports = { run };
