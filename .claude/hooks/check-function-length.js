#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const WARN_LINES = 50;
const HARD_LIMIT = 80;

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

function checkPython(lines, filePath) {
  const findings = [];
  const funcDef = /^(\s*)(async\s+)?def\s+(\w+)\s*\(/;
  const funcStack = []; // { name, startLine, indent }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(funcDef);

    if (match) {
      const indent = indentLen(line);
      const name = match[3];

      while (funcStack.length > 0 && funcStack[funcStack.length - 1].indent >= indent) {
        const ended = funcStack.pop();
        const length = i - ended.startLine;
        const level = classify(length);
        if (level) findings.push({ level, name: ended.name, filePath, startLine: ended.startLine, length });
      }

      funcStack.push({ name, startLine: i, indent });
    }
  }

  const totalLines = lines.length;
  while (funcStack.length > 0) {
    const ended = funcStack.pop();
    const length = totalLines - ended.startLine;
    const level = classify(length);
    if (level) findings.push({ level, name: ended.name, filePath, startLine: ended.startLine, length });
  }

  return findings;
}

function checkBraceLang(lines, filePath) {
  const findings = [];
  const namedFuncRe = /\bfunction\s+(\w+)\s*[(<]/;
  const arrowFuncRe = /\bconst\s+(\w+)\s*=\s*(async\s*)?\(/;

  const funcStack = [];
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const namedMatch = line.match(namedFuncRe);
    const arrowMatch = line.match(arrowFuncRe);
    const funcName = (namedMatch && namedMatch[1]) || (arrowMatch && arrowMatch[1]) || null;

    let openCount = 0;
    let closeCount = 0;
    for (const ch of line) {
      if (ch === '{') openCount++;
      else if (ch === '}') closeCount++;
    }

    if (funcName) {
      funcStack.push({ name: funcName, startLine: i, braceDepth: braceDepth + openCount });
    }

    braceDepth += openCount - closeCount;

    while (funcStack.length > 0) {
      const top = funcStack[funcStack.length - 1];
      if (braceDepth < top.braceDepth) {
        const ended = funcStack.pop();
        const length = i - ended.startLine + 1;
        const level = classify(length);
        if (level) findings.push({ level, name: ended.name, filePath, startLine: ended.startLine, length });
      } else {
        break;
      }
    }
  }

  const totalLines = lines.length;
  while (funcStack.length > 0) {
    const ended = funcStack.pop();
    const length = totalLines - ended.startLine;
    const level = classify(length);
    if (level) findings.push({ level, name: ended.name, filePath, startLine: ended.startLine, length });
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
