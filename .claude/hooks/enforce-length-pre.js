#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const HARD_LIMIT = 300;

const TRACKED_EXTS = new Set([
  '.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.go', '.rs', '.java', '.kt', '.rb',
]);

// Auto-generated / vendored paths we don't police at pre-write
const SKIP_DIRS = new Set(['migrations', 'node_modules', 'dist', 'build', '.next']);

function shouldSkip(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.endsWith('.d.ts')) return true;
  const parts = normalized.split('/');
  return parts.some((p) => SKIP_DIRS.has(p));
}

function countLines(text) {
  if (!text) return 0;
  const lines = text.split('\n');
  return text.endsWith('\n') ? lines.length - 1 : lines.length;
}

function simulateEdit(filePath, oldStr, newStr, replaceAll) {
  let current = '';
  try {
    current = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null; // file doesn't exist yet; Edit will fail on its own
  }
  if (replaceAll) return current.split(oldStr).join(newStr);
  const idx = current.indexOf(oldStr);
  if (idx === -1) return null; // Edit will fail; don't block here
  return current.slice(0, idx) + newStr + current.slice(idx + oldStr.length);
}

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const toolName = input.tool_name || '';
  const ti = input.tool_input || {};
  const filePath = ti.file_path || '';

  if (!filePath) process.exit(0);

  const ext = path.extname(filePath).toLowerCase();
  if (!TRACKED_EXTS.has(ext)) process.exit(0);
  if (shouldSkip(filePath)) process.exit(0);

  let finalContent = null;

  if (toolName === 'Write') {
    finalContent = ti.content || '';
  } else if (toolName === 'Edit') {
    finalContent = simulateEdit(
      filePath,
      ti.old_string || '',
      ti.new_string || '',
      Boolean(ti.replace_all)
    );
  }

  if (finalContent === null) process.exit(0);

  const count = countLines(finalContent);

  if (count > HARD_LIMIT) {
    process.stdout.write(
      `BLOCKED: ${toolName} on ${filePath} would produce ${count} lines (hard limit ${HARD_LIMIT}).\n` +
        `Fix: Split the file into modules by responsibility BEFORE writing. One file, one responsibility (SRP).\n` +
        `Create separate files for each concern and re-export from an index if needed.\n`
    );
    process.exit(2);
  }
} catch (_) {
  // Silent exit — stderr output triggers "hook error" in Claude Code
}

process.exit(0);
