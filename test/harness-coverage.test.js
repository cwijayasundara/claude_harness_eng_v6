'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'harness-coverage.js');

function run(files, scopedManifest, coverage, arch, extraArgs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-'));
  fs.mkdirSync(path.join(dir, 'specs', 'brownfield'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'),
    JSON.stringify({ nodes: files.map((p) => ({ id: p, kind: 'file', path: p })) }));
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify({ architecture: arch || {} }));
  const covPath = path.join(dir, 'cov.json');
  fs.writeFileSync(covPath, JSON.stringify(coverage || {}));
  const manPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manPath, JSON.stringify(scopedManifest));
  let code = 0;
  try {
    execFileSync('node', [SCRIPT, '--root', dir, '--manifest', manPath, '--coverage', covPath, ...(extraArgs || [])], { stdio: 'pipe' });
  } catch (e) { code = e.status; }
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'harness-coverage', 'harness-coverage.json'), 'utf8'));
  return { code, report };
}

const MANIFEST = {
  version: '1', guides: [], sensors: [
    { id: 'lint', axis: 'maintainability', type: 'computational', cadence: 'session', status: 'active', scope: 'universal' },
    { id: 'cov', axis: 'behaviour', type: 'computational', cadence: 'commit', status: 'active', scope: 'test-covered' },
    { id: 'layers', axis: 'architecture', type: 'computational', cadence: 'session', status: 'active', scope: 'layer-roots' },
    { id: 'slo', axis: 'behaviour', type: 'computational', cadence: 'integration', status: 'active', scope: 'runtime' },
  ],
};

test('maintainability is 100% (universal); behaviour holes = untested files', () => {
  const { code, report } = run(
    ['src/a.js', 'src/b.js', 'lib/c.js'],
    MANIFEST,
    { 'src/a.js': { lines: { covered: 5, total: 5 } } }, // only a.js tested
    { layer_roots: ['src'] });
  assert.strictEqual(code, 0);
  assert.strictEqual(report.perAxis.maintainability.pct, 100); // universal covers all 3
  assert.strictEqual(report.perAxis.behaviour.covered, 1);      // only a.js test-covered
  assert.ok(report.perAxis.behaviour.holes.includes('src/b.js'));
  assert.strictEqual(report.perAxis.architecture.covered, 2);   // a.js + b.js under src/
  assert.ok(report.perAxis.architecture.holes.includes('lib/c.js'));
});

test('runtime-scoped sensors are reported separately, not in per-file %', () => {
  const { report } = run(['src/a.js'], MANIFEST, {}, { layer_roots: ['src'] });
  assert.ok(report.nonFileMapping.runtime.includes('slo'));
  // behaviour per-file only counts the test-covered sensor, so 0% here (no coverage)
  assert.strictEqual(report.perAxis.behaviour.pct, 0);
});

test('graceful exit 0 with message when no code-graph', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(MANIFEST));
  let code = 0; let out = '';
  try { out = execFileSync('node', [SCRIPT, '--root', dir, '--manifest', path.join(dir, 'manifest.json')], { encoding: 'utf8' }); }
  catch (e) { code = e.status; }
  assert.strictEqual(code, 0);
  assert.ok(/code-graph/i.test(out), 'should mention the missing code-graph');
});

test('--check exits 1 when a file-based axis is 0%-covered', () => {
  // behaviour has only a test-covered sensor; no coverage → 0% → --check must exit 1
  const { code } = run(['src/a.js'], MANIFEST, {}, { layer_roots: ['src'] }, ['--check']);
  assert.strictEqual(code, 1);
});

test('without --check, 0%-covered axis still exits 0', () => {
  // same scenario as above but no --check flag
  const { code } = run(['src/a.js'], MANIFEST, {}, { layer_roots: ['src'] });
  assert.strictEqual(code, 0);
});

test('--check exits 0 when the only 0%-axis has no file-mapping sensor (e.g. traceability with artifacts scope only)', () => {
  // Manifest: maintainability=universal (100%), traceability=artifacts-scoped only (not file-mapping).
  // All file-mapping-eligible axes are fully covered; traceability is structurally 0% but has no
  // file-mapping sensors, so --check must NOT exit 1.
  const manifestUniversalOnly = {
    version: '1', guides: [], sensors: [
      { id: 'lint', axis: 'maintainability', type: 'computational', cadence: 'session', status: 'active', scope: 'universal' },
      { id: 'changelog', axis: 'traceability', type: 'computational', cadence: 'commit', status: 'active', scope: 'artifacts' },
    ],
  };
  const { code, report } = run(['src/a.js'], manifestUniversalOnly, {}, {}, ['--check']);
  assert.strictEqual(report.perAxis.maintainability.pct, 100, 'maintainability should be 100% via universal sensor');
  assert.strictEqual(report.perAxis.traceability.sensors.length, 0, 'traceability should have zero file-mapping sensors');
  assert.strictEqual(report.perAxis.traceability.pct, 0, 'traceability pct is structurally 0');
  assert.strictEqual(code, 0, '--check must exit 0 when only 0%-axes have no file-mapping sensors');
});

test('tolerant coverage path matching: absolute coverage key matches relative code-graph file', () => {
  // istanbul emits absolute keys like /tmp/proj/src/a.js; code-graph stores src/a.js
  const { code, report } = run(
    ['src/a.js'],
    MANIFEST,
    { '/tmp/proj/src/a.js': { lines: { covered: 5, total: 5 } } },
    {});
  assert.strictEqual(code, 0);
  assert.strictEqual(report.perAxis.behaviour.covered, 1, 'absolute coverage key should match relative file');
  assert.strictEqual(report.perAxis.behaviour.holes.length, 0);
});

const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('G11: harness-coverage is surfaced + scripted', () => {
  assert.strictEqual(JSON.parse(rd('package.json')).scripts['harness-coverage'], 'node .claude/scripts/harness-coverage.js');
  assert.ok(/harness-coverage/.test(rd('HARNESS.md')), 'HARNESS.md must document harness coverage');
});
