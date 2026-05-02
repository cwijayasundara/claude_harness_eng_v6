#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
      if (result.status !== 0 && result.stdout) {
        process.stdout.write(result.stdout);
      }
    }
  } else if (isTypeScript) {
    const useLinter = linter ? linter === 'eslint' : true; // fallback: use eslint
    if (useLinter) {
      const result = spawnSync('sh', ['-c', `npx eslint --fix "${filePath}"`], {
        encoding: 'utf8',
        cwd: detectCwd(filePath),
      });
      if (result.status !== 0 && result.stdout) {
        process.stdout.write(result.stdout);
      }
    }
  }
} catch (_) {
  // Silent exit — stderr output triggers "hook error" in Claude Code
}

process.exit(0);
