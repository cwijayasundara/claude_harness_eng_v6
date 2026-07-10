'use strict';

// Sprint contract, typecheck, coverage, and mutation pre-commit gates.

const fs = require('fs');
const path = require('path');
const { run, output, shouldBlock, skipped } = require('./toolchain');
const { validate: validateSchema } = require('./contract-schema');
const { runMutationOnFiles, renderSurvivors } = require('./mutation-gate');
const { failBlock, noteSkip, inAutoBuild, FLOOR, requireScript } = require('./pre-commit-util');

function validateContractShape(projectDir, group) {
  const schemaPath = path.join(projectDir, '.claude', 'skills', 'evaluate', 'references', 'contract-schema.json');
  if (!fs.existsSync(schemaPath)) return;
  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(path.join(projectDir, 'sprint-contracts', `${group}.json`), 'utf8'));
  } catch (_) {
    failBlock({
      id: 'sprint-contract',
      title: `sprint-contracts/${group}.json is not valid JSON`,
      fix: `re-negotiate the contract (node .claude/scripts/validate-contract.js sprint-contracts/${group}.json to check).`,
      minTier: 'minimal',
    });
  }
  const errors = validateSchema(JSON.parse(fs.readFileSync(schemaPath, 'utf8')), contract);
  if (errors.length > 0) {
    failBlock({
      id: 'sprint-contract',
      title: `sprint-contracts/${group}.json fails schema validation`,
      detail: `${errors.map((e) => `  - ${e}`).join('\n')}\n`,
      fix: `correct the contract (node .claude/scripts/validate-contract.js sprint-contracts/${group}.json).`,
      minTier: 'minimal',
    });
  }
}

function checkSecurityVerdict(projectDir, group) {
  let verdict = null;
  try {
    verdict = JSON.parse(fs.readFileSync(path.join(projectDir, 'specs', 'reviews', 'security-verdict.json'), 'utf8'));
  } catch (_) {
    /* missing or unparseable = not PASS */
  }
  const passed = verdict && (verdict.pass === true || verdict.verdict === 'PASS');
  if (!passed) {
    failBlock({
      id: 'sprint-contract',
      title: `security gate for group ${group} not satisfied — specs/reviews/security-verdict.json is missing or not PASS`,
      fix: 'run /evaluate (its security layer writes the verdict), address findings, then retry the commit.',
      minTier: 'minimal',
    });
  }
}

function checkVerificationMatrix(projectDir, group) {
  if (!fs.existsSync(path.join(projectDir, 'specs', 'test_artefacts', 'verification-matrix.json'))) return;
  let runGate;
  try {
    ({ runGate } = requireScript('verification-matrix-gate'));
  } catch (_) {
    noteSkip('verification-matrix', 'gate script missing or unloadable from .claude/scripts');
    return;
  }
  let verdict;
  try {
    verdict = runGate({ root: projectDir, phase: 'executed', group });
  } catch (err) {
    failBlock({
      id: 'verification-matrix-gate',
      title: `verification-matrix gate could not run: ${err.message}`,
      fix: 'repair specs/test_artefacts/verification-matrix.json, then retry the commit.',
      minTier: 'minimal',
    });
  }
  if (verdict.rows_checked === 0) {
    noteSkip('verification-matrix', `no matrix rows in scope for group ${group}`);
    return;
  }
  if (!verdict.pass) {
    const lines = verdict.failures
      .slice(0, 10)
      .map((f) => `  - ${f.code}${f.matrix_id ? ` (${f.matrix_id})` : ''}${f.layer ? ` [${f.layer}]` : ''}`);
    const more = verdict.failures.length > 10 ? `  … ${verdict.failures.length - 10} more\n` : '';
    failBlock({
      id: 'verification-matrix-gate',
      title: `verification matrix (executed phase) not satisfied for group ${group} — ${verdict.failures.length} failure(s)`,
      detail: `${lines.join('\n')}\n${more}`,
      fix: 'run /evaluate to (re)generate runtime evidence and update the matrix, then retry the commit. Check: node .claude/scripts/verification-matrix-gate.js --phase executed --group "' + group + '"',
      minTier: 'minimal',
    });
  }
}

