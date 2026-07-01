#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { checkCanvasSync, renderSyncReport } = require('../hooks/lib/canvas-sync');

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
  const outPath = arg(argv, '--out', path.join(root, 'specs', 'reviews', 'canvas-sync-check.md'));
  if (!fs.existsSync(canvasPath)) {
    process.stdout.write('canvas-sync: no reasons-canvas.md found; skipping\n');
    return 0;
  }
  const filesArg = arg(argv, '--files', null);
  const files = filesArg ? filesArg.split(',').map((s) => s.trim()).filter(Boolean) : changedFiles(root);
  const result = checkCanvasSync({ canvasText: fs.readFileSync(canvasPath, 'utf8'), changedFiles: files });
  const report = renderSyncReport(result);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, report);
  process.stdout.write(`canvas-sync: ${result.missingFromGoverns.length + result.missingFromOperations.length} issue(s)\n`);
  return result.missingFromGoverns.length || result.missingFromOperations.length ? 1 : 0;
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
