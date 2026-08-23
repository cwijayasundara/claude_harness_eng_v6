'use strict';

// Turn-shape, batching and cache profiling — the "what shape were the turns"
// half of phase-cost, split from phase-cost.test.js when that file crossed its
// 500-line cap. The attribution half stays there; this follows the module split
// in .claude/hooks/lib/phase-cost-profile.js.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { writeTranscript, userTurn } = require('./helpers/transcript-fixture.js');
const { turnProfile } = require('../.claude/hooks/lib/phase-cost-profile.js');

// ── The block-line shape a REAL transcript has ──────────────────────────────
//
// One assistant message is written once PER CONTENT BLOCK, each line repeating
// the same usage. The `ctxTurn` fixture above puts every block in ONE line — a
// shape no real transcript has — so the tool counter could read the thinking
// line, report zero tools, and stay green. It did: turnProfile reported /auto
// as "5 turns, 100% toolless" for a phase that really ran 574 turns at 1.32
// tool calls each, hiding the harness's largest cost driver.

/** One assistant turn, split across block-lines the way the real writer does. */
function blockLines(ts, id, cacheRead, toolNames, { sidechain = false } = {}) {
  const usage = { input_tokens: 0, output_tokens: 10, cache_read_input_tokens: cacheRead };
  const line = (content) => ({
    type: 'assistant', isSidechain: sidechain, timestamp: ts, requestId: id,
    message: { id, model: 'claude-sonnet-5', usage, content: [content] },
  });
  return [
    line({ type: 'thinking', thinking: 'considering' }),
    ...toolNames.map((name, i) => line({ type: 'tool_use', name, id: `${id}-t${i}`, input: {} })),
  ];
}

test('tool calls split across block-lines are counted, not lost to dedup', () => {
  const file = writeTranscript([
    userTurn('2026-08-02T07:00:00.000Z', '<command-name>/auto</command-name>'),
    ...blockLines('2026-08-02T07:01:00.000Z', 'a1', 100000, ['Bash']),
    ...blockLines('2026-08-02T07:02:00.000Z', 'a2', 100000, ['Read', 'Read', 'Read']),
  ]);
  const [auto] = turnProfile(file).filter((r) => r.command === 'auto');
  assert.strictEqual(auto.turns, 2, 'block-lines of one message are ONE turn');
  assert.strictEqual(auto.tool_calls, 4, 'a turn calling 3 tools contributes 3, not 1 and not 0');
  assert.strictEqual(auto.toolless, 0, 'neither turn was conversation');
  assert.strictEqual(auto.single_call_turns, 1);
});

test('usage is still counted once per message, not once per block-line', () => {
  const file = writeTranscript([
    userTurn('2026-08-02T07:00:00.000Z', '<command-name>/auto</command-name>'),
    ...blockLines('2026-08-02T07:01:00.000Z', 'a1', 100000, ['Bash', 'Bash', 'Bash', 'Bash']),
  ]);
  const [auto] = turnProfile(file).filter((r) => r.command === 'auto');
  assert.strictEqual(auto.ctx_total, 100000,
    'five block-lines of one 100K turn must bill 100K, not 500K');
});

