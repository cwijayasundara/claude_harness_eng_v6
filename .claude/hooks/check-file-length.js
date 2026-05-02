#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const WARN_LIMIT = 200;
const HARD_LIMIT = 300;

const TRACKED_EXTS = new Set([
  '.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.go', '.rs', '.java', '.kt', '.rb',
]);

// Auto-generated / vendored paths only — tests and config are NOT exempt from SRP
const SKIP_DIRS = new Set(['migrations', 'node_modules', 'dist', 'build', '.next']);

function shouldSkip(filePath) {
  const normalized = filePath.replace(/\\/g, '/');

  // Skip .d.ts files
  if (normalized.endsWith('.d.ts')) {
    return true;
  }

  const parts = normalized.split('/');
  for (const part of parts) {
    if (SKIP_DIRS.has(part)) {
      return true;
    }
  }

  return false;
}

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const filePath = (input.tool_input && input.tool_input.file_path) || '';

  if (!filePath) {
    process.exit(0);
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!TRACKED_EXTS.has(ext)) {
    process.exit(0);
  }

  if (shouldSkip(filePath)) {
    process.exit(0);
  }

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    process.exit(0);
  }

  // Count lines (split by newline; trailing newline doesn't add an extra line)
  const lines = content.split('\n');
  const lineCount = content.endsWith('\n') ? lines.length - 1 : lines.length;

  if (lineCount >= HARD_LIMIT) {
    process.stdout.write(`BLOCKED: ${filePath} is ${lineCount} lines (hard limit ${HARD_LIMIT}).\nFix: Split by responsibility into separate modules. Re-export from an index file if needed.\n`);
    process.exit(2);
  }

  if (lineCount > WARN_LIMIT) {
    process.stdout.write(`WARNING: ${filePath} is ${lineCount} lines (recommended max ${WARN_LIMIT}).\nFix: Split by responsibility into separate modules. Re-export from an index file if needed.\n`);
  }
} catch (_) {
  // Silent exit — stderr output triggers "hook error" in Claude Code
}

process.exit(0);
