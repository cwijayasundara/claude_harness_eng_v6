#!/usr/bin/env node

'use strict';

// PreToolUse(Write|Edit|MultiEdit) — TDD test-first gate (deterministic layer).
// Blocks writing ANY source file that has no accompanying test, accepting the
// common conventions: co-located test_/_test/.test/.spec, an adjacent
// __tests__/ or tests/ dir, and the src/->tests/ project mirror. Enforces test
// *existence*, not red-green ordering — pair with tdd-guard for LLM-judged
// ordering. Writing tests is always allowed. Package markers, config, and type
// declarations are exempt. Escape hatch for legacy/brownfield: HARNESS_TDD_GATE=off.

const fs = require('fs');
const path = require('path');

const SRC_EXTS = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'migrations', 'node_modules', 'dist', 'build', '.next',
  '.venv', 'venv', '.claude', '__pycache__', 'fixtures', 'coverage',
]);
const EXEMPT_BASENAMES = new Set(['__init__.py', '__main__.py', 'conftest.py', 'setup.py']);

function findProjectDir(startDir) {
  let cur = startDir;
  while (true) {
    if (fs.existsSync(path.join(cur, '.claude'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function isTestFile(n) {
  return (
    /(^|\/)tests?\//.test(n) ||
    /(^|\/)__tests__\//.test(n) ||
    /test_\w+\.py$/.test(n) ||
    /_test\.py$/.test(n) ||
    /\.(test|spec)\.(t|j)sx?$/.test(n)
  );
}

function isExempt(n) {
  const base = path.basename(n);
  if (/\.d\.ts$/.test(n)) return true;
  if (EXEMPT_BASENAMES.has(base)) return true;
  return /\.config\.(tsx?|jsx?|mjs|cjs)$/.test(base);
}

// The src/->tests/ project-root mirror (mirrors teammate-idle-check.js).
function srcMirrorTest(projectDir, n, base, ext) {
  const srcIdx = n.indexOf('src/');
  if (srcIdx === -1) return null;
  const dir = path.dirname(n.slice(srcIdx + 4));
  if (ext === '.py') {
    const rel = dir === '.' ? `tests/test_${base}.py` : `tests/${dir}/test_${base}.py`;
    return path.join(projectDir, rel);
  }
  const rel = dir === '.' ? `tests/${base}.test${ext}` : `tests/${dir}/${base}.test${ext}`;
  return path.join(projectDir, rel);
}

function candidateTests(projectDir, n) {
  const dir = path.dirname(n);
  const ext = path.extname(n);
  const base = path.basename(n, ext);
  const out = [];
  if (ext === '.py') {
    out.push(path.join(dir, `test_${base}.py`), path.join(dir, `${base}_test.py`));
    out.push(path.join(dir, 'tests', `test_${base}.py`), path.join(dir, '__tests__', `test_${base}.py`));
  } else {
    for (const suf of ['test', 'spec']) {
      out.push(path.join(dir, `${base}.${suf}${ext}`));
      out.push(path.join(dir, '__tests__', `${base}.${suf}${ext}`));
      out.push(path.join(dir, 'tests', `${base}.${suf}${ext}`));
    }
  }
  const mirror = srcMirrorTest(projectDir, n, base, ext);
  if (mirror) out.push(mirror);
  return out;
}

try {
  if ((process.env.HARNESS_TDD_GATE || '').toLowerCase() === 'off') process.exit(0);

  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const filePath = (input.tool_input && input.tool_input.file_path) || '';
  if (!filePath) process.exit(0);

  const n = filePath.replace(/\\/g, '/');
  const ext = path.extname(n).toLowerCase();
  if (!SRC_EXTS.has(ext)) process.exit(0);
  if (n.split('/').some((p) => SKIP_DIRS.has(p))) process.exit(0);
  if (isTestFile(n)) process.exit(0); // writing tests is encouraged
  if (isExempt(n)) process.exit(0); // package markers / config / type decls

  const scriptDir = path.dirname(path.resolve(__filename));
  const projectDir = findProjectDir(scriptDir) || process.cwd();
  const candidates = candidateTests(projectDir, n);
  if (candidates.some((p) => fs.existsSync(p))) process.exit(0);

  const shown = candidates.slice(0, 4).map((p) => '  - ' + path.relative(projectDir, p)).join('\n');
  process.stdout.write(
    `BLOCKED: test-first gate — no test found for ${n}.\n` +
      `Write the failing test FIRST (TDD red), then implement. Looked for e.g.:\n${shown}\n` +
      `(Enforces test existence; pair with tdd-guard for red-green ordering. Bypass for legacy: HARNESS_TDD_GATE=off.)\n`
  );
  process.exit(2);
} catch (_) {
  // Silent exit — stderr output triggers "hook error" in Claude Code
}

process.exit(0);
