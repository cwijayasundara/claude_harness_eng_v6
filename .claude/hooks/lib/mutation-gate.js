'use strict';

// Pure logic for the mutation-smoke ratchet gate (gap G7). Coverage proves a
// line ran; mutation proves a test would FAIL if that line broke — so "tests
// pass" finally implies "tests bite". This module decides WHICH changed files to
// mutate, WHICH test command to run, and how to interpret the mutation-smoke
// report. The actual mutation run (spawning mutation-smoke.js) lives in
// scripts/mutation-gate.js; everything testable lives here.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, skipped } = require('./toolchain');

// The existing single-mutant runner lives in scripts/; the gate drives it.
const SMOKE = path.join(__dirname, '..', '..', 'scripts', 'mutation-smoke.js');
const DEFAULTS = { threshold: 0.8, maxMutants: 12, timeoutMs: 30000 };

const MUTATABLE_EXTS = new Set(['.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$|_test\.py$|(^|\/)test_[^/]*\.py$/;
const TEST_DIR_RE = /(^|\/)(__tests__|tests?)\//;
const SKIP_DIR_RE = /(^|\/)(node_modules|dist|build|\.next|\.venv|venv|migrations|fixtures)\//;

// Only production source in a mutatable language — never tests (mutating a test
// is meaningless) and never generated/vendored trees.
function isMutatable(file) {
  const f = String(file).replace(/\\/g, '/');
  if (!MUTATABLE_EXTS.has(path.extname(f).toLowerCase())) return false;
  if (TEST_RE.test(f) || TEST_DIR_RE.test(f)) return false;
  return !SKIP_DIR_RE.test(f);
}

function mutatableFiles(files) {
  return (files || []).filter(isMutatable);
}

function langOf(file) {
  return path.extname(String(file)).toLowerCase() === '.py' ? 'python' : 'js';
}

function groupByLang(files) {
  const groups = { python: [], js: [] };
  for (const f of files) groups[langOf(f)].push(f);
  return groups;
}

function pyTestCommand(projectDir) {
  const has = (f) => fs.existsSync(path.join(projectDir, f));
  if (has('pyproject.toml') || has('tests')) return 'uv run pytest -q -x';
  return null;
}

function jsTestCommand(projectDir) {
  const has = (f) => fs.existsSync(path.join(projectDir, f));
  if (['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs'].some(has)) return 'npx --no-install vitest run';
  if (['jest.config.js', 'jest.config.ts', 'jest.config.cjs', 'jest.config.mjs'].some(has)) return 'npx --no-install jest --silent';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    if (pkg.scripts && pkg.scripts.test) return 'npm test --silent';
  } catch (_) { /* no package.json */ }
  return null;
}

function pickTestCommand(lang, projectDir) {
  return lang === 'python' ? pyTestCommand(projectDir) : jsTestCommand(projectDir);
}

// Turn a mutation-smoke report into a gate decision. tested===0 (no mutation
// sites in the changed code) is a pass, not a failure — there is nothing to bite.
function interpretResult(json) {
  if (!json || json.dry_run) return { decided: false };
  return {
    decided: true,
    pass: json.pass !== false,
    score: json.score,
    tested: json.tested || 0,
    survived: json.survived || [],
  };
}

// LLM-legible: name the exact site and the flip no test caught, so the agent
// knows which assertion to add (not just "mutation failed").
function renderSurvivors(survived) {
  if (!survived || !survived.length) return '';
  return survived
    .map((s) => `  ${s.file}:${s.line} — \`${s.operator}\` survived (no test failed when this flipped)`)
    .join('\n');
}

// --- orchestration (spawns the mutation-smoke runner; lives here, not in the
// CLI, so the pre-commit hook can import it from a copied lib in test fixtures) ---

function buildArgv(files, cmd, projectDir, out, o) {
  const argv = ['node', SMOKE];
  files.forEach((f) => argv.push('--files', f));
  argv.push('--test-cmd', cmd, '--cwd', projectDir, '--threshold', String(o.threshold),
    '--max-mutants', String(o.maxMutants), '--timeout-ms', String(o.timeoutMs), '--out', out);
  return argv;
}

function runOneLang(lang, files, projectDir, o) {
  const cmd = pickTestCommand(lang, projectDir);
  if (!cmd) return { lang, skipped: true, reason: `no ${lang} test command discoverable` };
  const out = path.join(os.tmpdir(), `mutation-${lang}-${process.pid}.json`);
  const res = run(buildArgv(files, cmd, projectDir, out, o), projectDir, o.timeoutMs * (o.maxMutants + 2));
  try {
    return { lang, ...interpretResult(JSON.parse(fs.readFileSync(out, 'utf8'))) };
  } catch (_) {
    return { lang, skipped: true, reason: skipped(res) ? 'test command unavailable' : 'no parseable mutation report' };
  } finally {
    try { fs.unlinkSync(out); } catch (_) { /* best effort */ }
  }
}

// Diff-scoped: mutate only the changed production files, per language.
function runMutationOnFiles(files, projectDir, opts) {
  const o = { ...DEFAULTS, ...(opts || {}) };
  const groups = groupByLang(mutatableFiles(files));
  const results = [];
  for (const lang of ['python', 'js']) {
    if (groups[lang].length) results.push(runOneLang(lang, groups[lang], projectDir, o));
  }
  return { results, blocked: results.filter((r) => r.decided && r.pass === false) };
}

module.exports = {
  isMutatable, mutatableFiles, langOf, groupByLang,
  pyTestCommand, jsTestCommand, pickTestCommand,
  interpretResult, renderSurvivors, runMutationOnFiles,
};
