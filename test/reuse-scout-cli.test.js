'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, '.claude/scripts/reuse-scout.js');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('CLI exists, reuses the lib, is require-safe', () => {
  assert.ok(fs.existsSync(CLI));
  const src = read('.claude/scripts/reuse-scout.js');
  assert.match(src, /require\('\.\.\/hooks\/lib\/reuse-scout'\)/);
  assert.match(src, /require\.main === module/);
});

test('package.json exposes the reuse-scout script', () => {
  assert.strictEqual(JSON.parse(read('package.json')).scripts['reuse-scout'], 'node .claude/scripts/reuse-scout.js');
});

test('CLI emits JSON with a fire decision for a real graph fixture', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-'));
  const graph = path.join(dir, 'g.json');
  fs.writeFileSync(graph, JSON.stringify({
    nodes: [{ id: 'py:src/services/upload_service.py', kind: 'file', path: 'src/services/upload_service.py', symbols: ['UploadService'] }],
    edges: [], metrics: { files: 1, edges: 0, cycles: [], hubs: [{ id: 'py:src/services/upload_service.py', fan_in: 3, fan_out: 0 }] },
  }));
  const out = execFileSync('node', [CLI, '--graph', graph, '--goal', 'upload source variant'], { cwd: ROOT, encoding: 'utf8' });
  const r = JSON.parse(out);
  assert.strictEqual(typeof r.fire, 'boolean');
  assert.ok(['high', 'medium', 'low'].includes(r.band));
});

test('CLI --batch reads a DIRECTORY of per-story JSON files (sprint/epic shape)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-batch-'));
  const graph = path.join(dir, 'g.json');
  fs.writeFileSync(graph, JSON.stringify({ nodes: [], edges: [], metrics: { files: 0, edges: 0, cycles: [], hubs: [] } }));
  const stories = path.join(dir, 'stories');
  fs.mkdirSync(stories);
  // Two stories sharing >=2 goal terms (currency + parser) must cluster; the third is unrelated.
  fs.writeFileSync(path.join(stories, 's1.json'), JSON.stringify({ id: 'S1', goal: 'add currency parser normalization' }));
  fs.writeFileSync(path.join(stories, 's2.json'), JSON.stringify({ id: 'S2', goal: 'extend currency parser for euros' }));
  fs.writeFileSync(path.join(stories, 's3.json'), JSON.stringify({ id: 'S3', goal: 'render dashboard widget' }));
  const out = execFileSync('node', [CLI, '--graph', graph, '--goal', 'currency parsing', '--batch', stories], { cwd: ROOT, encoding: 'utf8' });
  const r = JSON.parse(out);
  const cluster = r.intra_batch.find((c) => c.stories.includes('S1') && c.stories.includes('S2'));
  assert.ok(cluster, 'S1 and S2 cluster on shared currency-parser terms');
  assert.ok(!r.intra_batch.some((c) => c.stories.includes('S3') && c.stories.length > 1), 'S3 does not join');
});

test('CLI degrades loud (exit 0 + low result) when the graph is missing', () => {
  let code = 0; let out = '';
  try { out = execFileSync('node', [CLI, '--graph', '/no/such/graph.json', '--goal', 'x'], { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { code = e.status; out = `${e.stdout || ''}${e.stderr || ''}`; }
  assert.strictEqual(code, 0);
  assert.match(out, /"band":\s*"low"|graph .*not found|unavailable/i);
});
