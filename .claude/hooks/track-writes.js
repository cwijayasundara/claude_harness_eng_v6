#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const TRACKED_EXTS = new Set([
  '.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.go', '.rs', '.java', '.kt', '.rb',
]);

const SKIP_DIRS = new Set([
  'test', 'tests', '__tests__', 'spec', '__specs__',
  'migrations', 'fixtures', 'node_modules', 'dist', 'build',
  '.next', '.venv', 'venv', '.claude',
]);

function shouldTrack(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!TRACKED_EXTS.has(ext)) return false;
  const parts = filePath.replace(/\\/g, '/').split('/');
  return !parts.some((p) => SKIP_DIRS.has(p));
}

function findProjectDir(startDir) {
  let cur = startDir;
  while (true) {
    if (fs.existsSync(path.join(cur, '.claude'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const filePath = (input.tool_input && input.tool_input.file_path) || '';
  if (!filePath) process.exit(0);
  if (!shouldTrack(filePath)) process.exit(0);

  const scriptDir = path.dirname(path.resolve(__filename));
  const projectDir = findProjectDir(scriptDir) || process.cwd();

  const stateDir = path.join(projectDir, '.claude', 'state');
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });

  const stateFile = path.join(stateDir, 'pending-reviews.jsonl');
  const record = JSON.stringify({ file: filePath, ts: Date.now() }) + '\n';
  fs.appendFileSync(stateFile, record);

  process.stdout.write(
    `Review pending for ${filePath}.\n` +
      `Before ending this turn, invoke clean-code-reviewer and security-reviewer on the change (run them in parallel in a single message).\n`
  );
} catch (_) {
  // Silent exit — stderr output triggers "hook error" in Claude Code
}

process.exit(0);
