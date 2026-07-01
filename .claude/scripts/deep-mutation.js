#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function arg(argv, name, fallback = null) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function readManifest(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8'));
  } catch {
    return {};
  }
}

function criticalGlobs(root) {
  const m = readManifest(root);
  return m?.quality?.mutation?.critical_globs || [];
}

function detectTool(root) {
  const pkgPath = path.join(root, 'package.json');
  if (exists(root, 'stryker.conf.js') || exists(root, 'stryker.conf.json') || exists(root, 'stryker.conf.mjs')) {
    return 'stryker';
  }
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps['@stryker-mutator/core']) return 'stryker';
    } catch {}
  }
  for (const rel of ['setup.cfg', 'pyproject.toml']) {
    if (exists(root, rel) && fs.readFileSync(path.join(root, rel), 'utf8').includes('mutmut')) return 'mutmut';
  }
  return null;
}

function commandFor(tool, globs) {
  if (tool === 'stryker') {
    return ['npx stryker run', globs.length ? `--mutate "${globs.join(',')}"` : ''].filter(Boolean).join(' ');
  }
  if (tool === 'mutmut') {
    return ['mutmut run', globs.length ? `--paths-to-mutate ${globs.map((g) => `"${g}"`).join(',')}` : ''].filter(Boolean).join(' ');
  }
  return null;
}

function writeVerdict(root, verdict) {
  const out = path.join(root, 'specs', 'reviews', 'deep-mutation-verdict.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(verdict, null, 2)}\n`);
}

function run(argv = process.argv.slice(2), root = process.cwd(), runner = cp.execSync) {
  const dryRun = argv.includes('--dry-run');
  const criticalOnly = argv.includes('--critical-only');
  const tool = detectTool(root);
  if (!tool) {
    writeVerdict(root, { verdict: 'unprovisioned', message: 'No Stryker or mutmut configuration found.' });
    process.stdout.write('deep-mutation: unprovisioned\n');
    return 0;
  }
  const globs = criticalOnly ? criticalGlobs(root) : [];
  const command = commandFor(tool, globs);
  if (dryRun) {
    writeVerdict(root, { verdict: 'dry-run', tool, command, critical_only: criticalOnly });
    process.stdout.write(`deep-mutation: dry-run ${tool} — ${command}\n`);
    return 0;
  }
  try {
    runner(command, { cwd: root, stdio: 'inherit', shell: true });
    writeVerdict(root, { verdict: 'pass', tool, command, critical_only: criticalOnly });
    return 0;
  } catch (err) {
    writeVerdict(root, { verdict: 'fail', tool, command, critical_only: criticalOnly, status: err.status || 1 });
    return 1;
  }
}

if (require.main === module) process.exit(run());

module.exports = { detectTool, commandFor, run };
