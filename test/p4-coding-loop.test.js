'use strict';

// P4 (lit-factory-simplify T1–T5): core ships the seal, /auto Gate 5 is one
// runner, first-source refresh leaves a non-empty graph (or a loud skip),
// and standard does not enable mutation / cycle / critic-per-group.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSkillCorpus } = require('./helpers/skill-corpus');
const { shipsIn } = require('./helpers/pack-membership');
const { isGateEnabled } = require('../.claude/hooks/lib/sensor-tier');
const { refreshNavigation } = require('../.claude/scripts/navigation-refresh');
const { copyScaffoldTree } = require('../.claude/scripts/scaffold-copy');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN_SOURCE = path.join(ROOT, '.claude');

test('T1: plan-seal ships with the core profile', () => {
  assert.ok(shipsIn('plan-seal', 'script').includes('core'));
  assert.ok(shipsIn('code-map', 'skill').includes('core'),
    'code-map (indexer) ships on core so first-source is not a hand copy');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-seal-'));
  const target = path.join(workDir, 'project');
  try {
    copyScaffoldTree(PLUGIN_SOURCE, target, 'core');
    assert.ok(fs.existsSync(path.join(target, '.claude', 'scripts', 'plan-seal.js')));
    assert.ok(fs.existsSync(path.join(target, '.claude', 'scripts', 'plan-artifact-digest.js')));
    assert.ok(
      fs.existsSync(path.join(target, '.claude', 'skills', 'code-map', 'scripts', 'code_index', 'code_index.py')),
      'core ships the AST indexer — first-source must not require a hand copy',
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('T2/T4: /auto SECTION 5 names the one runner and does not require critic/mutation/cycle on standard', () => {
  const auto = readSkillCorpus('auto');
  const implement = readSkillCorpus('implement');
  assert.match(auto, /run-gate-checks\.js/);
  assert.match(implement, /run-gate-checks\.js/);
  assert.match(auto, /sensor-checks\.json/);
  assert.doesNotMatch(auto, /run-gate-checks\.js --lane gate/);
  assert.match(auto, /sensor_tier=standard/);
  assert.doesNotMatch(
    auto,
    /Eight sub-gates/,
    'the duplicated Gate 1–8 cookbook must be gone'
  );
  assert.match(auto, /Evaluator.*end of run|end of run.*[Ee]valuator/s);
  assert.match(auto, /after the UI slice is green/);
  assert.match(auto, /strict only|strict-only|`strict` only/i);
});

test('T4: mutation-smoke is off on standard', () => {
  assert.strictEqual(isGateEnabled('standard', 'mutation-smoke'), false);
  assert.strictEqual(isGateEnabled('strict', 'mutation-smoke'), true);
});

test('T3: one .py file + refresh leaves code-graph.meta.json not empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-index-'));
  try {
    copyScaffoldTree(PLUGIN_SOURCE, dir, 'core');
    fs.mkdirSync(path.join(dir, 'backend'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'backend', 'app.py'), 'def ping():\n    return "ok"\n');
    const status = refreshNavigation({ projectDir: dir, mode: 'first-source' });
    assert.strictEqual(status.status, 'fresh', JSON.stringify(status));
    const meta = JSON.parse(
      fs.readFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.meta.json'), 'utf8'),
    );
    assert.notStrictEqual(meta.status, 'empty');
    assert.notStrictEqual(meta.producer, 'none');
    const wiki = fs.readFileSync(path.join(dir, 'specs', 'brownfield', 'wiki', 'WIKI.md'), 'utf8');
    assert.doesNotMatch(wiki, /No source code has been created yet/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
