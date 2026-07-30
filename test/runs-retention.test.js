'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');
const {
  isStaleByName,
  planDeletes,
  RETENTION_DIRS,
} = require('../.claude/scripts/runs-retention');

const NOW = new Date('2026-07-10T12:00:00.000Z');
const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'runs-retention.js');

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'retention-')); }

/** Write a file under root and stamp its mtime `ageDays` in the past. */
function seed(root, relDir, name, ageDays) {
  const dir = path.join(root, relDir);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, name);
  fs.writeFileSync(full, 'x');
  const when = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  fs.utimesSync(full, when, when);
  return full;
}

function runRetention(root, extraArgs = []) {
  return execFileSync('node', [SCRIPT, '--root', root, ...extraArgs], { encoding: 'utf8' });
}

test('isStaleByName: daily run ledger older than keepDays is stale', () => {
  assert.strictEqual(isStaleByName('2026-06-20.jsonl', NOW, 14), true);
  assert.strictEqual(isStaleByName('2026-07-05.jsonl', NOW, 14), false);
  assert.strictEqual(isStaleByName('2026-07-10.jsonl', NOW, 14), false);
});

test('isStaleByName: unknown names are kept', () => {
  assert.strictEqual(isStaleByName('notes.txt', NOW, 14), false);
  assert.strictEqual(isStaleByName('weird-file.jsonl', NOW, 14), false);
});

test('isStaleByName: ISO-stamped archive names', () => {
  assert.strictEqual(
    isStaleByName('telemetry-ledger-2026-06-01T10-00-00-000Z.jsonl', NOW, 30),
    true
  );
  assert.strictEqual(
    isStaleByName('telemetry-ledger-2026-07-07T10-43-36-434Z.jsonl', NOW, 30),
    false
  );
});

test('planDeletes with preferName uses filename dates', () => {
  const names = planDeletes(
    [
      { name: '2026-06-01.jsonl' },
      { name: '2026-07-09.jsonl' },
      { name: 'README.md' },
    ],
    { now: NOW, keepDays: 14, preferName: true }
  );
  assert.deepStrictEqual(names, ['2026-06-01.jsonl']);
});

// --- transient caches (context-cache / tool-output) ------------------------
// These two grew to 86MB with no policy at all. context-cache names are content
// hashes with no date in them, so a name-only rule prunes nothing and reports
// success — the vacuous-pass class. Both dirs are covered by mtime here.

test('RETENTION_DIRS covers every churn directory the harness writes', () => {
  const rels = RETENTION_DIRS.map((d) => d.rel.join('/'));
  assert.ok(rels.includes('.claude/runs'), 'runs must stay covered');
  assert.ok(rels.includes('.claude/state/archive'), 'archive must stay covered');
  assert.ok(rels.includes('.claude/state/context-cache'), 'context-cache is unpruned churn');
  assert.ok(rels.includes('.claude/state/tool-output'), 'tool-output is unpruned churn');
});

test('content-hash cache names carry no date, so they prune by mtime, not name', () => {
  // The real failure mode: isStaleByName cannot date "bc2be0c7ad3617e8.raw".
  assert.strictEqual(isStaleByName('bc2be0c7ad3617e8.raw', NOW, 7), false);
  // planDeletes must therefore fall through to mtime for it.
  const stale = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).getTime();
  const fresh = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000).getTime();
  const names = planDeletes(
    [
      { name: 'bc2be0c7ad3617e8.raw', mtimeMs: stale },
      { name: 'aa11bb22cc33dd44.raw', mtimeMs: fresh },
    ],
    { now: NOW, keepDays: 7, preferName: true }
  );
  assert.deepStrictEqual(names, ['bc2be0c7ad3617e8.raw']);
});

test('round-trip: the real script prunes stale cache files and keeps fresh ones', () => {
  const root = tmpRoot();
  const staleRaw = seed(root, '.claude/state/context-cache', 'bc2be0c7ad3617e8.raw', 30);
  const freshRaw = seed(root, '.claude/state/context-cache', 'aa11bb22cc33dd44.raw', 1);
  const staleLog = seed(root, '.claude/state/tool-output', '2026-01-02T11-38-28-216Z-test.log', 30);
  const freshLog = seed(root, '.claude/state/tool-output', 'recent-run.log', 1);

  const out = runRetention(root);

  assert.ok(!fs.existsSync(staleRaw), 'stale hash-named cache entry should be deleted');
  assert.ok(fs.existsSync(freshRaw), 'fresh cache entry must survive');
  assert.ok(!fs.existsSync(staleLog), 'stale tool-output log should be deleted');
  assert.ok(fs.existsSync(freshLog), 'fresh tool-output log must survive');
  assert.match(out, /context-cache 1 file/);
  assert.match(out, /tool-output 1 file/);
});

test('round-trip: --dry-run reports cache deletions without performing them', () => {
  const root = tmpRoot();
  const staleRaw = seed(root, '.claude/state/context-cache', 'deadbeefcafe0001.raw', 30);

  const out = runRetention(root, ['--dry-run']);

  assert.ok(fs.existsSync(staleRaw), 'dry-run must not delete');
  assert.match(out, /would delete context-cache\/deadbeefcafe0001\.raw/);
});

test('--cache-days overrides the cache retention window', () => {
  const root = tmpRoot();
  const threeDaysOld = seed(root, '.claude/state/context-cache', 'ffffffffffffffff.raw', 3);

  runRetention(root, ['--cache-days', '30']);
  assert.ok(fs.existsSync(threeDaysOld), '3d-old file survives a 30d window');

  runRetention(root, ['--cache-days', '2']);
  assert.ok(!fs.existsSync(threeDaysOld), '3d-old file is pruned by a 2d window');
});