function checkSprintContract(ctx) {
  const { projectDir } = ctx;
  let progress;
  try {
    progress = fs.readFileSync(path.join(projectDir, 'claude-progress.txt'), 'utf8');
  } catch (_) {
    return;
  }
  const groupMatch = progress.match(/^current_group:\s*(.+)$/m);
  if (!groupMatch || !groupMatch[1].trim()) return;
  const group = groupMatch[1].trim();
  if (!fs.existsSync(path.join(projectDir, 'sprint-contracts', `${group}.json`))) return;

  validateContractShape(projectDir, group);

  let report = '';
  try {
    report = fs.readFileSync(path.join(projectDir, 'specs', 'reviews', 'evaluator-report.md'), 'utf8');
  } catch (_) {
    /* missing report = not PASS */
  }
  if (!/^VERDICT:\s*PASS\s*$/m.test(report)) {
    failBlock({
      id: 'sprint-contract',
      title: `Sprint contract for group ${group} not satisfied. Run /evaluate first.`,
      fix: 'Run /evaluate to verify the sprint contract, then retry the commit.',
      minTier: 'minimal',
    });
  }
  checkSecurityVerdict(projectDir, group);
  checkVerificationMatrix(projectDir, group);
}

function checkTypescript(ctx) {
  const { projectDir, stagedTs } = ctx;
  if (stagedTs.length === 0) return;
  if (!fs.existsSync(path.join(projectDir, 'tsconfig.json'))) return;
  const res = run(['npx', '--no-install', 'tsc', '--noEmit'], projectDir, 120000);
  if (shouldBlock(res)) {
    failBlock({
      id: 'type-check',
      title: 'type errors in the project',
      detail: `${output(res)}\n`,
      fix: 'resolve the type errors above before committing.',
      minTier: 'minimal',
    });
  } else if (skipped(res)) {
    noteSkip('TypeScript typecheck (tsc --noEmit)', 'tsc unavailable or unprovisioned');
  }
}

function readBaseline(projectDir, key) {
  const file = key === 'js'
    ? path.join(projectDir, '.claude', 'state', 'coverage-baseline-js.txt')
    : path.join(projectDir, '.claude', 'state', 'coverage-baseline.txt');
  try {
    const n = parseFloat(fs.readFileSync(file, 'utf8').trim());
    return Number.isFinite(n) ? n : null;
  } catch (_) {
    return null;
  }
}

function writeBaseline(projectDir, key, pct) {
  const file = key === 'js'
    ? path.join(projectDir, '.claude', 'state', 'coverage-baseline-js.txt')
    : path.join(projectDir, '.claude', 'state', 'coverage-baseline.txt');
  try {
    fs.writeFileSync(file, `${pct}\n`);
  } catch (_) {
    /* best effort */
  }
}

function checkCoverage(ctx) {
  const { projectDir, stagedPy } = ctx;
  if ((process.env.HARNESS_COVERAGE_GATE || '').toLowerCase() === 'off') return;
  if (stagedPy.length === 0) return;
  if (!fs.existsSync(path.join(projectDir, 'src')) || !fs.existsSync(path.join(projectDir, 'tests'))) return;

  const res = run(['uv', 'run', 'pytest', '--cov=src', '--cov-report=term-missing', '-q'], projectDir, 110000);
  if (skipped(res)) { noteSkip('Python coverage ratchet', 'pytest/uv unavailable, timed out, or unprovisioned'); return; }
  const out = output(res);
  const match = out.match(/^TOTAL\s+.*?(\d+(?:\.\d+)?)%/m);
  if (!match) { noteSkip('Python coverage ratchet', 'could not parse pytest --cov output'); return; }
  const pct = parseFloat(match[1]);

  const baseline = readBaseline(projectDir, 'py');
  const required = baseline !== null ? baseline : FLOOR;
  if (pct < required) {
    const label = baseline !== null ? `baseline ${baseline}%` : `floor ${FLOOR}%`;
    failBlock({
      id: 'coverage-ratchet-py',
      title: `coverage ${pct}% is below the ${label}`,
      fix: 'add tests to restore coverage before committing. The ratchet only moves forward.',
      envOff: 'HARNESS_COVERAGE_GATE',
      minTier: 'standard',
    });
  }
  if (baseline === null || pct > baseline) {
    writeBaseline(projectDir, 'py', pct);
  }
}

