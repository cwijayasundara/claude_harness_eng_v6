#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const WARN_LINES = 25;
const HARD_LIMIT = 30;

// Get leading whitespace length (spaces; tabs count as 1)
function indentLen(line) {
  let count = 0;
  for (const ch of line) {
    if (ch === ' ' || ch === '\t') count++;
    else break;
  }
  return count;
}

function classify(length) {
  if (length > HARD_LIMIT) return 'block';
  if (length > WARN_LINES) return 'warn';
  return null;
}

const PY_FUNC_RE = /^(\s*)(async\s+)?def\s+(\w+)\s*\(/;
const NAMED_FUNC_RE = /\bfunction\s+(\w+)\s*[(<]/;
// Arrow functions MUST contain `=>`, otherwise `const x = (a && b)` (a plain
// parenthesised expression) is misread as a function. We track a function only
// once its body brace actually opens (surroundDepth model), so expression-bodied
// arrows and multi-line signatures never over-count.
const ARROW_FUNC_RE = /\bconst\s+(\w+)\s*=\s*(async\s*)?(\([^)]*\)|\w+)\s*=>/;

function makeEmitter(findings, filePath) {
  return (fn, length) => {
    const level = classify(length);
    if (level) findings.push({ level, name: fn.name, filePath, startLine: fn.startLine, length });
  };
}

function netBraces(line) {
  let net = 0;
  for (const ch of line) {
    if (ch === '{') net++;
    else if (ch === '}') net--;
  }
  return net;
}

// Pop Python scopes whose indent is >= untilIndent (use 0 to drain all at EOF).
function flushPython(funcStack, untilIndent, curLine, emit) {
  while (funcStack.length > 0 && funcStack[funcStack.length - 1].indent >= untilIndent) {
    const fn = funcStack.pop();
    emit(fn, curLine - fn.startLine);
  }
}

function checkPython(lines, filePath) {
  const findings = [];
  const emit = makeEmitter(findings, filePath);
  const funcStack = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(PY_FUNC_RE);
    if (match) {
      const indent = indentLen(lines[i]);
      flushPython(funcStack, indent, i, emit);
      funcStack.push({ name: match[3], startLine: i, indent });
    }
  }
  flushPython(funcStack, 0, lines.length, emit);
  return findings;
}

function checkBraceLang(lines, filePath) {
  const findings = [];
  const emit = makeEmitter(findings, filePath);
  const funcStack = [];
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const named = line.match(NAMED_FUNC_RE);
    const arrow = line.match(ARROW_FUNC_RE);
    const name = (named && named[1]) || (arrow && arrow[1]) || null;
    if (name) funcStack.push({ name, startLine: i, surroundDepth: depth, opened: false });
    depth += netBraces(line);
    for (const fn of funcStack) {
      if (!fn.opened && depth > fn.surroundDepth) fn.opened = true; // body brace opened
    }
    while (funcStack.length > 0) {
      const top = funcStack[funcStack.length - 1];
      if (top.opened && depth <= top.surroundDepth) {
        funcStack.pop();
        emit(top, i - top.startLine + 1);
      } else break;
    }
  }
  // EOF: count only functions that actually opened a brace body.
  while (funcStack.length > 0) {
    const fn = funcStack.pop();
    if (fn.opened) emit(fn, lines.length - fn.startLine);
  }
  return findings;
}

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const filePath = (input.tool_input && input.tool_input.file_path) || '';

  if (!filePath) {
    process.exit(0);
  }

  const ext = path.extname(filePath).toLowerCase();
  const isPython = ext === '.py';
  const isBraceLang = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);

  if (!isPython && !isBraceLang) {
    process.exit(0);
  }

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    process.exit(0);
  }

  const lines = content.split('\n');
  const findings = isPython ? checkPython(lines, filePath) : checkBraceLang(lines, filePath);

  let hasBlock = false;
  for (const f of findings) {
    const label = f.level === 'block' ? 'BLOCKED' : 'WARNING';
    const limit = f.level === 'block' ? HARD_LIMIT : WARN_LINES;
    process.stdout.write(
      `${label}: Function ${f.name} in ${f.filePath}:${f.startLine + 1} is ${f.length} lines (limit ${limit}).\nFix: Decompose into named sub-functions. Each should be testable in isolation.\n`
    );
    if (f.level === 'block') hasBlock = true;
  }

  if (hasBlock) process.exit(2);
} catch (_) {
  // Silent exit — stderr output triggers "hook error" in Claude Code
}

process.exit(0);
