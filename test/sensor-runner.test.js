'use strict';

// T2 residue: default run-gate-checks.js is the pre-commit GATE_CATALOG,
// not the /gate pack list. --lane gate (and --only) keep the pack path.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveLane } = require('../.claude/scripts/run-gate-checks.js');
const { runSensorCatalog, selectGates } = require('../.claude/hooks/lib/gate-registry');
const { isGateEnabled } = require('../.claude/hooks/lib/sensor-tier');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(ROOT, '.claude', 'scripts', 'run-gate-checks.js');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sensor-runner-'));
}

test('resolveLane: default sensors; --only and --lane gate select the pack list', () => {
  assert.strictEqual(resolveLane([]), 'sensors');
  assert.strictEqual(resolveLane(['--files', 'a.py']), 'sensors');
  assert.strictEqual(resolveLane(['--only', 'evidence-integrity']), 'gate');
  assert.strictEqual(resolveLane(['--lane', 'gate', '--files', 'a.py']), 'gate');
  assert.strictEqual(resolveLane(['--lane', 'sensors']), 'sensors');
  assert.throws(() => resolveLane(['--lane', 'mystery']), /unknown --lane/);
});

test('standard sensor catalog excludes mutation/cycle and includes secret-scan', () => {
  const ids = selectGates('standard').map((g) => g.id);
  assert.ok(ids.includes('secret-scan'));
  assert.ok(ids.includes('type-check'));
  assert.ok(!ids.includes('mutation-smoke'));
  assert.ok(!ids.includes('cycle-detection'));
  assert.strictEqual(isGateEnabled('standard', 'mutation-smoke'), false);
});

test('runSensorCatalog on a secret-bearing file blocks secret-scan, not canvas-sync', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'backend'), { recursive: true });
  // Split so this test file itself is not a secret-scan hit.
  const exampleKey = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
  fs.writeFileSync(
    path.join(dir, 'backend', 'app.py'),
    `KEY = "${exampleKey}"\n`,
  );
  const { results, summary } = runSensorCatalog(dir, { files: ['backend/app.py'] });
  assert.ok(results.length > 0, 'must run at least the without-source / source catalog');
  assert.ok(!results.some((r) => r.id === 'canvas-sync'), 'pack checks are a different lane');
  const secret = results.find((r) => r.id === 'secret-scan');
  assert.ok(secret, `secret-scan must run, got ${results.map((r) => r.id).join(',')}`);
  assert.strictEqual(secret.status, 'blocked');
  assert.strictEqual(summary.pass, false);
});

test('CLI default lane writes sensor-checks.json and does not write gate-checks.json', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude', 'hooks', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'backend', 'ok.py'), 'def ping():\n    return 1\n');
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify({
    quality: { sensor_tier: 'standard' },
  }));
  spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init'], {
    cwd: dir, encoding: 'utf8',
  });
  const r = spawnSync('node', [RUNNER, '--root', dir, '--files', 'backend/ok.py'], {
    encoding: 'utf8', timeout: 60000,
  });
  const sensorOut = path.join(dir, 'specs', 'reviews', 'sensor-checks.json');
  const gateOut = path.join(dir, 'specs', 'reviews', 'gate-checks.json');
  assert.ok(fs.existsSync(sensorOut), `stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.ok(!fs.existsSync(gateOut), 'default lane must not write the /gate pack report');
  const doc = JSON.parse(fs.readFileSync(sensorOut, 'utf8'));
  assert.strictEqual(doc.lane, 'sensors');
  assert.ok(doc.results.some((x) => x.id === 'secret-scan'));
  assert.ok(!doc.results.some((x) => x.id === 'mutation-smoke'));
  assert.ok(!doc.results.some((x) => x.id === 'cycle-detection'));
});

test('/gate skill names --lane gate; /auto default command has no --lane gate', () => {
  const gate = readSkillCorpus('gate');
  const auto = readSkillCorpus('auto');
  assert.match(gate, /run-gate-checks\.js --lane gate/);
  assert.doesNotMatch(auto, /run-gate-checks\.js --lane gate/);
});
