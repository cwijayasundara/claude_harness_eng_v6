'use strict';

// Reset a temp project dir and seed it with a PRD. Shared by the live runners.
//
// Confinement guard: this function rm -rf's its target, so it accepts a path
// only under a root that exists to be thrown away — the out-of-repo live-e2e
// workdir (see e2e-workdir.js), or the legacy in-repo `test/e2e/` location that
// older routes still use. The root itself is refused: wiping it would take
// every other route's output with it.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { e2eRoot } = require('./e2e-workdir');

const E2E_ROOT = path.join(__dirname, '..'); // test/e2e/

/** Roots a throwaway project may live under, real-pathed for comparison. */
function allowedRoots() {
  return [e2eRoot(), E2E_ROOT].map(realish);
}

// realpath only resolves an existing path; fall back to the lexical form so a
// not-yet-created target still compares against a resolved root.
function realish(p) {
  try { return fs.realpathSync.native(p); } catch (_) { return path.resolve(p); }
}

function assertDisposable(projectDir) {
  const resolved = realish(path.resolve(projectDir));
  for (const root of allowedRoots()) {
    if (resolved === root) {
      throw new Error(`refusing to wipe ${resolved}: that is the e2e root itself, not a project dir`);
    }
    if (resolved.startsWith(root + path.sep)) return resolved;
  }
  throw new Error(
    `refusing to wipe ${resolved}: outside the live-e2e workdir (${allowedRoots().join(', ')})`,
  );
}

function freshProject(projectDir, prdPath) {
  const resolved = assertDisposable(projectDir);
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
  execFileSync('git', ['init'], { cwd: resolved, stdio: 'ignore' });
  if (prdPath) fs.copyFileSync(prdPath, path.join(resolved, 'prd.md'));
  return resolved;
}

module.exports = { freshProject, assertDisposable };
