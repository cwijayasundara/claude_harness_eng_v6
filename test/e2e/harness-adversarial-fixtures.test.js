'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST_PATH = path.join(__dirname, 'fixtures', 'adversarial', 'manifest.json');

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

describe('Harness E2E — Adversarial Fixture Verification', () => {
  test('manifest has runnable greenfield and brownfield scenarios', () => {
    const manifest = loadManifest();
    const lanes = new Set(manifest.scenarios.map((scenario) => scenario.lane));

    assert.ok(lanes.has('greenfield'), 'greenfield scenarios must exist');
    assert.ok(lanes.has('brownfield'), 'brownfield scenarios must exist');
    for (const scenario of manifest.scenarios) {
      assert.ok(fs.existsSync(path.join(ROOT, scenario.path)), `${scenario.id} path must exist`);
    }
  });

  test('brownfield fixture suites pass before agent modification', () => {
    const manifest = loadManifest();
    const brownfield = manifest.scenarios.filter((scenario) => scenario.lane === 'brownfield');

    for (const scenario of brownfield) {
      const cwd = path.join(ROOT, scenario.path);
      const result = spawnSync('npm', ['test', '--silent'], {
        cwd,
        encoding: 'utf8',
        timeout: 60000,
      });

      assert.strictEqual(
        result.status,
        0,
        `${scenario.id} fixture tests must pass before mutation:\n${result.stdout}${result.stderr}`
      );
    }
  });

  test('brownfield preservation contracts point at protected files', () => {
    const manifest = loadManifest();
    const brownfield = manifest.scenarios.filter((scenario) => scenario.lane === 'brownfield');

    for (const scenario of brownfield) {
      const cwd = path.join(ROOT, scenario.path);
      const contract = JSON.parse(fs.readFileSync(path.join(cwd, '.harness-adversarial.json'), 'utf8'));
      for (const protectedFile of contract.protected_files) {
        assert.ok(fs.existsSync(path.join(cwd, protectedFile)), `${scenario.id} missing ${protectedFile}`);
      }
    }
  });
});