test('batching statistics span subagent turns, which are where /auto spends', () => {
  const file = writeTranscript([
    userTurn('2026-08-02T07:00:00.000Z', '<command-name>/auto</command-name>'),
    ...blockLines('2026-08-02T07:01:00.000Z', 'm1', 60000, []),
    ...blockLines('2026-08-02T07:02:00.000Z', 's1', 200000, ['Bash'], { sidechain: true }),
    ...blockLines('2026-08-02T07:03:00.000Z', 's2', 210000, ['Bash'], { sidechain: true }),
    ...blockLines('2026-08-02T07:04:00.000Z', 's3', 220000, ['Read', 'Read'], { sidechain: true }),
  ]);
  const [auto] = turnProfile(file).filter((r) => r.command === 'auto');
  assert.strictEqual(auto.turns, 1, 'the ctx curve still covers main-loop turns only');
  assert.strictEqual(auto.subagent_turns, 3);
  assert.strictEqual(auto.all_turns, 4);
  assert.strictEqual(auto.tool_calls, 4);
  assert.strictEqual(auto.calls_per_turn, 1);
  assert.strictEqual(auto.single_call_pct, 50, 'two of four turns issued exactly one call');
  // ctx_total is main-loop only (60000). all_ctx_total is what the phase really
  // re-read: reporting the former as the phase's cost understated /auto by more
  // than 100x, since 5 of its 574 turns were in the main loop.
  assert.strictEqual(auto.ctx_total, 60000);
  assert.strictEqual(auto.all_ctx_total, 60000 + 200000 + 210000 + 220000);
});

test('two agents holding the same message id are not merged into one turn', () => {
  // Merge identity is (source, id), not id alone. Subagent transcripts are
  // pooled into the dispatching phase, so an id collision across files would
  // silently collapse two agents' turns into one and undercount the phase.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-phase-cost-'));
  const main = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(main, `${[
    userTurn('2026-08-02T07:00:00.000Z', '<command-name>/auto</command-name>'),
    ...blockLines('2026-08-02T07:01:00.000Z', 'm1', 60000, []),
  ].map((r) => JSON.stringify(r)).join('\n')}\n`);

  const agentLines = (ts) => blockLines(ts, 'SHARED-ID', 100000, ['Bash'], { sidechain: true })
    .map((r) => JSON.stringify(r)).join('\n');
  const a = path.join(dir, 'agent-a.jsonl');
  const b = path.join(dir, 'agent-b.jsonl');
  fs.writeFileSync(a, `${agentLines('2026-08-02T07:02:00.000Z')}\n`);
  fs.writeFileSync(b, `${agentLines('2026-08-02T07:03:00.000Z')}\n`);

  const [auto] = turnProfile(main, { extraTranscripts: [a, b] }).filter((r) => r.command === 'auto');
  assert.strictEqual(auto.subagent_turns, 2, 'each agent contributes its own turn');
  assert.strictEqual(auto.tool_calls, 2);
  assert.strictEqual(auto.all_ctx_total, 60000 + 100000 + 100000,
    'both agents re-read their context; merging them would hide one');
});

test('a phase that batches well is distinguishable from one that does not', () => {
  const drip = writeTranscript([
    userTurn('2026-08-02T07:00:00.000Z', '<command-name>/auto</command-name>'),
    ...['d1', 'd2', 'd3', 'd4'].flatMap((id, i) =>
      blockLines(`2026-08-02T07:0${i + 1}:00.000Z`, id, 100000, ['Read'])),
  ]);
  const batched = writeTranscript([
    userTurn('2026-08-02T07:00:00.000Z', '<command-name>/auto</command-name>'),
    ...blockLines('2026-08-02T07:01:00.000Z', 'b1', 100000, ['Read', 'Read', 'Read', 'Read']),
  ]);
  const [a] = turnProfile(drip).filter((r) => r.command === 'auto');
  const [b] = turnProfile(batched).filter((r) => r.command === 'auto');
  assert.strictEqual(a.tool_calls, b.tool_calls, 'the same work');
  assert.strictEqual(a.single_call_pct, 100);
  assert.strictEqual(b.single_call_pct, 0);
  assert.ok(a.ctx_total > b.ctx_total * 3,
    `the drip re-reads its context per call (${a.ctx_total} vs ${b.ctx_total}) — that is the whole lever`);
});

// ── `--why`: the renderers a human actually reads ───────────────────────────
//
// Same reasoning as the table test above — a ReferenceError in a renderer once
// survived the whole suite, and `--why` added ~90 more lines of renderer with no
// coverage at all. These run the real CLI end to end.

