'use strict';

const { spawnSync } = require('child_process');

// Block only on a genuine tool failure, never because the tool or environment
// is missing/unprovisioned — otherwise every edit blocks before deps install.
// Exit code alone is insufficient: `uv run ruff` exits 1 when ruff itself is
// absent, indistinguishable from "errors found", so we also scan the output
// for tool/environment-missing signatures.
const MISSING_SIGNATURES = [
  'failed to spawn',
  'no such file or directory',
  'command not found',
  'not found',
  'not recognized',
  'no module named',
  'no virtual environment',
  'no `pyproject',
  'cannot find module',
  'could not find a declaration',
  'could not determine executable',
  'no tests ran',
];

function run(command, cwd, timeout) {
  return spawnSync('sh', ['-c', command], { encoding: 'utf8', cwd, timeout });
}

function output(result) {
  return ((result && result.stdout) || '') + ((result && result.stderr) || '');
}

function unavailable(text) {
  const s = (text || '').toLowerCase();
  return MISSING_SIGNATURES.some((sig) => s.includes(sig));
}

function shouldBlock(result) {
  if (!result || result.error) return false; // spawn failed (e.g. sh missing)
  if (result.status === null || result.status === 127) return false; // killed / not found
  if (result.status === 0) return false; // clean
  if (unavailable(output(result))) return false; // unprovisioned
  return true;
}

// Detect subdirectory (frontend/, backend/) to set correct cwd for config discovery
function detectCwd(filePath, fallback) {
  const normalized = filePath.replace(/\\/g, '/');
  for (const dir of ['frontend', 'backend']) {
    const idx = normalized.indexOf(`/${dir}/`);
    if (idx !== -1) return normalized.substring(0, idx + dir.length + 1);
  }
  return fallback;
}

module.exports = { run, output, shouldBlock, unavailable, detectCwd };
