#!/usr/bin/env node

'use strict';

// Impact-scoped local regression gate (gap G16, pass 2a). The fast, LOCAL
// complement to G15's regression-gate.js: /gate and /auto's pre-merge step
// still run the WHOLE accumulated e2e/ suite + every prior contract via
// regression-gate.js — too expensive on every /change or /vibe iteration.
// This runs only what impact-scope.js's deterministic TIA says the diff
// could plausibly have broken, plus an always-on golden-path safety net.
//
// Orchestration only — golden-path loading and the scoped e2e/contract
// runners live in hooks/lib/local-regression-gate.js; impact analysis itself
// reuses hooks/lib/impact-scope.js (git plumbing + computeImpactScope), the
// same composition regression-gate.js (G15) already models.
//
// CLI: node .claude/scripts/local-regression-gate.js [--root DIR]
//        [--changed-file PATH ...] [--base-ref REF] [--exclude-group GROUP ...]
//        [--graph ...] [--matrix ...] [--component-map ...]
//        [--e2e-dir e2e] [--e2e-cmd "npx playwright test --reporter=json"]
//        [--sprint-contracts-dir sprint-contracts] [--api-base-url URL]
//        [--flake-history specs/drift/flake-history.jsonl]
//        [--schema contract-schema.json]
//        [--out specs/reviews/local-regression-gate-verdict.json]
//        [--e2e-timeout 600000] [--http-timeout 10000]
// Exit 0 = pass (including "nothing in scope"); 1 = an impact-scoped e2e
// spec or contract check now fails.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveBaseRef, gitChangedFiles, computeImpactScope } = require('../hooks/lib/impact-scope');
const { loadQuarantineNames } = require('../hooks/lib/regression-gate');
const { loadGoldenPaths, runScopedE2e, runScopedContracts } = require('../hooks/lib/local-regression-gate');

const DEFAULT_SCHEMA = path.join(__dirname, '..', 'skills', 'evaluate', 'references', 'contract-schema.json');

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

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function resolveChangedFiles(argv, root) {
  const explicit = argAll(argv, '--changed-file');
  if (explicit.length) return explicit;
  const exec = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8' });
  const baseRef = resolveBaseRef(exec, arg(argv, '--base-ref', undefined));
  return baseRef ? gitChangedFiles(exec, baseRef) : [];
}

function parseOptions(argv, root) {
  const manifest = readJsonSafe(path.join(root, 'project-manifest.json')) || {};
  return {
    graphPath: arg(argv, '--graph', path.join('specs', 'brownfield', 'code-graph.json')),
    matrixPath: arg(argv, '--matrix', path.join('specs', 'test_artefacts', 'verification-matrix.json')),
    componentMapPath: arg(argv, '--component-map', path.join('specs', 'design', 'component-map.md')),
    e2eDir: arg(argv, '--e2e-dir', 'e2e'),
    e2eCmd: arg(argv, '--e2e-cmd', 'npx playwright test --reporter=json'),
    e2eTimeout: parseInt(arg(argv, '--e2e-timeout', '600000'), 10),
    contractsDir: arg(argv, '--sprint-contracts-dir', 'sprint-contracts'),
    excludeGroups: argAll(argv, '--exclude-group'),
    apiBaseUrl: arg(argv, '--api-base-url', (manifest.evaluation && manifest.evaluation.api_base_url) || 'http://localhost:8000'),
    httpTimeout: parseInt(arg(argv, '--http-timeout', '10000'), 10),
    schemaPath: arg(argv, '--schema', DEFAULT_SCHEMA),
    flakeHistoryPath: arg(argv, '--flake-history', path.join(root, 'specs', 'drift', 'flake-history.jsonl')),
    outPath: arg(argv, '--out', path.join(root, 'specs', 'reviews', 'local-regression-gate-verdict.json')),
  };
}

function finish(outPath, verdict) {
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(verdict, null, 2));
  } catch (e) { process.stderr.write(`local-regression-gate: could not write verdict: ${e.message}\n`); }
  for (const note of verdict.notes || []) process.stdout.write(`local-regression-gate: NOTE — ${note}\n`);
  if (verdict.verdict === 'blocked') {
    process.stderr.write(
      `BLOCKED: ${verdict.findings.length} impact-scoped regression(s) found:\n` +
      verdict.findings.map((f) => `  - ${f.file}:${f.line} — ${f.detail}`).join('\n') + '\n'
    );
    return 1;
  }
  process.stdout.write(`local-regression-gate: ${verdict.verdict}\n`);
  return 0;
}

function buildScope(argv, root, opts, notes) {
  const scope = computeImpactScope({
    root,
    changedFiles: resolveChangedFiles(argv, root),
    graphPath: opts.graphPath,
    matrixPath: opts.matrixPath,
    componentMapPath: opts.componentMapPath,
    e2eDir: opts.e2eDir,
    contractsDir: opts.contractsDir,
    excludeGroups: opts.excludeGroups,
  });
  notes.push(...scope.notes);
  const goldenPaths = loadGoldenPaths(root, notes);
  const specs = [...new Set([...scope.specs, ...goldenPaths])];
  return { scope, specs };
}

async function run(argv = process.argv.slice(2)) {
  const root = arg(argv, '--root', process.cwd());
  const opts = parseOptions(argv, root);
  const notes = [];

  const { scope, specs } = buildScope(argv, root, opts, notes);
  const quarantine = loadQuarantineNames(opts.flakeHistoryPath);
  const findings = [];

  runScopedE2e(root, opts, specs, quarantine, notes, findings);
  await runScopedContracts(root, opts, scope.contracts, quarantine, notes, findings);

  const pass = findings.length === 0;
  return finish(opts.outPath, {
    verdict: pass ? 'pass' : 'blocked',
    findings,
    notes,
    scope: { changedFiles: scope.changedFiles, blastRadiusFiles: scope.blastRadiusFiles, impactedGroups: scope.impactedGroups },
  });
}

module.exports = { run };

if (require.main === module) {
  run().then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`local-regression-gate: fatal: ${err.stack || err.message}\n`);
    process.exit(2);
  });
}
