const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const script = path.join(__dirname, '..', '.claude', 'scripts', 'archive-state.js');

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-state-'));
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  return dir;
}

function run(cwd) {
  const res = spawnSync('node', [script], { encoding: 'utf8', cwd });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  return res.stdout;
}

test('reports no archival needed when files are within limits', () => {
  const dir = makeProject();
  const stateDir = path.join(dir, '.claude', 'state');
  fs.writeFileSync(path.join(stateDir, 'iteration-log.md'), 'line\n'.repeat(10));
  const out = run(dir);
  assert.match(out, /within limits/);
  assert.ok(!fs.existsSync(path.join(stateDir, 'archive')), 'no archive dir should be created');
});

test('archives iteration-log.md over the line limit, keeping the tail', () => {
  const dir = makeProject();
  const stateDir = path.join(dir, '.claude', 'state');
  const lines = Array.from({ length: 600 }, (_, i) => `entry ${i}`);
  fs.writeFileSync(path.join(stateDir, 'iteration-log.md'), lines.join('\n'));
  const out = run(dir);
  assert.match(out, /iteration-log\.md: archived/);
  const kept = fs.readFileSync(path.join(stateDir, 'iteration-log.md'), 'utf8').split('\n');
  assert.strictEqual(kept.length, 500, 'keeps exactly the last 500 lines');
  assert.strictEqual(kept[kept.length - 1], 'entry 599', 'tail must be the newest entries');
  const archived = fs.readdirSync(path.join(stateDir, 'archive'))
    .filter((f) => f.startsWith('iteration-log-'));
  assert.strictEqual(archived.length, 1, 'one archive file written');
  const archivedContent = fs.readFileSync(path.join(stateDir, 'archive', archived[0]), 'utf8');
  assert.match(archivedContent, /^entry 0\n/, 'archive holds the oldest entries');
});

test('archives an oversized telemetry ledger by size and truncates in place', () => {
  const dir = makeProject();
  const stateDir = path.join(dir, '.claude', 'state');
  const ledger = path.join(stateDir, 'telemetry-ledger.jsonl');
  fs.writeFileSync(ledger, 'x'.repeat(11 * 1024 * 1024));
  const out = run(dir);
  assert.match(out, /telemetry-ledger\.jsonl: archived/);
  assert.strictEqual(fs.statSync(ledger).size, 0, 'live ledger truncated to empty');
  const archived = fs.readdirSync(path.join(stateDir, 'archive'))
    .filter((f) => f.startsWith('telemetry-ledger-'));
  assert.strictEqual(archived.length, 1);
});

function recJsonl(entries) {
  return entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

function rec(id, status) {
  return {
    id, target: 't', change: 'c', class: 'docs', risk: 'low', cost: 'low', benefit: 'low',
    confidence: 0.5, evidence: ['e'], status,
  };
}

test('leaves specs/retro/recommendations.jsonl untouched when resolved entries are within the cap', () => {
  const dir = makeProject();
  const retroDir = path.join(dir, 'specs', 'retro');
  fs.mkdirSync(retroDir, { recursive: true });
  const file = path.join(retroDir, 'recommendations.jsonl');
  fs.writeFileSync(file, recJsonl([rec('r1', 'approved'), rec('r2', 'proposed')]));
  const out = run(dir);
  assert.match(out, /within limits/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), recJsonl([rec('r1', 'approved'), rec('r2', 'proposed')]));
});

test('archives the oldest resolved recommendations over the cap, keeping every proposed entry regardless of age', () => {
  const dir = makeProject();
  const retroDir = path.join(dir, 'specs', 'retro');
  fs.mkdirSync(retroDir, { recursive: true });
  const file = path.join(retroDir, 'recommendations.jsonl');
  // 150 resolved entries (cap is 100) interleaved with 5 proposed entries that must never be archived.
  const entries = [];
  for (let i = 0; i < 150; i++) entries.push(rec(`resolved-${i}`, i % 2 === 0 ? 'approved' : 'rejected'));
  for (let i = 0; i < 5; i++) entries.push(rec(`proposed-${i}`, 'proposed'));
  fs.writeFileSync(file, recJsonl(entries));

  const out = run(dir);
  assert.match(out, /recommendations\.jsonl: archived 50 resolved entrie/);

  const kept = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(kept.length, 105, 'keeps the 100 most recent resolved + all 5 proposed');
  assert.strictEqual(kept.filter((e) => e.status === 'proposed').length, 5, 'no proposed entry is ever archived');
  assert.ok(kept.some((e) => e.id === 'resolved-149'), 'newest resolved entries survive');
  assert.ok(!kept.some((e) => e.id === 'resolved-0'), 'oldest resolved entries are archived away');

  const archiveFiles = fs.readdirSync(path.join(dir, '.claude', 'state', 'archive'))
    .filter((f) => f.startsWith('recommendations-'));
  assert.strictEqual(archiveFiles.length, 1);
  const archived = fs.readFileSync(path.join(dir, '.claude', 'state', 'archive', archiveFiles[0]), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(archived.length, 50);
  assert.ok(archived.every((e) => e.status !== 'proposed'), 'archive never contains a proposed entry');
});

test('leaves a malformed recommendations.jsonl untouched (validate-recommendations.js owns that failure)', () => {
  const dir = makeProject();
  const retroDir = path.join(dir, 'specs', 'retro');
  fs.mkdirSync(retroDir, { recursive: true });
  const file = path.join(retroDir, 'recommendations.jsonl');
  fs.writeFileSync(file, 'not valid json\n');
  run(dir);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'not valid json\n');
});

test('leaves recommendations.jsonl untouched when any entry is missing an id, even if the resolved count is over the cap', () => {
  // An id-less entry would make every id-less row collide on `archiveIds.has(undefined)`,
  // risking a proposed (pending human decision) entry being swept into the archive.
  // Bail entirely, same as fully-malformed JSON, rather than risk that.
  const dir = makeProject();
  const retroDir = path.join(dir, 'specs', 'retro');
  fs.mkdirSync(retroDir, { recursive: true });
  const file = path.join(retroDir, 'recommendations.jsonl');
  const entries = [];
  for (let i = 0; i < 150; i++) entries.push(rec(`resolved-${i}`, 'approved'));
  entries.push({ target: 't', change: 'c', class: 'docs', risk: 'low', cost: 'low', benefit: 'low', confidence: 0.5, evidence: ['e'], status: 'proposed' }); // no id
  const original = recJsonl(entries);
  fs.writeFileSync(file, original);
  run(dir);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), original, 'file must be untouched when any entry lacks a stable id');
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'state', 'archive')), 'no archive dir should be created');
});

test('exits 1 outside a project (no .claude directory found)', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'no-claude-'));
  const res = spawnSync('node', [script], { encoding: 'utf8', cwd: bare });
  assert.strictEqual(res.status, 1);
  assert.match(res.stdout, /No \.claude\/ directory found/);
});
