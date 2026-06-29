#!/usr/bin/env node

'use strict';

// Approved-fixtures gate (gap G12, slice 3). Treats snapshot/golden files as
// locked oracles: BLOCKs when an approved snapshot's checksum changed (drift)
// or a new unapproved snapshot appears. Dormant (no-snapshots, exit 0) when a
// project has no snapshot files, so the harness's own repo is unaffected.
// Re-bless with approve-fixtures.js. Boundary-gated in /gate.
//
// CLI: node .claude/scripts/approved-fixtures-gate.js [--root DIR] [--baseline P] [--out P]
// Exit 0 = pass / no-snapshots; 1 = blocked (modified or unapproved).

const fs = require('fs');
const path = require('path');
const lib = require('../hooks/lib/fixtures.js');

function arg(argv, name, fb) { const i = argv.indexOf(name); return i === -1 ? fb : argv[i + 1]; }

function finish(outPath, verdict, code, blocked) {
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(verdict, null, 2));
  } catch (e) { process.stderr.write(`approved-fixtures: could not write verdict: ${e.message}\n`); }
  process.stdout.write(`approved-fixtures: ${verdict.verdict} (modified ${verdict.modified.length}, unapproved ${verdict.unapproved.length}, removed ${verdict.removed.length})\n`);
  if (blocked) process.stdout.write('approved-fixtures: review then run `npm run approve-fixtures -- --all` to bless the current snapshot set.\n');
  process.exit(code);
}

function main() {
  const argv = process.argv.slice(2);
  const root = arg(argv, '--root', process.cwd());
  const baselinePath = arg(argv, '--baseline', path.join(root, 'specs', 'test_artefacts', 'approved-snapshots.json'));
  const outPath = arg(argv, '--out', path.join(root, 'specs', 'reviews', 'approved-fixtures-verdict.json'));
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8')); } catch (_) { /* none */ }
  const found = lib.findSnapshots(root, lib.resolvePatterns(manifest));
  if (found.length === 0) return finish(outPath, { verdict: 'no-snapshots', modified: [], unapproved: [], removed: [], ok_count: 0 }, 0, false);
  const r = lib.classify(found, lib.readBaseline(baselinePath), (rel) => lib.checksumOf(root, rel));
  const blocked = r.modified.length > 0 || r.unapproved.length > 0;
  const verdict = { verdict: blocked ? 'blocked' : 'pass', modified: r.modified, unapproved: r.unapproved, removed: r.removed, ok_count: r.ok.length };
  return finish(outPath, verdict, blocked ? 1 : 0, blocked);
}

module.exports = {};

if (require.main === module) main();
