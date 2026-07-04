#!/usr/bin/env node

'use strict';

// Amendment-provenance sensor (sprint-delta lane, design spec 2026-07-04 §4).
// specs/design/ is living truth; once a baseline design exists, any commit
// touching it must carry a matching record under specs/design/amendments/ —
// otherwise the evolution is invisible to the next sprint's human gate.
// Modeled on ownership-check.js: pure core + git-diff CLI wrapper, fail-loud
// on a broken control (a design change with no amendment is not a vacuous pass).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DESIGN_PREFIX = 'specs/design/';
const AMENDMENTS_PREFIX = 'specs/design/amendments/';
const BASELINE_FILE = 'specs/design/architecture.md';
const VERDICT_REL = path.join('specs', 'reviews', 'amendment-provenance.json');

function normalize(file) {
  return String(file).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

// Pure core. files = staged/changed repo-relative paths. baselineExists = true
// when BASELINE_FILE was already tracked at the commit's parent (HEAD).
function checkProvenance(files, baselineExists) {
  const normalized = files.map(normalize);
  const designChanges = normalized.filter(
    (f) => f.startsWith(DESIGN_PREFIX) && !f.startsWith(AMENDMENTS_PREFIX)
  );
  if (designChanges.length === 0) {
    return { pass: true, verdict: 'not-applicable', design_changes: [] };
  }
  if (!baselineExists) {
    return { pass: true, verdict: 'initial-design', design_changes: designChanges };
  }
  const newAmendments = normalized.filter((f) => f.startsWith(AMENDMENTS_PREFIX));
  if (newAmendments.length === 0) {
    return {
      pass: false,
      verdict: 'missing_amendment',
      design_changes: designChanges,
      reason: `${designChanges.length} file(s) under ${DESIGN_PREFIX} changed with no matching file under ${AMENDMENTS_PREFIX} in the same commit`,
    };
  }
  return { pass: true, verdict: 'amended', design_changes: designChanges, amendments: newAmendments };
}

function stagedFiles(exec) {
  const out = exec('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  return String(out).split('\n').filter(Boolean);
}

function baselineExistsAtHead(exec) {
  try {
    exec('git', ['show', `HEAD:${BASELINE_FILE}`]);
    return true;
  } catch (_) {
    return false;
  }
}

function writeVerdict(root, verdict) {
  const out = path.join(root, VERDICT_REL);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(verdict, null, 2) + '\n');
}

function run(argv, root, deps) {
  const exec = (deps && deps.exec) || ((cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }));

  let files;
  if (argv[0] === '--staged') {
    files = stagedFiles(exec);
  } else if (argv[0] === '--files') {
    files = argv.slice(1);
  } else {
    process.stderr.write('usage: amendment-provenance-check.js --staged | --files <path> [...]\n');
    return 2;
  }

  const baselineExists = (deps && 'baselineExists' in deps) ? deps.baselineExists : baselineExistsAtHead(exec);
  const verdict = checkProvenance(files, baselineExists);
  writeVerdict(root, verdict);
  const label = verdict.pass ? 'PASS' : 'FAIL';
  process.stdout.write(`amendment-provenance: ${label} — ${verdict.verdict}${verdict.reason ? ` (${verdict.reason})` : ''}\n`);
  return verdict.pass ? 0 : 1;
}

module.exports = { checkProvenance, run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
