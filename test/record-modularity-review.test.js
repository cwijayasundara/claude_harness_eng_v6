'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'record-modularity-review.js');
const { buildMarker, run } = require(SCRIPT);

function graphWith(hubs) {
  return { metrics: { hubs } };
}

test('buildMarker records the timestamp and the current unstable-hub set', () => {
  const hubs = [
    { id: 'src/god-file.js', fan_in: 9, fan_out: 1, instability: 0.9 },
    { id: 'src/leaf.js', fan_in: 1, fan_out: 9, instability: 0.9 },
  ];
  const marker = buildMarker(graphWith(hubs), '2026-07-09T00:00:00.000Z');
  assert.deepStrictEqual(marker, {
    timestamp: '2026-07-09T00:00:00.000Z',
    unstableHubIds: ['src/god-file.js'],
  });
});

test('buildMarker tolerates a graph with no hubs', () => {
  assert.deepStrictEqual(buildMarker(graphWith([]), 't'), { timestamp: 't', unstableHubIds: [] });
  assert.deepStrictEqual(buildMarker({}, 't'), { timestamp: 't', unstableHubIds: [] });
});

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'record-modularity-'));
}

function writeGraph(root, hubs) {
  const graphPath = path.join(root, 'specs', 'brownfield', 'code-graph.json');
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.writeFileSync(graphPath, JSON.stringify(graphWith(hubs)));
  return graphPath;
}

test('run writes the marker file from the live code-graph', () => {
  const root = tmpRoot();
  writeGraph(root, [{ id: 'src/hub.js', fan_in: 6, fan_out: 1, instability: 0.85 }]);
  let out = '';
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk) => { out += chunk; return true; };
  let code;
  try {
    code = run(['--root', root], { now: () => '2026-07-09T02:00:00.000Z' });
  } finally {
    process.stdout.write = origWrite;
  }
  assert.strictEqual(code, 0);
  assert.match(out, /marker written/);

  const markerPath = path.join(root, '.claude', 'state', 'modularity-review-marker.json');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  assert.deepStrictEqual(marker, {
    timestamp: '2026-07-09T02:00:00.000Z',
    unstableHubIds: ['src/hub.js'],
  });
});

test('run overwrites a prior marker with the current snapshot (not appended)', () => {
  const root = tmpRoot();
  writeGraph(root, [{ id: 'src/a.js', fan_in: 6, fan_out: 1, instability: 0.85 }]);
  const silence = () => true;
  const origWrite = process.stdout.write;
  process.stdout.write = silence;
  try {
    run(['--root', root], { now: () => 't1' });
    writeGraph(root, [{ id: 'src/b.js', fan_in: 6, fan_out: 1, instability: 0.85 }]);
    run(['--root', root], { now: () => 't2' });
  } finally {
    process.stdout.write = origWrite;
  }
  const markerPath = path.join(root, '.claude', 'state', 'modularity-review-marker.json');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  assert.deepStrictEqual(marker, { timestamp: 't2', unstableHubIds: ['src/b.js'] });
});

function graphWithNodes(hubs, nodes) {
  return { metrics: { hubs }, nodes };
}

test('run --scope-path (D3.5 scoped review): an out-of-scope hub that was never reviewed stays stale, not silently cleared', () => {
  // Regression for the G19 review's CR-001: /design --delta Step D3.5 only
  // judges the amendment's touched-scope paths, but the FIRST implementation
  // recorded the marker as the FULL current unstable-hub set regardless of
  // scope — falsely "clearing" staleness for hubs the scoped review never
  // looked at. A scoped run must only add IN-SCOPE hubs to the marker.
  const root = tmpRoot();
  const graphPath = path.join(root, 'specs', 'brownfield', 'code-graph.json');
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.writeFileSync(graphPath, JSON.stringify(graphWithNodes(
    [
      { id: 'py:in_scope.py', fan_in: 6, fan_out: 1, instability: 0.9 },
      { id: 'py:out_of_scope.py', fan_in: 7, fan_out: 1, instability: 0.9 },
    ],
    [
      { id: 'py:in_scope.py', path: 'in_scope.py' },
      { id: 'py:out_of_scope.py', path: 'out_of_scope.py' },
    ]
  )));
  const silence = () => true;
  const origWrite = process.stdout.write;
  process.stdout.write = silence;
  let code;
  try {
    code = run(['--root', root, '--scope-path', 'in_scope.py'], { now: () => 't1' });
  } finally {
    process.stdout.write = origWrite;
  }
  assert.strictEqual(code, 0);
  const markerPath = path.join(root, '.claude', 'state', 'modularity-review-marker.json');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  // in_scope.py was just reviewed -> no longer stale. out_of_scope.py was
  // never reviewed (no prior marker either) -> must stay OUT of the marker
  // so it still reads as stale on the next drift run.
  assert.deepStrictEqual(marker.unstableHubIds, ['py:in_scope.py']);
});

test('run --scope-path: a previously-reviewed out-of-scope hub is carried forward, not dropped', () => {
  const root = tmpRoot();
  const graphPath = path.join(root, 'specs', 'brownfield', 'code-graph.json');
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  const graph = graphWithNodes(
    [
      { id: 'py:already_reviewed.py', fan_in: 6, fan_out: 1, instability: 0.9 },
      { id: 'py:in_scope.py', fan_in: 6, fan_out: 1, instability: 0.9 },
    ],
    [
      { id: 'py:already_reviewed.py', path: 'already_reviewed.py' },
      { id: 'py:in_scope.py', path: 'in_scope.py' },
    ]
  );
  fs.writeFileSync(graphPath, JSON.stringify(graph));
  // Seed a prior marker as if a full /brownfield --full review already
  // covered already_reviewed.py.
  const markerPath = path.join(root, '.claude', 'state', 'modularity-review-marker.json');
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({ timestamp: 't0', unstableHubIds: ['py:already_reviewed.py'] }));

  const silence = () => true;
  const origWrite = process.stdout.write;
  process.stdout.write = silence;
  try {
    run(['--root', root, '--scope-path', 'in_scope.py'], { now: () => 't1' });
  } finally {
    process.stdout.write = origWrite;
  }
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  assert.deepStrictEqual(marker.unstableHubIds.sort(), ['py:already_reviewed.py', 'py:in_scope.py']);
});

test('run with no --scope-path (full /brownfield --full review) is unaffected: full overwrite, as before', () => {
  const root = tmpRoot();
  writeGraph(root, [{ id: 'src/a.js', fan_in: 6, fan_out: 1, instability: 0.85 }]);
  const markerPath = path.join(root, '.claude', 'state', 'modularity-review-marker.json');
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({ timestamp: 't0', unstableHubIds: ['src/stale-old.js'] }));
  const silence = () => true;
  const origWrite = process.stdout.write;
  process.stdout.write = silence;
  try {
    run(['--root', root], { now: () => 't1' });
  } finally {
    process.stdout.write = origWrite;
  }
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  assert.deepStrictEqual(marker.unstableHubIds, ['src/a.js']);
});

test('run degrades loudly and exits 1 when no code-graph exists', () => {
  const root = tmpRoot();
  let err = '';
  const origErr = process.stderr.write;
  process.stderr.write = (chunk) => { err += chunk; return true; };
  let code;
  try {
    code = run(['--root', root], { now: () => 't' });
  } finally {
    process.stderr.write = origErr;
  }
  assert.strictEqual(code, 1);
  assert.match(err, /no code-graph/);
  assert.ok(!fs.existsSync(path.join(root, '.claude', 'state', 'modularity-review-marker.json')));
});