test('--why renders the cache accounting, naming the misses and the idle gaps', () => {
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-why-'));
  const file = path.join(dir, 'transcript.jsonl');
  const turn = (ts, id, cr, cw) => ({
    type: 'assistant', isSidechain: false, timestamp: ts, requestId: id,
    message: {
      id, model: 'claude-sonnet-5',
      usage: {
        input_tokens: 0, output_tokens: 10, cache_read_input_tokens: cr, cache_creation_input_tokens: cw,
        cache_creation: { ephemeral_5m_input_tokens: cw, ephemeral_1h_input_tokens: 0 },
      },
      content: [{ type: 'tool_use', name: 'Bash', id: `${id}-t`, input: {} }],
    },
  });
  fs.writeFileSync(file, `${[
    userTurn('2026-08-21T07:00:00.000Z', '<command-name>/auto</command-name>'),
    turn('2026-08-21T07:01:00.000Z', 'a1', 0, 30000),          // cold start
    turn('2026-08-21T07:20:00.000Z', 'a2', 0, 250000),         // 19-min idle -> TTL expiry
  ].map((r) => JSON.stringify(r)).join('\n')}\n`);

  const out = execFileSync('node', [
    path.join(__dirname, '..', '.claude', 'scripts', 'phase-cost.js'), file, '--why',
  ], { encoding: 'utf8' });

  assert.match(out, /WHY — cache accounting/);
  assert.match(out, /mid-session cache expiry/);
  assert.match(out, /Idle seconds before each: 1140/, 'the gap that caused the miss is the actionable part');
  assert.match(out, /5-minute cache TTL/);
});

test('--why renders the batching table with a real single-call share', () => {
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-why-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, `${[
    userTurn('2026-08-21T07:00:00.000Z', '<command-name>/auto</command-name>'),
    ...blockLines('2026-08-21T07:01:00.000Z', 'a1', 100000, ['Bash']),
    ...blockLines('2026-08-21T07:02:00.000Z', 'a2', 100000, ['Read', 'Read', 'Read']),
  ].map((r) => JSON.stringify(r)).join('\n')}\n`);

  const out = execFileSync('node', [
    path.join(__dirname, '..', '.claude', 'scripts', 'phase-cost.js'), file, '--why',
  ], { encoding: 'utf8' });

  assert.match(out, /WHY — turn batching/);
  assert.match(out, /issued exactly ONE tool call/);
  assert.match(out, /1 of 2 turns \(50%\)/, 'the single-call share is the lever');
  assert.match(out, /0\.2M tokens re-read for 4 tool calls/);
});

test('--json carries both profiles so the numbers are machine-readable', () => {
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-why-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, `${[
    userTurn('2026-08-21T07:00:00.000Z', '<command-name>/auto</command-name>'),
    ...blockLines('2026-08-21T07:01:00.000Z', 'a1', 100000, ['Bash']),
  ].map((r) => JSON.stringify(r)).join('\n')}\n`);

  const out = execFileSync('node', [
    path.join(__dirname, '..', '.claude', 'scripts', 'phase-cost.js'), file, '--why', '--json',
  ], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.ok(Array.isArray(parsed.cache), '--why --json must carry the cache profile');
  assert.ok(Array.isArray(parsed.turns), '--why --json must carry the turn profile');
  assert.strictEqual(parsed.turns[0].tool_calls, 1);
});

test('a plain run emits neither WHY section', () => {
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-why-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, `${[
    userTurn('2026-08-21T07:00:00.000Z', '<command-name>/auto</command-name>'),
    ...blockLines('2026-08-21T07:01:00.000Z', 'a1', 100000, ['Bash']),
  ].map((r) => JSON.stringify(r)).join('\n')}\n`);
  const out = execFileSync('node', [
    path.join(__dirname, '..', '.claude', 'scripts', 'phase-cost.js'), file,
  ], { encoding: 'utf8' });
  assert.ok(!/WHY —/.test(out), '--why is opt-in');
});
