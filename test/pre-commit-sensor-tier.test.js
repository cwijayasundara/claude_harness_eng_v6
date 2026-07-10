'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeGitProject, runGitHook } = require('./helpers/hook-fixture');
const { stage } = require('./helpers/pre-commit-fixtures');

const HOOK = 'pre-commit';

function writeManifest(projectDir, tier) {
  fs.writeFileSync(
    path.join(projectDir, 'project-manifest.json'),
    JSON.stringify({ quality: { sensor_tier: tier } }, null, 2)
  );
}

function installLegacyScripts(projectDir) {
  const dir = path.join(projectDir, '.claude', 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of [
    'legacy-discipline-gate.js',
    'sprout-diff-gate.js',
    'at-first-gate.js',
    'test-deletion-gate.js',
  ]) {
    const src = path.join(__dirname, '..', '.claude', 'scripts', name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, name));
  }
}

test('standard tier still blocks layer violations (behavior preserved)', async () => {
  const projectDir = makeGitProject();
  writeManifest(projectDir, 'standard');
  stage(projectDir, 'src/repository/db.py', 'from src.service import logic\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(
    (result.stdout + result.stderr).includes('repository cannot import from service'),
    result.stdout + result.stderr
  );
});

test('minimal tier skips legacy-discipline when graph+scripts would otherwise check', async () => {
  const projectDir = makeGitProject();
  writeManifest(projectDir, 'minimal');
  installLegacyScripts(projectDir);
  // Graph with symbols so legacy gate would engage if selected
  fs.mkdirSync(path.join(projectDir, 'specs', 'brownfield'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'specs', 'brownfield', 'code-graph.json'),
    JSON.stringify({
      files: {
        'src/service/app.py': {
          symbols: [{ name: 'foo', start: 1, end: 10 }],
        },
      },
    })
  );
  // Need a modified (not new) file — commit once then change
  stage(projectDir, 'src/service/app.py', 'def foo():\n    return 1\n');
  const { execFileSync } = require('child_process');
  execFileSync('git', ['commit', '-m', 'init', '--no-verify'], { cwd: projectDir });
  stage(projectDir, 'src/service/app.py', 'def foo():\n    return 2\n');

  const result = await runGitHook(projectDir, HOOK, {
    HARNESS_COVERAGE_GATE: 'off',
    HARNESS_OWNERSHIP_GATE: 'off',
  });
  // minimal must not fail on missing legacy receipt
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(
    !(result.stdout + result.stderr).includes('legacy-discipline-proof'),
    result.stdout + result.stderr
  );
});

test('HARNESS_SENSOR_TIER=minimal overrides standard manifest', async () => {
  const projectDir = makeGitProject();
  writeManifest(projectDir, 'standard');
  installLegacyScripts(projectDir);
  fs.mkdirSync(path.join(projectDir, 'specs', 'brownfield'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'specs', 'brownfield', 'code-graph.json'),
    JSON.stringify({
      files: {
        'src/service/app.py': {
          symbols: [{ name: 'foo', start: 1, end: 10 }],
        },
      },
    })
  );
  stage(projectDir, 'src/service/app.py', 'def foo():\n    return 1\n');
  const { execFileSync } = require('child_process');
  execFileSync('git', ['commit', '-m', 'init', '--no-verify'], { cwd: projectDir });
  stage(projectDir, 'src/service/app.py', 'def foo():\n    return 2\n');

  const result = await runGitHook(projectDir, HOOK, {
    HARNESS_SENSOR_TIER: 'minimal',
    HARNESS_COVERAGE_GATE: 'off',
    HARNESS_OWNERSHIP_GATE: 'off',
  });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('strict tier runs cycle-detection when graph present', async () => {
  const projectDir = makeGitProject();
  writeManifest(projectDir, 'strict');
  fs.mkdirSync(path.join(projectDir, 'specs', 'brownfield'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '.claude', 'state'), { recursive: true });
  // Baseline 0 cycles; graph has 1 cycle → block
  fs.writeFileSync(path.join(projectDir, '.claude', 'state', 'cycle-baseline.txt'), '0\n');
  fs.writeFileSync(
    path.join(projectDir, 'specs', 'brownfield', 'code-graph.json'),
    JSON.stringify({
      metrics: {
        cycles: [['a.py', 'b.py', 'a.py']],
        hubs: [],
      },
    })
  );
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  const result = await runGitHook(projectDir, HOOK, {
    HARNESS_COVERAGE_GATE: 'off',
    HARNESS_OWNERSHIP_GATE: 'off',
  });
  assert.notStrictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(
    (result.stdout + result.stderr).includes('import cycles increased'),
    result.stdout + result.stderr
  );
});
