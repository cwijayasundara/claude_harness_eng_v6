'use strict';

// Run the generated project's own npm test suite — the deterministic check
// that an agent change kept existing behavior (and its new tests) green.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function runProjectSuite(projectDir, timeoutMs = 120000) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
  } catch (_) {
    return { status: null, out: 'no package.json' };
  }
  if (!pkg.scripts || !pkg.scripts.test) return { status: null, out: 'no test script' };
  const run = spawnSync('npm', ['test', '--silent'], { cwd: projectDir, encoding: 'utf8', timeout: timeoutMs });
  return { status: run.status, out: ((run.stdout || '') + (run.stderr || '')).slice(-2000) };
}

module.exports = { runProjectSuite };
