#!/usr/bin/env node

'use strict';

// Refresh .claude/state/agent-readiness-baseline.json from a fresh report.
// Use after a deliberate readiness improvement (e.g. new pillar went active).
// Does NOT lower the baseline automatically — if current.active < baseline.active,
// refuse unless --force is passed.
//
// Usage:
//   npm run agent-readiness:baseline
//   node .claude/scripts/update-readiness-baseline.js [--root path] [--force]

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  return argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}

function main(argv = process.argv.slice(2)) {
  const root = path.resolve(arg(argv, '--root', process.cwd()));
  const force = argv.includes('--force');
  const reportPath = path.join(root, 'specs', 'reviews', 'agent-readiness.json');
  const baselinePath = path.join(root, '.claude', 'state', 'agent-readiness-baseline.json');

  const gen = spawnSync(process.execPath, [path.join(root, '.claude', 'scripts', 'agent-readiness.js')], {
    cwd: root,
    encoding: 'utf8',
  });
  if (gen.status !== 0) {
    process.stderr.write(gen.stdout + gen.stderr);
    process.stderr.write('update-readiness-baseline: agent-readiness failed\n');
    process.exit(gen.status || 1);
  }

  if (!fs.existsSync(reportPath)) {
    process.stderr.write(`update-readiness-baseline: report missing after run: ${reportPath}\n`);
    process.exit(1);
  }

  const current = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const active = (current.summary && current.summary.active) || 0;

  if (fs.existsSync(baselinePath) && !force) {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const baseActive = (baseline.summary && baseline.summary.active) || 0;
    if (active < baseActive) {
      process.stderr.write(
        `update-readiness-baseline: refusing to lower baseline active ${baseActive} -> ${active}. ` +
          'Pass --force if intentional.\n'
      );
      process.exit(1);
    }
  }

  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  // Drop volatile generatedAt noise for cleaner diffs? Keep full report for pillar detail.
  fs.writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  process.stdout.write(
    `update-readiness-baseline: wrote ${path.relative(root, baselinePath)} ` +
      `(active ${active}/8).\n`
  );
  process.exit(0);
}

if (require.main === module) main();
