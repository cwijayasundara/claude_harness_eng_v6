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

// ── Coverage: the ways a ratchet can pass over a run it never measured ───────
//
// Both holes below were live. The committed sprint-1 baseline was recorded from
// a RESUMED run, where a phase whose artifacts already existed returned early
// without recording its session id — so the bill narrowed to whatever the last
// process ran. It claimed $43.88 across four phases against a real $47.97
// across seven, with /scaffold and /brd absent and (freeform) at $0.00.

test('refuses to record a baseline that is missing a phase the route runs', () => {
  const dir = tmpDir();
  const bill = billRoute(sprintTranscript(dir, 'sess-1'));
  assert.throws(
    () => writeBaseline('partial', bill, tmpDir(), { expectPhases: ['sprint', 'auto', 'design'] }),
    /missing \/design/,
    'a baseline recorded from a partial run makes the ratchet permanently blind to the rest',
  );
});

test('a phase billed at exactly zero counts as missing, not as measured', () => {
  const dir = tmpDir();
  const file = writeTranscript(dir, 'sess-zero', [
    userTurn('2026-08-21T07:00:00.000Z', '/sprint prd.md'),
    assistantTurn('2026-08-21T07:10:00.000Z', 'a1', 'claude-sonnet-5', 4000),
    userTurn('2026-08-21T08:00:00.000Z', '/auto'),
    assistantTurn('2026-08-21T08:30:00.000Z', 'a2', 'claude-sonnet-5', 0),
  ]);
  assert.throws(
    () => writeBaseline('zeroed', billRoute(file), tmpDir(), { expectPhases: ['sprint', 'auto'] }),
    /missing \/auto/,
    'a phase recorded at $0.00 is an absent measurement, not a cheap one',
  );
});

test('records a baseline when every expected phase is billed', () => {
  const dir = tmpDir();
  const bill = billRoute(sprintTranscript(dir, 'sess-1'));
  const out = writeBaseline('complete', bill, tmpDir(), { expectPhases: ['sprint', 'auto'] });
  assert.ok(fs.existsSync(out));
});

test('a phase that vanishes from the run fails the budget, never passes it', () => {
  const dir = tmpDir();
  const bill = billRoute(sprintTranscript(dir, 'sess-1'));
  // The baseline knows a /design phase this run produced no bill for at all.
  const baseline = {
    phases: {
      sprint: { runs: 1, output_total: 4000, cost_usd: 1.0 },
      auto: { runs: 1, output_total: 9000, cost_usd: 2.0 },
      design: { runs: 1, output_total: 40000, cost_usd: 4.0 },
    },
    total: { output_total: 53000, cost_usd: 7.0 },
  };
  const verdict = checkBudget('vanished', bill, { baseline });
  assert.strictEqual(verdict.status, 'regressed',
    'a phase that did not run is not an under-budget phase');
  const missing = verdict.regressions.find((r) => r.metric === 'coverage');
  assert.ok(missing, `expected a coverage regression, got ${JSON.stringify(verdict.regressions)}`);
  assert.strictEqual(missing.label, '/design');
});

test('the bill carries cache accounting, since output is a small share of spend', () => {
  const dir = tmpDir();
  const bill = billRoute(sprintTranscript(dir, 'sess-1'));
  for (const key of ['cache_read_tokens', 'cache_write_tokens', 'full_misses', 'wasted_usd']) {
    assert.ok(key in bill.cache, `bill.cache must report ${key}`);
  }
  assert.ok(Array.isArray(bill.cache.idle_gaps_sec));
});

// ── Batching: the efficiency ratchet, which moves opposite to cost ──────────
//
// The largest cost driver measured on this harness is the turn count, not what
// a turn does: 695 of 833 turns in the sprint-1 baseline issued exactly ONE
// tool call at ~116K resident context each. A cost ratchet alone would see a
// batching regression only as an unexplained price rise.

const BASE_BATCHING = {
  all_turns: 800, tool_calls: 2000, calls_per_turn: 2.5,
  single_call_turns: 200, single_call_pct: 25, ctx_re_read_tokens: 50_000_000,
};

function billWithBatching(batching) {
  const dir = tmpDir();
  return { ...billRoute(sprintTranscript(dir, 'sess-1')), batching };
}

test('the bill reports turn density, not only cost', () => {
  const dir = tmpDir();
  const bill = billRoute(sprintTranscript(dir, 'sess-1'));
  for (const key of ['all_turns', 'tool_calls', 'calls_per_turn', 'single_call_pct', 'ctx_re_read_tokens']) {
    assert.ok(key in bill.batching, `bill.batching must report ${key}`);
  }
});

test('a FALL in calls-per-turn is a regression — agents stopped batching', () => {
  const bill = billWithBatching({ ...BASE_BATCHING, calls_per_turn: 1.2, single_call_pct: 83 });
  const verdict = checkBudget('batching', bill, { baseline: { phases: {}, total: {}, batching: BASE_BATCHING } });
  const hit = verdict.regressions.find((r) => r.metric === 'calls_per_turn');
  assert.ok(hit, `expected a calls_per_turn regression, got ${JSON.stringify(verdict.regressions)}`);
  assert.match(hit.reason, /stopped batching/);
  assert.strictEqual(verdict.status, 'regressed');
});

test('a RISE in context re-read is a regression — that is the cache-read bill', () => {
  const bill = billWithBatching({ ...BASE_BATCHING, ctx_re_read_tokens: 90_000_000 });
  const verdict = checkBudget('batching', bill, { baseline: { phases: {}, total: {}, batching: BASE_BATCHING } });
  assert.ok(verdict.regressions.some((r) => r.metric === 'ctx_re_read_tokens'));
});

test('an IMPROVEMENT in batching is never a regression', () => {
  const bill = billWithBatching({
    ...BASE_BATCHING, calls_per_turn: 3.4, all_turns: 400, ctx_re_read_tokens: 20_000_000,
  });
  const verdict = checkBudget('batching', bill, { baseline: { phases: {}, total: {}, batching: BASE_BATCHING } });
  assert.deepStrictEqual(verdict.regressions, [], 'fewer turns and denser calls is the goal, not a failure');
});

test('small moves stay inside the tolerance band', () => {
  const bill = billWithBatching({ ...BASE_BATCHING, calls_per_turn: 2.3, ctx_re_read_tokens: 55_000_000 });
  const verdict = checkBudget('batching', bill, { baseline: { phases: {}, total: {}, batching: BASE_BATCHING } });
  assert.deepStrictEqual(verdict.regressions, [], 'turn-level variance must not flake the ratchet');
});

test('a baseline recorded before batching was measured is skipped, not failed', () => {
  const bill = billWithBatching({ ...BASE_BATCHING, calls_per_turn: 0.1 });
  const verdict = checkBudget('batching', bill, { baseline: { phases: {}, total: {} } });
  assert.deepStrictEqual(verdict.regressions, []);
});

test('batching survives the baseline round-trip through disk', () => {
  const dir = tmpDir();
  const bill = billWithBatching(BASE_BATCHING);
  writeBaseline('roundtrip', bill, dir, { expectPhases: ['sprint', 'auto'] });
  assert.deepStrictEqual(readBaseline('roundtrip', dir).batching, BASE_BATCHING,
    'a ratchet metric that does not survive the baseline file can never fire');
});
