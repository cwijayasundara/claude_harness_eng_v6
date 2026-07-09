#!/usr/bin/env node

'use strict';

// Regression-suite-full gate (gap G15). Closes the cross-feature regression
// hole: /evaluate and /gate only check the CURRENT story-group's sprint
// contract; /change and /vibe only re-run the unit suite. Neither re-runs the
// ACCUMULATED e2e/ Playwright suite or PRIOR story-groups' sprint contracts,
// so a fix that passes its own tests can silently break an earlier feature.
//
// Orchestration only — the mechanical pieces (discovery, quarantine
// matching, Playwright-report parsing, one API-check HTTP round trip) live in
// hooks/lib/regression-gate.js, reused the same way cycle-gate.js /
// mutation-gate.js reuse their hooks/lib counterparts.
//
// Degrades LOUDLY (never silently) when there is nothing to regress against
// yet (no e2e/ dir and no sprint-contracts/ dir), when the e2e binary is not
// runnable, or when a contracts dir has no prior (non-current) group to
// check — every path writes a note into the verdict file and prints it.
//
// CLI: node .claude/scripts/regression-gate.js [--root DIR]
//        [--e2e-dir e2e] [--e2e-cmd "npx playwright test --reporter=json"]
//        [--sprint-contracts-dir sprint-contracts] [--exclude-group GROUP ...]
//        [--api-base-url URL] [--flake-history specs/drift/flake-history.jsonl]
//        [--schema contract-schema.json] [--out specs/reviews/regression-gate-verdict.json]
//        [--e2e-timeout 600000] [--http-timeout 10000]
// Exit 0 = pass / no-baseline (nothing to regress against); 1 = a previously
// passing e2e spec or a prior sprint contract's API check now fails.

const fs = require('fs');
const path = require('path');
const { validate } = require('../hooks/lib/contract-schema');
const {
  discoverE2eSpecs,
  discoverPriorContracts,
  loadQuarantineNames,
  isQuarantined,
  extractPlaywrightFailures,
  runE2eSuite,
  lineOfCheckId,
  bodyMatches,
  evaluateApiCheck,
  regressPriorContract,
} = require('../hooks/lib/regression-gate');

const DEFAULT_SCHEMA = path.join(__dirname, '..', 'skills', 'evaluate', 'references', 'contract-schema.json');

function arg(argv, name, fb) { const i = argv.indexOf(name); return i === -1 ? fb : argv[i + 1]; }
function argAll(argv, name) { const out = []; argv.forEach((a, i) => { if (a === name) out.push(argv[i + 1]); }); return out; }
function readJsonSafe(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } }

function parseOptions(argv, root) {
  const manifest = readJsonSafe(path.join(root, 'project-manifest.json')) || {};
  return {
    e2eDir: arg(argv, '--e2e-dir', 'e2e'),
    e2eCmd: arg(argv, '--e2e-cmd', 'npx playwright test --reporter=json'),
    e2eTimeout: parseInt(arg(argv, '--e2e-timeout', '600000'), 10),
    contractsDir: arg(argv, '--sprint-contracts-dir', 'sprint-contracts'),
    excludeGroups: argAll(argv, '--exclude-group'),
    apiBaseUrl: arg(argv, '--api-base-url', (manifest.evaluation && manifest.evaluation.api_base_url) || 'http://localhost:8000'),
    httpTimeout: parseInt(arg(argv, '--http-timeout', '10000'), 10),
    schemaPath: arg(argv, '--schema', DEFAULT_SCHEMA),
    flakeHistoryPath: arg(argv, '--flake-history', path.join(root, 'specs', 'drift', 'flake-history.jsonl')),
    outPath: arg(argv, '--out', path.join(root, 'specs', 'reviews', 'regression-gate-verdict.json')),
  };
}

