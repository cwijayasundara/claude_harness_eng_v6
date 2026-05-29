#!/usr/bin/env node

'use strict';

// PreToolUse(Write|Edit|MultiEdit) — TDD test-first gate.
// Blocks writing a source file under src/ when no corresponding test file
// exists. Enforces test *existence* (not red-green ordering — a hook cannot
// cheaply prove a test was failing first). Writing the test itself is allowed.
// Escape hatch for legacy/brownfield work: set HARNESS_TDD_GATE=off.

const fs = require('fs');
const path = require('path');

const SRC_EXTS = new Set(['.py', '.ts', '.tsx', '.js', '.jsx']);
const SKIP_DIRS = new Set(['migrations', 'node_modules', 'dist', 'build', '.next', '.venv', 'venv', '.claude']);

function findProjectDir(startDir) {
  let cur = startDir;
  while (true) {
    if (fs.existsSync(path.join(cur, '.claude'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function isTestFile(normalized) {
  return (
    /(^|\/)tests?\//.test(normalized) ||
    /(^|\/)__tests__\//.test(normalized) ||
    /test_\w+\.py$/.test(normalized) ||
    /\.(test|spec)\.(t|j)sx?$/.test(normalized)
  );
}

// Map a src file to its conventional test path (mirrors teammate-idle-check.js).
function getTestPath(projectDir, normalized) {
  const srcIdx = normalized.indexOf('src/');
  if (srcIdx === -1) return null;
  const afterSrc = normalized.slice(srcIdx + 4);
  const dir = path.dirname(afterSrc);
  if (normalized.endsWith('.py')) {
    const base = path.basename(afterSrc, '.py');
    const rel = dir === '.' ? `tests/test_${base}.py` : `tests/${dir}/test_${base}.py`;
    return path.join(projectDir, rel);
  }
  const ext = path.extname(afterSrc);
  const base = path.basename(afterSrc, ext);
  const rel = dir === '.' ? `tests/${base}.test${ext}` : `tests/${dir}/${base}.test${ext}`;
  return path.join(projectDir, rel);
}

try {
  if ((process.env.HARNESS_TDD_GATE || '').toLowerCase() === 'off') process.exit(0);

  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const filePath = (input.tool_input && input.tool_input.file_path) || '';
  if (!filePath) process.exit(0);

  const normalized = filePath.replace(/\\/g, '/');
  const ext = path.extname(normalized).toLowerCase();
  if (!SRC_EXTS.has(ext)) process.exit(0);
  if (normalized.split('/').some((p) => SKIP_DIRS.has(p))) process.exit(0);
  if (isTestFile(normalized)) process.exit(0); // writing tests is encouraged
  if (!/(^|\/)src\//.test(normalized)) process.exit(0); // only gate code under src/

  const scriptDir = path.dirname(path.resolve(__filename));
  const projectDir = findProjectDir(scriptDir) || process.cwd();
  const testPath = getTestPath(projectDir, normalized);
  if (!testPath) process.exit(0);

  if (!fs.existsSync(testPath)) {
    const relTest = path.relative(projectDir, testPath);
    process.stdout.write(
      `BLOCKED: test-first gate — no test found for ${normalized}.\n` +
        `Expected test file: ${relTest}\n` +
        `Fix: Write the failing test FIRST (TDD red), then implement. Create ${relTest} before this source file.\n` +
        `(Enforces test existence. For legacy/brownfield work, set HARNESS_TDD_GATE=off.)\n`
    );
    process.exit(2);
  }
} catch (_) {
  // Silent exit — stderr output triggers "hook error" in Claude Code
}

process.exit(0);
