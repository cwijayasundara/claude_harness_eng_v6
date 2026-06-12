'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'test', 'e2e', 'fixtures', 'adversarial', 'manifest.json');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(read(relPath));
}

test('adversarial fixture manifest covers greenfield and brownfield stress cases', () => {
  assert.ok(fs.existsSync(MANIFEST_PATH), 'test/e2e/fixtures/adversarial/manifest.json must exist');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  assert.strictEqual(manifest.schema_version, 1);
  assert.ok(Array.isArray(manifest.scenarios), 'manifest.scenarios must be an array');

  const greenfield = manifest.scenarios.filter((scenario) => scenario.lane === 'greenfield');
  const brownfield = manifest.scenarios.filter((scenario) => scenario.lane === 'brownfield');
  assert.ok(greenfield.length >= 2, 'need at least two adversarial greenfield scenarios');
  assert.ok(brownfield.length >= 2, 'need at least two adversarial brownfield scenarios');

  for (const scenario of manifest.scenarios) {
    assert.match(scenario.id, /^[a-z0-9-]+$/);
    assert.ok(Array.isArray(scenario.threats) && scenario.threats.length >= 2, `${scenario.id} needs threats`);
    assert.ok(Array.isArray(scenario.assertions) && scenario.assertions.length >= 2, `${scenario.id} needs assertions`);
    assert.ok(fs.existsSync(path.join(ROOT, scenario.path)), `${scenario.id} path missing: ${scenario.path}`);
  }
});

test('greenfield adversarial prompts force ambiguity, constraints, and proof requirements', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const greenfield = manifest.scenarios.filter((scenario) => scenario.lane === 'greenfield');

  for (const scenario of greenfield) {
    const prompt = read(scenario.path);
    assert.match(prompt, /conflict|ambiguous|trade-?off|contradict/i, `${scenario.id} must contain ambiguity pressure`);
    assert.match(prompt, /must|constraint|cannot|required/i, `${scenario.id} must contain hard constraints`);
    assert.match(prompt, /acceptance criteria|proof|test|verification/i, `${scenario.id} must demand proof`);
  }
});

test('brownfield adversarial repos declare preservation contracts and runnable tests', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const brownfield = manifest.scenarios.filter((scenario) => scenario.lane === 'brownfield');

  for (const scenario of brownfield) {
    const fixtureRoot = path.join(ROOT, scenario.path);
    const contractRel = path.join(scenario.path, '.harness-adversarial.json');
    const contract = readJson(contractRel);

    assert.ok(Array.isArray(contract.protected_files) && contract.protected_files.length > 0, `${scenario.id} needs protected files`);
    assert.ok(Array.isArray(contract.required_behaviors) && contract.required_behaviors.length > 0, `${scenario.id} needs required behaviors`);
    assert.ok(Array.isArray(contract.forbidden_patterns) && contract.forbidden_patterns.length > 0, `${scenario.id} needs forbidden patterns`);
    assert.ok(fs.existsSync(path.join(fixtureRoot, 'package.json')), `${scenario.id} needs package.json`);

    const pkg = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts && pkg.scripts.test, `${scenario.id} needs npm test script`);
    for (const protectedFile of contract.protected_files) {
      assert.ok(fs.existsSync(path.join(fixtureRoot, protectedFile)), `${scenario.id} missing protected file: ${protectedFile}`);
    }
  }
});

test('e2e runner includes the adversarial fixture verification layer', () => {
  const runner = read('test/e2e/run.sh');

  assert.match(runner, /harness-adversarial-fixtures\.test\.js/);
  assert.match(runner, /Adversarial Fixture/);
});
