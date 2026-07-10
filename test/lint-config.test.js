'use strict';

// PR2 dogfood: Style pillar requires eslint config + provisioned binary.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');

test('eslint flat config exists at repo root', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'eslint.config.js')));
});

test('package.json has lint script and eslint devDependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts && pkg.scripts.lint, 'npm run lint required');
  assert.match(pkg.scripts.lint, /eslint/);
  assert.ok(pkg.devDependencies && pkg.devDependencies.eslint, 'eslint must be a devDependency');
  assert.ok(pkg.devDependencies.globals, 'globals package required for flat config node globals');
});

test('npm run lint exits 0 (no error-level findings)', () => {
  const res = spawnSync('npm', ['run', 'lint'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  assert.strictEqual(
    res.status,
    0,
    `lint failed:\n${res.stdout}\n${res.stderr}`
  );
});

test('CI workflow runs lint and gitleaks', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(yml, /npm run lint/);
  assert.match(yml, /npm ci/);
  assert.match(yml, /gitleaks/i);
});

test('gitleaks config exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.gitleaks.toml')));
});
