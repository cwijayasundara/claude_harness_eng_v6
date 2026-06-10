'use strict';

const fs = require('fs');
const path = require('path');

const SRC_EXTS = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'migrations', 'node_modules', 'dist', 'build', '.next',
  '.venv', 'venv', '.claude', '__pycache__', 'fixtures', 'coverage',
]);
const EXEMPT_BASENAMES = new Set(['__init__.py', '__main__.py', 'conftest.py', 'setup.py']);

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

// The src/->tests/ project-root mirror.
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

// null = allowed; otherwise the list of candidate test paths that were missing.
function missingTest(projectDir, filePath) {
  const n = filePath.replace(/\\/g, '/');
  const ext = path.extname(n).toLowerCase();
  if (!SRC_EXTS.has(ext)) return null;
  if (n.split('/').some((p) => SKIP_DIRS.has(p))) return null;
  if (isTestFile(n)) return null; // writing tests is encouraged
  if (isExempt(n)) return null;
  const candidates = candidateTests(projectDir, n);
  if (candidates.some((p) => fs.existsSync(p))) return null;
  return candidates;
}

module.exports = { missingTest, isTestFile };
