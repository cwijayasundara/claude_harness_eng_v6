'use strict';

const fs = require('fs');
const path = require('path');

const TRACKED_EXTS = new Set([
  '.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.go', '.rs', '.java', '.kt', '.rb',
]);

// Auto-generated / vendored paths we don't police
const SKIP_DIRS = new Set(['migrations', 'node_modules', 'dist', 'build', '.next']);

function findProjectDir(startDir) {
  let cur = startDir;
  while (true) {
    if (fs.existsSync(path.join(cur, '.claude'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

// The project being worked on. CLAUDE_PROJECT_DIR (set by Claude Code for hook
// processes) wins: in plugin mode the hook script lives in the harness repo,
// not the project, so walking up from the script location would resolve the
// wrong directory.
function resolveProjectDir(scriptDir) {
  return (
    process.env.CLAUDE_PROJECT_DIR ||
    findProjectDir(process.cwd()) ||
    findProjectDir(scriptDir) ||
    process.cwd()
  );
}

function readHookInput() {
  return JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
}

function isSkippedPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.endsWith('.d.ts')) return true;
  return normalized.split('/').some((p) => SKIP_DIRS.has(p));
}

function countLines(text) {
  if (!text) return 0;
  const lines = text.split('\n');
  return text.endsWith('\n') ? lines.length - 1 : lines.length;
}

// Resolve symlinks via the deepest existing ancestor (the file itself may not
// exist yet). Without this, macOS /var → /private/var mismatches make
// in-project paths look like they are outside the project.
function realResolve(p) {
  let cur = path.resolve(p);
  let suffix = '';
  while (!fs.existsSync(cur)) {
    suffix = suffix ? path.join(path.basename(cur), suffix) : path.basename(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  try {
    cur = fs.realpathSync(cur);
  } catch (_) {
    /* keep the resolved path */
  }
  return suffix ? path.join(cur, suffix) : cur;
}

// A hook crash must never block work, but it must not be invisible either:
// record it so a broken gate is discoverable instead of silently disabled.
function reportFailure(hookName, err) {
  try {
    const projectDir = findProjectDir(path.dirname(__dirname)) || process.cwd();
    const logDir = path.join(projectDir, '.claude', 'state');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, 'hook-errors.log'),
      `${new Date().toISOString()} ${hookName}: ${err && err.message ? err.message : err}\n`
    );
  } catch (_) {
    /* last resort: stay silent rather than brick the session */
  }
}

module.exports = {
  TRACKED_EXTS, SKIP_DIRS, findProjectDir, resolveProjectDir,
  readHookInput, isSkippedPath, countLines, realResolve, reportFailure,
};
