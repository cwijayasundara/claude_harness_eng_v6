'use strict';

// Stub-to-green smell detector (Bun adversarial Phase A).
// Scans production source for high-signal stub markers that clear compile/lint
// without implementing behaviour. Pure content classification — git plumbing
// lives in scripts/stub-smell-gate.js.

const path = require('path');
const { isTestFile } = require('./tdd');

const SRC_EXTS = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rs', '.go']);
const EXEMPT_BASENAMES = new Set(['__init__.py', '__main__.py', 'conftest.py', 'setup.py']);

/** Allow a single line when the story explicitly defers. */
const ALLOW_RE = /harness:stub-ok\b/;

/**
 * High-signal stub patterns. Prefer precision over recall — false positives
 * block commits; false negatives are still caught by code-reviewer Iron Laws.
 */
const PATTERNS = Object.freeze([
  { id: 'todo-macro', re: /\btodo!\s*\(/, message: 'todo!() macro — stub, not implementation' },
  { id: 'unimplemented-macro', re: /\bunimplemented!\s*\(/, message: 'unimplemented!() macro — stub, not implementation' },
  { id: 'not-implemented-error', re: /\bNotImplementedError\b|\bthrow new Error\(\s*['"]not implemented/i, message: 'NotImplementedError / "not implemented" throw in production path' },
  { id: 'python-ellipsis-body', re: /^\s*\.\.\.\s*(#.*)?$/, message: 'Python ellipsis body (...) as sole statement — often a stub' },
  { id: 'pass-only-body', re: /^\s*pass\s*(#.*)?$/, message: 'bare pass as function body — often a stub' },
  { id: 'js-not-implemented', re: /\bthrow new (?:Error|TypeError)\(\s*['"`]TODO/i, message: 'throw new Error("TODO…") — stub, not implementation' },
  { id: 'fixme-not-implemented', re: /\bFIXME:\s*not\s+implemented\b/i, message: 'FIXME: not implemented marker in production path' },
]);

function isExemptPath(n) {
  const base = path.basename(n);
  if (/\.d\.ts$/.test(n)) return true;
  if (EXEMPT_BASENAMES.has(base)) return true;
  return /\.config\.(tsx?|jsx?|mjs|cjs)$/.test(base);
}

function isProductionSource(relPath) {
  if (!relPath || typeof relPath !== 'string') return false;
  const n = relPath.replace(/\\/g, '/');
  if (isTestFile(n) || isExemptPath(n)) return false;
  if (n.includes('node_modules/') || n.includes('.claude/') || n.includes('fixtures/')) return false;
  if (n.startsWith('test/') || n.startsWith('tests/') || n.startsWith('docs/') || n.startsWith('specs/')) return false;
  const ext = path.extname(n);
  return SRC_EXTS.has(ext);
}

/**
 * Scan file content for stub smells.
 * @param {string} file relative path
 * @param {string} content file body
 * @returns {{ file: string, line: number, id: string, message: string }[]}
 */
function classifyStubSmells(file, content) {
  if (!isProductionSource(file) || content == null) return [];
  const lines = String(content).split(/\r?\n/);
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ALLOW_RE.test(line)) continue;
    // Skip pure comment lines for pass/ellipsis (common in prose) — but still
    // catch todo!/unimplemented! even in comments? No — only code-ish lines.
    for (const p of PATTERNS) {
      if (p.id === 'pass-only-body' || p.id === 'python-ellipsis-body') {
        // Only flag when the previous non-empty line looks like a def/function opener
        // or the line is the sole body after a def on the previous lines.
        if (!p.re.test(line)) continue;
        const prev = previousCodeLine(lines, i);
        if (!prev || !/^\s*(def |async def |function |async function |\w+\s*\([^)]*\)\s*\{?\s*$|=>\s*\{?\s*$)/.test(prev) &&
            !/:\s*$/.test(prev)) {
          // still flag bare `pass` / `...` that sit alone after a colon (python)
          if (!/:\s*$/.test(prev || '')) continue;
        }
        findings.push({ file, line: i + 1, id: p.id, message: p.message });
        break;
      }
      if (p.re.test(line)) {
        // Ignore markers inside block comments that are clearly docs
        if (/^\s*(\/\/|#|\*|\/\*)/.test(line) && (p.id === 'fixme-not-implemented')) {
          findings.push({ file, line: i + 1, id: p.id, message: p.message });
          break;
        }
        if (/^\s*(\/\/|#)/.test(line) && !/todo!|unimplemented!/.test(line)) {
          continue;
        }
        findings.push({ file, line: i + 1, id: p.id, message: p.message });
        break;
      }
    }
  }
  return findings;
}

function previousCodeLine(lines, idx) {
  for (let j = idx - 1; j >= 0; j--) {
    const t = lines[j].trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) continue;
    return lines[j];
  }
  return null;
}

/**
 * @param {{ file: string, content: string }[]} files
 */
function classifyStubFiles(files) {
  const out = [];
  for (const f of files || []) {
    out.push(...classifyStubSmells(f.file, f.content));
  }
  return out;
}

function findingLine(f) {
  return `  STUB SMELL  ${f.file}:${f.line}  [${f.id}] ${f.message}`;
}

module.exports = {
  isProductionSource,
  classifyStubSmells,
  classifyStubFiles,
  findingLine,
  PATTERNS,
  ALLOW_RE,
};