const VITEST_TOTAL_RE = /^All files\s*\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|\s*([\d.]+)/m;
const JEST_TOTAL_RE = /^All files\s*\|\s*([\d.]+)/m;
const JS_TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const JS_TEST_DIR_RE = /(^|\/)__tests__\/|(^|\/)tests?\//;

function detectJsRunner(projectDir) {
  const VITEST_CONFIGS = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs'];
  const JEST_CONFIGS = ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs'];
  for (const f of VITEST_CONFIGS) {
    if (fs.existsSync(path.join(projectDir, f))) return 'vitest';
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    if (pkg.vitest || (pkg.scripts && JSON.stringify(pkg.scripts).includes('vitest'))) return 'vitest';
  } catch (_) { /* ignore */ }
  for (const f of JEST_CONFIGS) {
    if (fs.existsSync(path.join(projectDir, f))) return 'jest';
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    if (pkg.jest || (pkg.scripts && JSON.stringify(pkg.scripts).includes('jest'))) return 'jest';
  } catch (_) { /* ignore */ }
  return null;
}

function checkCoverageJs(ctx) {
  const { projectDir, stagedJs } = ctx;
  if ((process.env.HARNESS_COVERAGE_GATE || '').toLowerCase() === 'off') return;
  const prodJs = stagedJs.filter((f) => !JS_TEST_RE.test(f) && !JS_TEST_DIR_RE.test(f));
  if (prodJs.length === 0) return;

  const runner = detectJsRunner(projectDir);
  if (!runner) return;

  let res;
  if (runner === 'vitest') {
    res = run(['npx', '--no-install', 'vitest', 'run', '--coverage'], projectDir, 110000);
  } else {
    res = run(['npx', '--no-install', 'jest', '--coverage', '--passWithNoTests', '--silent'], projectDir, 110000);
  }
  if (skipped(res)) { noteSkip(`JS/TS coverage ratchet (${runner})`, 'runner unavailable, timed out, or unprovisioned'); return; }
  const out = output(res);

  const re = runner === 'vitest' ? VITEST_TOTAL_RE : JEST_TOTAL_RE;
  const match = out.match(re);
  if (!match) { noteSkip(`JS/TS coverage ratchet (${runner})`, 'could not parse coverage table'); return; }

  const pct = parseFloat(match[1]);
  const baseline = readBaseline(projectDir, 'js');
  const required = baseline !== null ? baseline : FLOOR;
  if (pct < required) {
    const label = baseline !== null ? `baseline ${baseline}%` : `floor ${FLOOR}%`;
    failBlock({
      id: 'coverage-ratchet-js',
      title: `JS/TS coverage ${pct}% is below the ${label}`,
      fix: 'add tests to restore coverage before committing. The ratchet only moves forward.',
      envOff: 'HARNESS_COVERAGE_GATE',
      minTier: 'standard',
    });
  }
  if (baseline === null || pct > baseline) {
    writeBaseline(projectDir, 'js', pct);
  }
}

function checkMutation(ctx) {
  const { projectDir, stagedSource } = ctx;
  if ((process.env.HARNESS_MUTATION_GATE || '').toLowerCase() === 'off') return;
  if (!inAutoBuild(projectDir)) return;
  const { results, blocked } = runMutationOnFiles(stagedSource, projectDir, {});
  for (const r of results) {
    if (r.skipped) noteSkip(`Mutation-smoke (${r.lang})`, r.reason);
  }
  if (blocked.length === 0) return;
  const detail = blocked.map((r) => renderSurvivors(r.survived)).filter(Boolean).join('\n');
  failBlock({
    id: 'mutation-smoke',
    title: 'mutation-smoke found tests that pass but don\'t bite (survivors)',
    detail: `${detail}\n`,
    fix: 'add an assertion that fails when the flipped operator above is applied — test the boundary (off-by-one) or the false branch — then re-commit.',
    envOff: 'HARNESS_MUTATION_GATE',
    minTier: 'standard',
  });
}

module.exports = {
  checkSprintContract,
  checkTypescript,
  checkCoverage,
  checkCoverageJs,
  checkMutation,
};
