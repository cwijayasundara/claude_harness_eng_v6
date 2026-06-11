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

test('exits 1 outside a project (no .claude directory found)', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'no-claude-'));
  const res = spawnSync('node', [script], { encoding: 'utf8', cwd: bare });
  assert.strictEqual(res.status, 1);
  assert.match(res.stdout, /No \.claude\/ directory found/);
});
