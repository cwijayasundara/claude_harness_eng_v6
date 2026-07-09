#!/usr/bin/env node

'use strict';

// Deterministic Test Impact Analysis (gap G16, pass 2a). Closes the "no local
// signal" hole left after G15: regression-gate.js (G15) only proves itself at
// merge time (/gate, /auto pre-merge) by running the WHOLE accumulated e2e/
// suite + every prior sprint contract — too expensive on every /change or
// /vibe iteration. This computes, mechanically and without an LLM, which
// specs/contracts a diff could plausibly have broken.
//
// Orchestration only — the mechanical pieces (git plumbing, blast radius,
// group/spec/contract resolution) live in hooks/lib/impact-scope.js, reused
// the same way regression-gate.js (G15) reuses its hooks/lib counterpart.
//
// CLI: node .claude/scripts/impact-scope.js [--root DIR]
//        [--changed-file PATH ...] [--base-ref REF]
//        [--graph specs/brownfield/code-graph.json]
//        [--matrix specs/test_artefacts/verification-matrix.json]
//        [--component-map specs/design/component-map.md]
//        [--e2e-dir e2e] [--sprint-contracts-dir sprint-contracts]
//        [--out specs/reviews/impact-scope.json]
// Always exits 0 — this computes scope, it does not gate; local-regression-
// gate.js consumes its output and does the blocking.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  resolveDefaultBranch,
  resolveBaseRef,
  gitChangedFiles,
  computeBlastRadius,
  parseComponentMapStoryFiles,
  resolveGroupsForFiles,
  resolveSpecsAndContracts,
  computeImpactScope,
} = require('../hooks/lib/impact-scope');

function arg(argv, name, fb) {
  const i = argv.indexOf(name);
  return i === -1 ? fb : argv[i + 1];
}

function argAll(argv, name) {
  const out = [];
  argv.forEach((a, i) => {
    if (a === name) out.push(argv[i + 1]);
  });
  return out;
}

function gitExec(root) {
  return function exec(cmd, cmdArgs) {
    return execFileSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8' });
  };
}

function resolveChangedFiles(argv, root) {
  const explicit = argAll(argv, '--changed-file');
  if (explicit.length) return explicit;
  const exec = gitExec(root);
  const baseRef = resolveBaseRef(exec, arg(argv, '--base-ref', undefined));
  return baseRef ? gitChangedFiles(exec, baseRef) : [];
}

function parseOptions(argv, root) {
  return {
    root,
    changedFiles: resolveChangedFiles(argv, root),
    graphPath: arg(argv, '--graph', path.join('specs', 'brownfield', 'code-graph.json')),
    matrixPath: arg(argv, '--matrix', path.join('specs', 'test_artefacts', 'verification-matrix.json')),
    componentMapPath: arg(argv, '--component-map', path.join('specs', 'design', 'component-map.md')),
    e2eDir: arg(argv, '--e2e-dir', 'e2e'),
    contractsDir: arg(argv, '--sprint-contracts-dir', 'sprint-contracts'),
  };
}

function report(result) {
  for (const note of result.notes) {
    process.stdout.write(`impact-scope: NOTE — ${note}\n`);
  }
  process.stdout.write(`impact-scope: ${result.specs.length} spec(s), ${result.contracts.length} contract(s) in scope\n`);
}

function run(argv = process.argv.slice(2)) {
  const root = arg(argv, '--root', process.cwd());
  const outPath = arg(argv, '--out', path.join(root, 'specs', 'reviews', 'impact-scope.json'));
  const opts = parseOptions(argv, root);

  const result = computeImpactScope(opts);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  report(result);
  return 0;
}

module.exports = {
  resolveDefaultBranch,
  resolveBaseRef,
  gitChangedFiles,
  computeBlastRadius,
  parseComponentMapStoryFiles,
  resolveGroupsForFiles,
  resolveSpecsAndContracts,
  computeImpactScope,
  run,
};

if (require.main === module) {
  process.exit(run());
}
