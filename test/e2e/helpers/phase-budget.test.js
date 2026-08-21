'use strict';

// Unit coverage for the live-route cost ratchet. No live Claude, no tokens:
// synthetic transcripts in exactly the shape phase-cost-core reads.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const {
  billRoute, checkBudget, writeBaseline, readBaseline, formatBill, outputTotal,
} = require('./phase-budget');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-phase-budget-'));
}

const userTurn = (ts, text) => ({ type: 'user', isSidechain: false, timestamp: ts, message: { content: text } });
const assistantTurn = (ts, id, model, output) => ({
  type: 'assistant', isSidechain: false, timestamp: ts, requestId: id,
  message: { id, model, usage: { input_tokens: 0, output_tokens: output } },
});

/** A transcript file named for a session id, as the live routes produce. */
function writeTranscript(dir, sessionId, rows) {
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return file;
}

function sprintTranscript(dir, sessionId, { sprintOut = 4000, autoOut = 9000 } = {}) {
  return writeTranscript(dir, sessionId, [
    userTurn('2026-08-21T07:00:00.000Z', '/sprint prd-sprint-2.md'),
    assistantTurn('2026-08-21T07:10:00.000Z', 'a1', 'claude-sonnet-5', sprintOut),
    userTurn('2026-08-21T08:00:00.000Z', '/auto'),
    assistantTurn('2026-08-21T08:30:00.000Z', 'a2', 'claude-sonnet-5', autoOut),
  ]);
}

test('bills a transcript per slash command with a total', () => {
  const dir = tmpDir();
  const file = sprintTranscript(dir, 'sess-1');
  const bill = billRoute(file);

  const commands = bill.phases.map((p) => p.command).sort();
  assert.deepStrictEqual(commands, ['auto', 'sprint']);
  assert.strictEqual(bill.totals.output_tokens, 13000);
  assert.strictEqual(bill.coverage.sessions, 1);
  assert.ok(bill.totals.cost_usd > 0, 'a billed phase must carry a cost');
});

test('sessionIds narrows a bill to the sessions this route created', () => {
  const dir = tmpDir();
  const mineFile = sprintTranscript(dir, 'mine');
  const otherFile = sprintTranscript(dir, 'someone-elses', { sprintOut: 999999, autoOut: 999999 });

  // Both transcripts are in scope; the filter is what keeps a leftover run in
  // the same workdir out of this route's bill.
  const all = billRoute([mineFile, otherFile]);
  assert.strictEqual(all.coverage.sessions, 2);

  const mine = billRoute([mineFile, otherFile], { sessionIds: ['mine'] });
  assert.strictEqual(mine.coverage.sessions, 1);
  assert.strictEqual(mine.totals.output_tokens, 13000);
});

test('refuses to pass a budget check over an empty bill', () => {
  const bill = billRoute(path.join(tmpDir(), 'no-such-dir'));
  assert.strictEqual(bill.coverage.sessions, 0);
  assert.throws(
    () => checkBudget('sprint-delta', bill),
    /refusing to pass a budget check over an empty bill/,
    'a run with no transcript must fail loudly, not pass vacuously',
  );
});

test('records a baseline when none exists rather than passing silently', () => {
  const dir = tmpDir();
  const bill = billRoute(sprintTranscript(dir, 'sess-1'));
  const verdict = checkBudget('sprint-delta', bill, { baseline: null, update: true });
  assert.strictEqual(verdict.status, 'recorded');
  assert.strictEqual(verdict.regressions.length, 0);
});

test('baseline round-trips through disk in the compared shape', () => {
  const dir = tmpDir();
  const store = tmpDir();
  const bill = billRoute(sprintTranscript(dir, 'sess-1'));
  writeBaseline('sprint-delta', bill, store);

  const back = readBaseline('sprint-delta', store);
  assert.strictEqual(back.phases.sprint.output_total, 4000);
  assert.strictEqual(back.phases.auto.output_total, 9000);
  assert.strictEqual(back.total.output_total, 13000);

  // The stored baseline must be usable as a comparison input unchanged.
  assert.strictEqual(checkBudget('sprint-delta', bill, { baseline: back }).status, 'pass');
});

test('fails when a phase regresses past the tolerance band', () => {
  const dir = tmpDir();
  const baseline = readBack(billRoute(sprintTranscript(dir, 'base')));
  const worse = billRoute(sprintTranscript(tmpDir(), 'now', { sprintOut: 4000, autoOut: 20000 }));

  const verdict = checkBudget('sprint-delta', worse, { baseline, tolerance: 0.3 });
  assert.strictEqual(verdict.status, 'regressed');
  const labels = verdict.regressions.map((r) => r.label);
  assert.ok(labels.includes('/auto'), `expected /auto to regress, got ${JSON.stringify(labels)}`);
  assert.ok(!labels.includes('/sprint'), 'an unchanged phase must not be reported as a regression');
});

test('passes inside the tolerance band', () => {
  const dir = tmpDir();
  const baseline = readBack(billRoute(sprintTranscript(dir, 'base')));
  // +11% on /auto: real run-to-run variance, not a regression.
  const now = billRoute(sprintTranscript(tmpDir(), 'now', { sprintOut: 4000, autoOut: 10000 }));
  assert.strictEqual(checkBudget('sprint-delta', now, { baseline, tolerance: 0.3 }).status, 'pass');
});

test('a phase below the noise floor is reported unratcheted, never failed', () => {
  const baseline = readBack(billRoute(sprintTranscript(tmpDir(), 'base', { sprintOut: 100, autoOut: 9000 })));
  // /sprint quadruples, but from 100 tokens — below the floor, so not a fact.
  const now = billRoute(sprintTranscript(tmpDir(), 'now', { sprintOut: 400, autoOut: 9000 }));

  const verdict = checkBudget('sprint-delta', now, { baseline, tolerance: 0.3 });
  assert.strictEqual(verdict.status, 'pass');
  assert.ok(
    verdict.unratcheted.some((u) => u.label === '/sprint' && u.metric === 'output_total'),
    'a below-floor phase must be reported, not silently dropped',
  );
});

test('outputTotal counts subagent spend as the dispatching phase', () => {
  assert.strictEqual(outputTotal({ output_tokens: 100, subagent_output_tokens: 900 }), 1000);
});

test('the printed bill names a main-loop-only reading as an undercount', () => {
  const bill = billRoute(sprintTranscript(tmpDir(), 'sess-1'));
  const text = formatBill('sprint-delta', bill);
  assert.match(text, /MAIN-LOOP ONLY/, 'a partial bill must not print as a total');
  assert.match(text, /\/sprint/);
  assert.match(text, /TOTAL/);
});

/** The baseline shape as it would come back off disk, without touching disk. */
function readBack(bill) {
  const store = tmpDir();
  writeBaseline('sprint-delta', bill, store);
  return readBaseline('sprint-delta', store);
}
