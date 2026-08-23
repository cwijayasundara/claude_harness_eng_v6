'use strict';

// Typecheck and coverage pre-commit gates (kernel).
// The sprint-contract gate moved to gates-planning.js and mutation-smoke to
// gates-verification.js — both belong to packs, and the kernel must not require them.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { run, output, shouldBlock, skipped } = require('./toolchain');
const { failBlock, noteSkip, inAutoBuild, FLOOR, requireScript, GIT_MAX_BUFFER } = require('./pre-commit-util');
const { fileLimitFor, newlyOverFileLimit } = require('./length');

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

// Commit-time half of `length-caps`.
//
// pre-write-gate enforces the same ratchet before a Write/Edit reaches disk,
// but that is a PreToolUse hook: anything written by another route — a Bash
// heredoc, `python3 - <<PY`, an editor, a patch — never passes it. Six files
// crossed their cap on this branch by exactly that route, so the pre-disk cap
// was a cap on one tool rather than on the repository. Commit is the choke
// point every route shares.
//
// Ratchet, not a cap: `newlyOverFileLimit` grandfathers a file that was already
// over and only blocks one that newly crosses or grows while over. Pre-existing
// debt stays committable; new debt does not.
function checkLengthCaps(ctx) {
  const { projectDir, stagedSource } = ctx;
  if (!stagedSource || stagedSource.length === 0) return;
  // stdio 'pipe' on stderr too: on the very first commit there is no HEAD, and
  // git's "invalid object name" would otherwise print over the gate's output.
  const lines = (ref) => {
    try {
      return execFileSync('git', ['show', ref], {
        cwd: projectDir, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER, stdio: ['ignore', 'pipe', 'ignore'],
      }).split('\n').length;
    } catch (_) { return null; }
  };

  const offenders = [];
  for (const rel of stagedSource) {
    const after = lines(`:${rel}`);
    if (after === null) continue; // deleted, unreadable, or not in the index
    const before = lines(`HEAD:${rel}`) || 0; // a new file has no HEAD side
    const limit = fileLimitFor(rel);
    if (newlyOverFileLimit(before, after, limit)) offenders.push({ rel, before, after, limit });
  }
  if (offenders.length === 0) return;

  failBlock({
    id: 'length-caps',
    title: `${offenders.length} staged file(s) newly over the length cap`,
    detail: `${offenders
      .map((o) => `  ${o.rel}: ${o.before || 'new'} -> ${o.after} lines (cap ${o.limit})`)
      .join('\n')}\n`,
    fix: 'split the file along a real seam before committing. This is the same cap '
      + 'pre-write-gate applies; reaching disk by another route does not exempt it.',
    minTier: 'minimal',
  });
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

module.exports = {
  checkLengthCaps,
  checkTypescript,
  checkCoverage,
  checkCoverageJs,
};
