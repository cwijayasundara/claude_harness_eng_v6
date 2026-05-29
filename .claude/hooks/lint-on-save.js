#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Block only on a genuine tool failure (lint errors), never because the tool
// or environment is missing/unprovisioned — otherwise every edit blocks before
// `uv sync` / `npm ci`. Exit code alone is insufficient: `uv run ruff` exits 1
// when ruff itself is absent, indistinguishable from "lint errors found", so we
// also scan the output for tool/environment-missing signatures.
const MISSING_SIGNATURES = [
  'failed to spawn',
  'no such file or directory',
  'command not found',
  'not recognized',
  'no module named',
  'no virtual environment',
  'no `pyproject',
  'cannot find module',
  'eslint couldn\'t find',
  'eslint could not find',
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
    // No manifest — use fallback defaults
  }

  const linter = manifest && manifest.linter ? manifest.linter : null;

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

  if (isPython) {
    const useLinter = linter ? linter === 'ruff' : true; // fallback: use ruff
    if (useLinter) {
      const result = spawnSync('sh', ['-c', `uv run ruff check --fix "${filePath}" && uv run ruff format "${filePath}"`], {
        encoding: 'utf8',
        cwd: detectCwd(filePath),
      });
      // ruff auto-fixes what it can; a genuine non-zero status means unfixable lint errors remain.
      if (shouldBlock(result)) {
        process.stdout.write(
          `BLOCKED: lint errors remain in ${filePath} after ruff --fix:\n${(result.stdout || '') + (result.stderr || '')}\nFix: resolve the lint errors above.\n`
        );
        process.exit(2);
      }
    }
  } else if (isTypeScript) {
    const useLinter = linter ? linter === 'eslint' : true; // fallback: use eslint
    if (useLinter) {
      const result = spawnSync('sh', ['-c', `npx eslint --fix "${filePath}"`], {
        encoding: 'utf8',
        cwd: detectCwd(filePath),
      });
      if (shouldBlock(result)) {
        process.stdout.write(
          `BLOCKED: lint errors remain in ${filePath} after eslint --fix:\n${(result.stdout || '') + (result.stderr || '')}\nFix: resolve the lint errors above.\n`
        );
        process.exit(2);
      }
    }
  }
} catch (_) {
  // Silent exit — stderr output triggers "hook error" in Claude Code
}

process.exit(0);
