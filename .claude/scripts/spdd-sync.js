#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/spdd-sync.js [--write] [--root DIR] [--files a,b]
// SPDD /spdd-sync: rewrite the structured record from the code (Canvas +
// bundles). Report-only without --write. Exit 0 = pass/skip, 1 = remaining
// issues or AC drift, 2 = IO.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { runSpddSync } = require('../hooks/lib/spdd-sync');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 || argv[i + 1] === undefined ? fallback : String(argv[i + 1]);
}

function changedFiles(root, filesArg) {
  if (filesArg) return filesArg.split(',').map((s) => s.trim()).filter(Boolean);
  try {
    return cp.execFileSync('git', ['-C', root, 'diff', '--name-only', 'HEAD'], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function run(argv = process.argv.slice(2), cwd = process.cwd()) {
  const root = path.resolve(cwd, arg(argv, '--root', cwd));
  const write = argv.includes('--write');
  const files = changedFiles(root, arg(argv, '--files', null));
  const verdict = runSpddSync({ root, write, changedFiles: files });
  const outDir = path.join(root, 'specs', 'reviews');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'spdd-sync.json'), `${JSON.stringify(verdict, null, 2)}\n`);

  if (verdict.canvas.skipped) process.stdout.write('spdd-sync: canvas SKIP — no reasons-canvas.md\n');
  else process.stdout.write(`spdd-sync: canvas ${verdict.canvas.issues} issue(s)${verdict.canvas.written ? ' (applied)' : ''}\n`);
  if (verdict.bundles.skipped) process.stdout.write('spdd-sync: bundles SKIP — no specs/bundles/\n');
  else process.stdout.write(`spdd-sync: bundles ${verdict.bundles.pass ? 'ok' : 'FAIL'} written=${verdict.bundles.written}\n`);

  if (!verdict.pass) {
    for (const err of verdict.bundles.errors || []) process.stderr.write(`  - ${err}\n`);
    return 1;
  }
  return 0;
}

module.exports = { run };

if (require.main === module) {
  try {
    process.exit(run());
  } catch (err) {
    process.stderr.write(`spdd-sync: ${err.message}\n`);
    process.exit(2);
  }
}
