const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { rotateLedgerIfNeeded } = require(path.join(
  __dirname, '..', '.claude', 'scripts', 'telemetry-ledger-rotate.js'
));
const { appendLedger } = require(path.join(
  __dirname, '..', '.claude', 'scripts', 'telemetry-memory.js'
));

function tmpState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-rot-'));
}

function writeLines(file, n) {
  const line = JSON.stringify({ k: 'x'.repeat(200) }) + '\n';
  fs.writeFileSync(file, line.repeat(n));
}

test('does nothing when the ledger is under the byte cap', () => {
  const dir = tmpState();
  const file = path.join(dir, 'telemetry-ledger.jsonl');
  writeLines(file, 10);
  const before = fs.readFileSync(file, 'utf8');
  assert.strictEqual(rotateLedgerIfNeeded(file, { maxBytes: 10 * 1024 * 1024, keepLines: 5 }), false);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});

test('rotates oldest rows to an archive once over the byte cap, keeping the recent tail', () => {
  const dir = tmpState();
  const file = path.join(dir, 'telemetry-ledger.jsonl');
  // 2000 rows ~200B each ~= 400KB; cap at 100KB, keep 500.
  for (let i = 0; i < 2000; i++) fs.appendFileSync(file, JSON.stringify({ i, pad: 'y'.repeat(180) }) + '\n');
  const rotated = rotateLedgerIfNeeded(file, { maxBytes: 100 * 1024, keepLines: 500 });
  assert.strictEqual(rotated, true);

  const kept = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  assert.strictEqual(kept.length, 500, 'keeps exactly the tail');
  assert.strictEqual(JSON.parse(kept[kept.length - 1]).i, 1999, 'newest row retained');
  assert.strictEqual(JSON.parse(kept[0]).i, 1500, 'oldest kept row is correct');

  const archiveDir = path.join(dir, 'archive');
  const archives = fs.readdirSync(archiveDir).filter((f) => f.startsWith('telemetry-ledger-'));
  assert.strictEqual(archives.length, 1, 'one archive file written');
  const archived = fs.readFileSync(path.join(archiveDir, archives[0]), 'utf8').split('\n').filter(Boolean);
  assert.strictEqual(archived.length, 1500, 'archive holds the rolled-out rows');
  assert.strictEqual(JSON.parse(archived[0]).i, 0, 'archive starts at the oldest row');
});

test('trims to the byte budget even when rows are few but huge (byte cap is authoritative)', () => {
  const dir = tmpState();
  const file = path.join(dir, 'telemetry-ledger.jsonl');
  // 3 rows, each ~50KB, fewer than keepLines but together well over the byte cap.
  for (let i = 0; i < 3; i++) fs.appendFileSync(file, JSON.stringify({ i, big: 'z'.repeat(50000) }) + '\n');
  const rotated = rotateLedgerIfNeeded(file, { maxBytes: 100 * 1024, keepLines: 500 });
  assert.strictEqual(rotated, true, 'few-but-huge rows must still rotate once over the byte cap');

  const kept = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  assert.ok(kept.length < 3, 'trimmed below the original line count');
  assert.ok(kept.length >= 1, 'at least the newest row is kept');
  assert.strictEqual(JSON.parse(kept[kept.length - 1]).i, 2, 'newest row retained');

  const archiveDir = path.join(dir, 'archive');
  const archives = fs.readdirSync(archiveDir).filter((f) => f.startsWith('telemetry-ledger-'));
  assert.strictEqual(archives.length, 1, 'one archive file written');
  const archived = fs.readFileSync(path.join(archiveDir, archives[0]), 'utf8').split('\n').filter(Boolean);
  assert.strictEqual(archived.length + kept.length, 3, 'archive + kept accounts for every original row');
  assert.strictEqual(JSON.parse(archived[0]).i, 0, 'archive starts at the oldest row');
});

test('rotates when line count equals keepLines but bytes are far over the cap (the steady-state bug)', () => {
  // Reproduces REC-20260713-003: the real ledger sat at exactly LEDGER_KEEP_LINES
  // (10000) lines forever because the old bailout fired on line count alone,
  // even though bytes were 18x over MAX_LEDGER_BYTES. Scaled down here for speed.
  const dir = tmpState();
  const file = path.join(dir, 'telemetry-ledger.jsonl');
  const keepLines = 50;
  for (let i = 0; i < keepLines; i++) {
    fs.appendFileSync(file, JSON.stringify({ i, pad: 'p'.repeat(2000) }) + '\n');
  }
  const maxBytes = 10 * 1024; // total bytes (~100KB) is far over this cap
  const rotated = rotateLedgerIfNeeded(file, { maxBytes, keepLines });
  assert.strictEqual(rotated, true, 'byte cap must be authoritative even when lines.length === keepLines');

  const kept = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  assert.ok(kept.length < keepLines, 'trimmed below keepLines to respect the byte cap');
  assert.strictEqual(JSON.parse(kept[kept.length - 1]).i, keepLines - 1, 'newest row retained');
});

test('appendLedger triggers rotation automatically (integration)', () => {
  const dir = tmpState();
  const file = path.join(dir, 'telemetry-ledger.jsonl');
  // Pre-fill beyond the default 5MB cap, then one append should rotate it.
  const big = JSON.stringify({ pad: 'q'.repeat(500) }) + '\n';
  fs.writeFileSync(file, big.repeat(12000)); // ~6MB, >5MB cap, >10000 lines
  appendLedger(dir, { event: 'tool', tool: 'Bash' });
  const kept = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  assert.ok(kept.length <= 10000, `active ledger bounded, got ${kept.length}`);
  assert.ok(fs.existsSync(path.join(dir, 'archive')), 'overflow archived');
});
