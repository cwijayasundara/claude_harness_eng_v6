#!/usr/bin/env node

'use strict';

// Re-bless approved fixtures (gap G12, slice 3). Writes/updates the baseline
// specs/test_artefacts/approved-snapshots.json with current snapshot checksums.
// The unblock for approved-fixtures-gate.js after a reviewed snapshot change.
//
// CLI: node .claude/scripts/approve-fixtures.js [--root DIR] [--baseline P]
//        [--approver NAME] [--date YYYY-MM-DD] (--all | --snapshots f1 f2 ...)

const fs = require('fs');
const path = require('path');
const lib = require('../hooks/lib/fixtures.js');

function arg(argv, name, fb) { const i = argv.indexOf(name); return i === -1 ? fb : argv[i + 1]; }

function selected(argv) {
  const i = argv.indexOf('--snapshots');
  if (i === -1) return null;
  const out = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) out.push(argv[j]);
  return out;
}

function entriesFor(root, baselinePath, argv, meta) {
  const patterns = (() => {
    try { return lib.resolvePatterns(JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8'))); }
    catch (_) { return lib.DEFAULT_PATTERNS; }
  })();
  const mk = (rel) => ({ path: rel, checksum: lib.checksumOf(root, rel), approved_by: meta.approver, date: meta.date });
  if (argv.includes('--all')) return lib.findSnapshots(root, patterns).map(mk);
  const map = new Map(lib.readBaseline(baselinePath).map((e) => [e.path, e]));
  for (const rel of selected(argv) || []) map.set(rel, mk(rel));
  return [...map.values()];
}

function main() {
  const argv = process.argv.slice(2);
  const root = arg(argv, '--root', process.cwd());
  const baselinePath = arg(argv, '--baseline', path.join(root, 'specs', 'test_artefacts', 'approved-snapshots.json'));
  const meta = { approver: arg(argv, '--approver', 'human'), date: arg(argv, '--date', new Date().toISOString().slice(0, 10)) };
  const entries = entriesFor(root, baselinePath, argv, meta).sort((a, b) => (a.path < b.path ? -1 : 1));
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify(entries, null, 2) + '\n');
  process.stdout.write(`approve-fixtures: baseline now has ${entries.length} approved snapshot(s)\n`);
  process.exit(0);
}

module.exports = {};

if (require.main === module) main();
