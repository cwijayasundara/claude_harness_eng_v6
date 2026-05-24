const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// ── 1. Telemetry snapshot with phase_eval record ────────────────────────────

const { buildSnapshot } = require(path.join(ROOT, '.claude', 'scripts', 'telemetry-memory.js'));

const mockPhaseEvalRecord = {
  kind: 'phase_eval',
  ts: Date.now(),
  user: 'test-user',
  phase: 'spec',
  iteration: '2',
  scores: { completeness: 8, traceability: 6, specificity: 9, consistency: 7, actionability: 8 },
  weighted_average: 7.6,
  verdict: 'PASS',
  lane: 'build',
  mode: 'full',
  group_id: 'A',
  story_id: 'none',
  host: 'test-host',
};

test('buildSnapshot emits harness_phase_eval_score metric lines', () => {
  const output = buildSnapshot([mockPhaseEvalRecord]);
  assert.match(output, /harness_phase_eval_score/);
});

test('buildSnapshot emits harness_phase_eval_iterations_total metric lines', () => {
  const output = buildSnapshot([mockPhaseEvalRecord]);
  assert.match(output, /harness_phase_eval_iterations_total/);
});

// ── 2. Grafana dashboard validation ─────────────────────────────────────────

const dashboardPath = path.join(ROOT, 'telemetry', 'grafana', 'dashboards', 'harness-overview.json');
const dashboardRaw = fs.readFileSync(dashboardPath, 'utf8');
const dashboardJson = JSON.parse(dashboardRaw);

test('Grafana dashboard JSON is valid', () => {
  assert.ok(dashboardJson, 'dashboard parsed without error');
  assert.ok(Array.isArray(dashboardJson.panels), 'panels is an array');
});

test('dashboard contains a Phase Quality row panel', () => {
  const rowPanels = dashboardJson.panels.filter(
    (p) => p.type === 'row' && p.title === 'Phase Quality'
  );
  assert.strictEqual(rowPanels.length, 1, 'expected exactly one Phase Quality row');
});

test('dashboard contains Phase Quality Scores, Ratchet Iterations, Traceability Coverage, and Pass Rate panels', () => {
  const titles = dashboardJson.panels.map((p) => p.title);
  const expected = [
    'Phase Quality Scores',
    'Ratchet Iterations per Phase',
    'Traceability Coverage',
    'Phase Eval Pass Rate',
  ];
  for (const title of expected) {
    assert.ok(titles.includes(title), `missing panel: ${title}`);
  }
});

test('Phase Quality panels query harness_phase_eval_score or harness_phase_eval_iterations_total', () => {
  const phaseQualityPanels = dashboardJson.panels.filter(
    (p) => ['Phase Quality Scores', 'Ratchet Iterations per Phase', 'Traceability Coverage', 'Phase Eval Pass Rate'].includes(p.title)
  );
  assert.ok(phaseQualityPanels.length >= 4, 'expected at least 4 phase quality panels');
  for (const panel of phaseQualityPanels) {
    const exprs = (panel.targets || []).map((t) => t.expr).join(' ');
    assert.ok(
      exprs.includes('harness_phase_eval_score') || exprs.includes('harness_phase_eval_iterations_total'),
      `panel "${panel.title}" does not query phase eval metrics`
    );
  }
});

// ── 3. PPTX deck generation ─────────────────────────────────────────────────

test('build_matrices_deck.py runs without errors', () => {
  const result = execFileSync('python3', [path.join(ROOT, 'build_matrices_deck.py')], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.match(result, /wrote matrices\.pptx/);
});

test('generated deck has 12 slides', () => {
  const result = execFileSync('python3', [path.join(ROOT, 'build_matrices_deck.py')], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.match(result, /12 slides/);
});
