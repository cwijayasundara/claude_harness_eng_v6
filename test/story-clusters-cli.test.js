'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'story-clusters.js');
const { planClusters, normalizeEdges } = require(SCRIPT);

function workspace(stories) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-clusters-'));
  fs.mkdirSync(path.join(dir, 'specs', 'stories'), { recursive: true });
  const storiesPath = path.join(dir, 'specs', 'stories', 'stories.json');
  fs.writeFileSync(storiesPath, `${JSON.stringify(stories, null, 2)}\n`);
  return {
    dir,
    storiesPath,
    clustersPath: path.join(dir, 'specs', 'stories', 'story-clusters.json'),
    edgesPath: path.join(dir, 'specs', 'stories', 'dependency-edges.json'),
  };
}

function run(ws, extra = []) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [SCRIPT, '--stories', ws.storiesPath, '--out', ws.clustersPath, '--edges-out', ws.edgesPath, ...extra],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

const story = (id, opts = {}) => ({
  id,
  title: `${id} title`,
  epic: id.split('-')[0],
  layer: opts.layer || 'Service',
  group: opts.group || 'A',
  story_points: opts.story_points == null ? 5 : opts.story_points,
  readiness: opts.readiness || 'ready',
  depends_on: opts.depends_on || [],
});

// A shape a real /spec run produces: two vertical slices, one shared type.
const TWO_SLICES = [
  story('E1-S1', { layer: 'Types', group: 'A', story_points: 3 }),
  story('E1-S2', { layer: 'Service', group: 'B', story_points: 5, depends_on: [{ story: 'E1-S1', kind: 'behavior', reason: 'needs the repository' }] }),
  story('E2-S1', { layer: 'Types', group: 'A', story_points: 3 }),
  story('E2-S2', {
    layer: 'API',
    group: 'B',
    story_points: 8,
    depends_on: [
      { story: 'E2-S1', kind: 'behavior', reason: 'needs the model' },
      { story: 'E1-S1', kind: 'contract', artifact: 'User type', reason: 'serialises User' },
    ],
  }),
];

test('CLI writes both artifacts and exits 0 on a resolvable plan', () => {
  const ws = workspace(TWO_SLICES);
  const res = run(ws);
  assert.strictEqual(res.code, 0, res.stderr);
  assert.ok(fs.existsSync(ws.clustersPath));
  assert.ok(fs.existsSync(ws.edgesPath));
  assert.match(res.stdout, /story-clusters: PASS/);
});

test('emitted dependency-edges.json round-trips: re-clustering from it reproduces the same plan', () => {
  const ws = workspace(TWO_SLICES);
  run(ws);
  const plan = JSON.parse(fs.readFileSync(ws.clustersPath, 'utf8'));
  const edges = JSON.parse(fs.readFileSync(ws.edgesPath, 'utf8'));

  // Rebuild the story set using ONLY the emitted edges as the dependency source,
  // then re-plan. The real artifact must reproduce the real plan — a fixture that
  // encoded the wrong edge shape would diverge here.
  const byId = new Map(TWO_SLICES.map((s) => [s.id, { ...s, depends_on: [] }]));
  for (const e of edges) {
    byId.get(e.from).depends_on.push({
      story: e.to, kind: e.kind, artifact: e.artifact, reason: e.reason,
    });
  }
  const replanned = planClusters({ stories: [...byId.values()] });
  assert.deepStrictEqual(replanned, plan);
});

test('the plan separates the two vertical slices and names the shared type as an interface contract', () => {
  const ws = workspace(TWO_SLICES);
  run(ws);
  const plan = JSON.parse(fs.readFileSync(ws.clustersPath, 'utf8'));
  assert.strictEqual(plan.cluster_count, 2);
  assert.deepStrictEqual(plan.clusters.map((c) => c.stories), [['E1-S1', 'E1-S2'], ['E2-S1', 'E2-S2']]);
  assert.strictEqual(plan.interface_contracts.length, 1);
  assert.strictEqual(plan.interface_contracts[0].artifact, 'User type');
  assert.strictEqual(plan.interface_contracts[0].contract_story, 'E1-S1');
  assert.ok(plan.clusters.every((c) => c.independently_startable));
});

test('CLI exits 1 when an interface contract has no story that can publish it', () => {
  const ws = workspace([
    story('E1-S1', { layer: 'Service', story_points: 8 }),
    story('E2-S1', { story_points: 8, depends_on: [{ story: 'E1-S1', kind: 'contract', artifact: 'Order total' }] }),
  ]);
  const res = run(ws, ['--min-points', '1']);
  assert.strictEqual(res.code, 1);
  assert.match(res.stderr, /no publishing story/);
  assert.match(res.stdout, /WARN.*Order total/);
});

test('CLI exits 2 on a missing story index and points at the step that writes it', () => {
  const ws = workspace(TWO_SLICES);
  fs.rmSync(ws.storiesPath);
  const res = run(ws);
  assert.strictEqual(res.code, 2);
  assert.match(res.stderr, /cannot read/);
  assert.match(res.stderr, /\/spec Step 3/);
});

test('CLI exits 2 rather than passing vacuously on an empty story index', () => {
  const ws = workspace([]);
  const res = run(ws);
  assert.strictEqual(res.code, 2);
  assert.match(res.stderr, /no ready stories/i);
});

test('CLI honours --max-points and reports the resulting split as a blocking dependency', () => {
  const ws = workspace([
    story('E1-S1', { story_points: 13 }),
    story('E1-S2', { story_points: 13, depends_on: [{ story: 'E1-S1', kind: 'behavior' }] }),
  ]);
  const res = run(ws, ['--max-points', '13', '--min-points', '1']);
  assert.strictEqual(res.code, 0, res.stderr);
  const plan = JSON.parse(fs.readFileSync(ws.clustersPath, 'utf8'));
  assert.strictEqual(plan.cluster_count, 2);
  assert.strictEqual(plan.blocking_dependencies.length, 1);
  assert.strictEqual(plan.clusters.filter((c) => c.independently_startable).length, 1);
  assert.match(res.stdout, /1 independently startable/);
});

test('legacy bare-string depends_on still clusters, read as a behavior edge', () => {
  const ws = workspace([story('E1-S1'), story('E1-S2', { depends_on: ['E1-S1'] })]);
  const res = run(ws);
  assert.strictEqual(res.code, 0, res.stderr);
  const edges = JSON.parse(fs.readFileSync(ws.edgesPath, 'utf8'));
  assert.strictEqual(edges[0].kind, 'behavior');
  assert.strictEqual(JSON.parse(fs.readFileSync(ws.clustersPath, 'utf8')).cluster_count, 1);
});

test('normalizeEdges is exported for downstream consumers', () => {
  assert.strictEqual(typeof normalizeEdges, 'function');
});