function runE2eRegression(root, opts, quarantine, notes, findings) {
  const specs = discoverE2eSpecs(root, opts.e2eDir);
  if (specs === null) {
    notes.push(`no ${opts.e2eDir}/ directory — accumulated Playwright regression skipped (nothing to regress against yet)`);
    return;
  }
  if (specs.length === 0) {
    notes.push(`${opts.e2eDir}/ exists but has no *.spec.(ts|js) files — nothing to run`);
    return;
  }
  const result = runE2eSuite(root, opts.e2eCmd, opts.e2eTimeout);
  if (result.unprovisioned) {
    notes.push(`e2e command "${opts.e2eCmd}" is not runnable (binary not found) — accumulated Playwright regression skipped; install/configure it to enforce`);
    return;
  }
  if (!result.report) {
    if (result.code !== 0) {
      findings.push({ file: opts.e2eDir, line: 1, detail: `e2e suite exited ${result.code} but produced no parseable JSON report — see raw output for detail` });
    }
    return;
  }
  for (const f of extractPlaywrightFailures(result.report)) {
    if (isQuarantined(f.title, quarantine)) { notes.push(`quarantined flake excluded: ${f.title}`); continue; }
    findings.push({ file: f.file ? path.join(opts.e2eDir, f.file) : opts.e2eDir, line: f.line, detail: `e2e regression: "${f.title}" now fails` });
  }
}

async function runContractRegression(root, opts, quarantine, notes, findings) {
  const contracts = discoverPriorContracts(root, opts.contractsDir, opts.excludeGroups);
  if (contracts === null) {
    notes.push(`no ${opts.contractsDir}/ directory — prior sprint-contract API regression skipped (nothing to regress against yet)`);
    return;
  }
  if (contracts.length === 0) {
    notes.push(`${opts.contractsDir}/ exists but has no prior contracts to re-validate (only the current group, or none yet)`);
    return;
  }
  const schema = readJsonSafe(opts.schemaPath);
  if (schema === null) {
    findings.push({
      file: opts.schemaPath,
      line: 1,
      detail: `contract-schema unreadable — cannot verify ${contracts.length} prior contract(s) are still schema-valid (regression-gate refuses to silently skip the schema-drift check)`,
    });
    return;
  }
  for (const contractPath of contracts) {
    const contractFindings = await regressPriorContract(contractPath, opts.apiBaseUrl, quarantine, schema, validate, opts.httpTimeout);
    findings.push(...contractFindings);
  }
}

function finish(outPath, verdict) {
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(verdict, null, 2));
  } catch (e) { process.stderr.write(`regression-gate: could not write verdict: ${e.message}\n`); }
  for (const note of verdict.notes || []) process.stdout.write(`regression-gate: NOTE — ${note}\n`);
  if (verdict.verdict === 'blocked') {
    process.stderr.write(
      `BLOCKED: ${verdict.findings.length} regression(s) found:\n` +
      verdict.findings.map((f) => `  - ${f.file}:${f.line} — ${f.detail}`).join('\n') + '\n'
    );
    return 1;
  }
  process.stdout.write(`regression-gate: ${verdict.verdict}${verdict.message ? ' — ' + verdict.message : ''}\n`);
  return 0;
}

function noBaselineVerdict(opts) {
  return {
    verdict: 'no-baseline',
    message: `no ${opts.e2eDir}/ directory and no ${opts.contractsDir}/ directory — nothing to regress against`,
    findings: [],
    notes: [],
  };
}

async function run(argv = process.argv.slice(2)) {
  const root = arg(argv, '--root', process.cwd());
  const opts = parseOptions(argv, root);
  const quarantine = loadQuarantineNames(opts.flakeHistoryPath);

  const hasBaseline = fs.existsSync(path.join(root, opts.e2eDir)) || fs.existsSync(path.join(root, opts.contractsDir));
  if (!hasBaseline) return finish(opts.outPath, noBaselineVerdict(opts));

  const notes = [];
  const findings = [];
  runE2eRegression(root, opts, quarantine, notes, findings);
  await runContractRegression(root, opts, quarantine, notes, findings);

  const pass = findings.length === 0;
  return finish(opts.outPath, { verdict: pass ? 'pass' : 'blocked', findings, notes });
}

module.exports = {
  discoverE2eSpecs,
  discoverPriorContracts,
  loadQuarantineNames,
  isQuarantined,
  extractPlaywrightFailures,
  lineOfCheckId,
  bodyMatches,
  evaluateApiCheck,
  run,
};

if (require.main === module) {
  run().then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`regression-gate: fatal: ${err.stack || err.message}\n`);
    process.exit(2);
  });
}
