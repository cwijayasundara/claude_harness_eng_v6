#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Block only on a genuine tool failure (type errors), never because the tool
// or environment is missing/unprovisioned — otherwise every edit blocks before
// deps install. Exit code alone is insufficient: `uv run mypy` exits 1 when
// mypy itself is absent, indistinguishable from "type errors found", so we also
// scan the output for tool/environment-missing signatures.
const MISSING_SIGNATURES = [
  'failed to spawn',
  'no such file or directory',
  'command not found',
  'not recognized',
  'no module named',
  'no virtual environment',
  'no `pyproject',
  'cannot find module',
  'could not find a declaration',
  'tsc: not found',
];

function shouldBlock(result) {
  if (!result || result.error) return false; // spawn failed (e.g. sh missing)
  if (result.status === null || result.status === 127) return false; // killed / not found
  if (result.status === 0) return false; // clean
  const out = ((result.stdout || '') + (result.stderr || '')).toLowerCase();
  if (MISSING_SIGNATURES.some((s) => out.includes(s))) return false; // unprovisioned
  return true;
}

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const filePath = (input.tool_input && input.tool_input.file_path) || '';

  if (!filePath) {
    process.exit(0);
  }

  const ext = path.extname(filePath).toLowerCase();
  const isPython = ext === '.py';
  const isTypeScript = ext === '.ts' || ext === '.tsx';

  if (!isPython && !isTypeScript) {
    process.exit(0);
  }

  // Try to read project-manifest.json
  let manifest = null;
  try {
    const manifestPath = path.join(process.cwd(), 'project-manifest.json');
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {
    // No manifest — use defaults
  }

  const typechecker = manifest && manifest.typechecker ? manifest.typechecker : null;

  // Detect subdirectory (frontend/, backend/) to set correct cwd for config discovery
  function detectCwd(fp) {
    const normalized = fp.replace(/\\/g, '/');
    const subdirs = ['frontend', 'backend'];
    for (const dir of subdirs) {
      const marker = `/${dir}/`;
      const idx = normalized.indexOf(marker);
      if (idx !== -1) {
        const candidate = normalized.substring(0, idx + marker.length - 1);
        return candidate;
      }
    }
    return process.cwd();
  }

  const cwd = detectCwd(filePath);

  if (isPython) {
    const useChecker = typechecker ? typechecker === 'mypy' : true; // fallback: use mypy
    if (useChecker) {
      const result = spawnSync('sh', ['-c', `uv run mypy "${filePath}"`], {
        encoding: 'utf8',
        cwd,
      });
      if (shouldBlock(result)) {
        const output = (result.stdout || '') + (result.stderr || '');
        process.stdout.write(`BLOCKED: type errors in ${filePath}:\n${output}\nFix: Add type annotations or fix the type mismatch shown above.\n`);
        process.exit(2);
      }
    }
  } else if (isTypeScript) {
    const useChecker = typechecker ? typechecker === 'tsc' : true; // fallback: use tsc
    if (useChecker) {
      const result = spawnSync('sh', ['-c', `npx tsc --noEmit --pretty "${filePath}"`], {
        encoding: 'utf8',
        cwd,
      });
      if (result.status !== 0) {
        // tsc --noEmit with a file arg may not work on all setups; fall back to project-wide
        const fallback = spawnSync('sh', ['-c', 'npx tsc --noEmit'], {
          encoding: 'utf8',
          cwd,
        });
        if (shouldBlock(fallback)) {
          const output = (fallback.stdout || '') + (fallback.stderr || '');
          // Filter to only show errors related to the edited file
          const lines = output.split('\n');
          const basename = path.basename(filePath);
          const relevant = lines.filter(l => l.includes(basename) || l.startsWith(' '));
          const filtered = relevant.length > 0 ? relevant.join('\n') : output;
          process.stdout.write(`BLOCKED: type errors in ${filePath}:\n${filtered}\nFix: Add type annotations or fix the type mismatch shown above.\n`);
          process.exit(2);
        }
      }
    }
  }
} catch (_) {
  // Silent exit — stderr output triggers "hook error" in Claude Code
}

process.exit(0);
