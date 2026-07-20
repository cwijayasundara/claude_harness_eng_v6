'use strict';

const fs = require('fs');
const path = require('path');
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
  'canceled due to missing packages',
];

// Run a command with an explicit argv array — NEVER a shell string. File paths
// from tool input reach this function untrusted; routing them through `sh -c`
// would be a command-injection sink (a path like `x$(touch pwned).py` would
// execute). spawnSync with argv passes them as literal arguments instead.
function run(argv, cwd, timeout) {
  return spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', cwd, timeout });
}

// Resolve a project-local tool binary (e.g. node_modules/.bin/eslint,
// .venv/bin/ruff) to an argv, or null when it is not present. Invoking it
// directly skips the per-call resolver overhead of the `npx`/`uv run` wrappers
// — the single largest cost on the per-save verify hot path — while resolving
// the SAME binary the wrapper would (same version), so linting is unchanged.
function localBinArgv(cwd, subdir, bin, args) {
  // POSIX only: the extensionless node_modules/.bin & .venv/bin shims are not
  // directly spawnable on Windows (needs .cmd), so there we keep the wrapper.
  if (process.platform === 'win32') return null;
  const p = path.join(cwd, subdir, bin);
  return fs.existsSync(p) ? [p, ...args] : null;
}

// Run `direct` when it resolved to a local binary, else fall back to the wrapper
// argv. The fallback preserves the exact unprovisioned behavior (its
// tool/env-missing output is what shouldBlock/skipped key on), so a project
// without the local binary behaves precisely as before — just without the speedup.
// A present-but-unspawnable local binary (e.g. a relocated venv whose shebang
// points at a moved interpreter → ENOENT, or a 127 exec failure) must NOT
// silently skip the check the way shouldBlock() treats a spawn error — retry the
// wrapper, which self-heals (re-resolves / recreates the environment).
function runLocalFirst(direct, fallback, cwd, timeout) {
  if (!direct) return run(fallback, cwd, timeout);
  const res = run(direct, cwd, timeout);
  if (res && (res.error || res.status === 127)) return run(fallback, cwd, timeout);
  return res;
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

// True when a gate that was attempted neither passed nor blocked — it failed
// open (tool missing, spawn failed, killed/timed out, or unprovisioned). The
// caller surfaces this loudly so a silently-ungated file is never mistaken for a
// clean pass. A clean pass (status 0) is NOT skipped.
function skipped(result) {
  if (!result || result.error) return true; // spawn failed
  if (result.status === null || result.status === 127) return true; // killed / not found
  if (result.status === 0) return false; // clean pass
  return unavailable(output(result)); // ran, non-zero, but tool/env missing
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

module.exports = {
  run, output, shouldBlock, skipped, unavailable, detectCwd,
  localBinArgv, runLocalFirst,
};
