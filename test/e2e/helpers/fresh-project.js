'use strict';

// Reset a temp project dir under test/e2e/ and seed it with a PRD. Shared by the
// live runners. Confinement guard: never rm a path outside test/e2e/, even if a
// future change makes the project dir configurable.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const E2E_ROOT = path.join(__dirname, '..'); // test/e2e/

function freshProject(projectDir, prdPath) {
  const resolved = path.resolve(projectDir);
  if (!resolved.startsWith(E2E_ROOT + path.sep)) {
    throw new Error(`refusing to wipe ${resolved}: outside ${E2E_ROOT}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
  execFileSync('git', ['init'], { cwd: resolved, stdio: 'ignore' });
  if (prdPath) fs.copyFileSync(prdPath, path.join(resolved, 'prd.md'));
}

module.exports = { freshProject };
