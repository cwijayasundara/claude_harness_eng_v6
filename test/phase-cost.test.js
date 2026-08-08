/**
 * Per-phase cost attribution.
 *
 * The harness telemetry ledger records no tokens and, on a real run, covered
 * 8.8 of ~30 hours — the two most expensive planning phases recorded nothing.
 * The transcript does carry every slash-command invocation and every usage
 * block, so phase attribution is recoverable from it alone, retroactively and
 * with no collector.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const {
  segmentsFromTranscript, costByPhase, subagentTranscriptsFor,
} = require('../.claude/scripts/phase-cost.js');

function writeTranscript(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-phase-cost-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

const userTurn = (ts, text, isSidechain = false) => ({
  type: 'user', isSidechain, timestamp: ts, message: { content: text },
});

const assistantTurn = (ts, id, model, output) => ({
  type: 'assistant', isSidechain: false, timestamp: ts, requestId: id,
  message: { id, model, usage: { input_tokens: 0, output_tokens: output } },
});

test('extracts slash-command segments in order with start timestamps', () => {
  const file = writeTranscript([
    userTurn('2026-08-02T07:00:00.000Z', '/brd --frd prd/x.md'),
    assistantTurn('2026-08-02T07:30:00.000Z', 'a1', 'claude-opus-5', 100),
    userTurn('2026-08-02T09:00:00.000Z', '/spec'),
    assistantTurn('2026-08-02T09:30:00.000Z', 'a2', 'claude-opus-5', 200),
  ]);
  const segs = segmentsFromTranscript(file);
  assert.strictEqual(segs.length, 2);
  assert.strictEqual(segs[0].command, 'brd');
  assert.strictEqual(segs[1].command, 'spec');
  assert.strictEqual(segs[0].end, segs[1].start, 'a phase ends where the next begins');
});

test('recognises the <command-name> wrapper form and strips any plugin prefix', () => {
  const file = writeTranscript([
    userTurn('2026-08-02T06:00:00.000Z',
      '<command-message>scaffold</command-message> <command-name>claude_harness_eng_v5:scaffold</command-name>'),
    assistantTurn('2026-08-02T06:10:00.000Z', 'a1', 'claude-sonnet-5', 10),
  ]);
  const segs = segmentsFromTranscript(file);
  assert.strictEqual(segs.length, 1);
  assert.strictEqual(segs[0].command, 'scaffold');
});

test('ignores sidechain user turns — a subagent prompt is not a new phase', () => {
  const file = writeTranscript([
    userTurn('2026-08-02T07:00:00.000Z', '/spec'),
    userTurn('2026-08-02T07:05:00.000Z', '/implement', true),
    assistantTurn('2026-08-02T07:30:00.000Z', 'a1', 'claude-opus-5', 100),
  ]);
  const segs = segmentsFromTranscript(file);
  assert.strictEqual(segs.length, 1);
  assert.strictEqual(segs[0].command, 'spec');
});

test('freeform prose never opens a named command phase', () => {
  const file = writeTranscript([
    userTurn('2026-08-02T07:00:00.000Z', 'please look at the spec and tell me what you think'),
    assistantTurn('2026-08-02T07:30:00.000Z', 'a1', 'claude-opus-5', 100),
  ]);
  const segs = segmentsFromTranscript(file);
  assert.deepStrictEqual(segs.map((s) => s.command), ['(freeform)'],
    'prose is bucketed, never mistaken for a command');
});

test('attributes real token spend and cost to each phase', () => {
  const file = writeTranscript([
    userTurn('2026-08-02T07:00:00.000Z', '/brd'),
    assistantTurn('2026-08-02T07:30:00.000Z', 'a1', 'claude-opus-5', 1e6),
    userTurn('2026-08-02T09:00:00.000Z', '/spec'),
    assistantTurn('2026-08-02T09:30:00.000Z', 'a2', 'claude-sonnet-5', 1e6),
  ]);
  const rows = costByPhase(file);
  const brd = rows.find((r) => r.command === 'brd');
  const spec = rows.find((r) => r.command === 'spec');
  assert.strictEqual(brd.output_tokens, 1e6);
  assert.strictEqual(brd.model, 'claude-opus-5');
  assert.strictEqual(Math.round(brd.cost_usd), 25, 'opus output is $25/1M');
  assert.strictEqual(Math.round(spec.cost_usd), 15, 'sonnet output is $15/1M');
});

test('a phase spanning repeated lines of one message is not double counted', () => {
  const dup = assistantTurn('2026-08-02T07:30:00.000Z', 'a1', 'claude-opus-5', 500);
  const file = writeTranscript([
    userTurn('2026-08-02T07:00:00.000Z', '/spec'),
    dup, dup, dup,
  ]);
  const rows = costByPhase(file);
  assert.strictEqual(rows[0].output_tokens, 500);
});

test('missing transcript yields no segments rather than throwing', () => {
  assert.deepStrictEqual(segmentsFromTranscript('/nope/missing.jsonl'), []);
  assert.deepStrictEqual(costByPhase('/nope/missing.jsonl'), []);
});

test('Claude Code built-ins do not open a phase — they would swallow the bill', () => {
  // Observed live: /clear and /model absorbed $936 of unrelated conversational
  // work because each opened a segment that ran until the next command.
  const file = writeTranscript([
    userTurn('2026-08-02T07:00:00.000Z', '/spec'),
    assistantTurn('2026-08-02T07:10:00.000Z', 'a1', 'claude-opus-5', 100),
    userTurn('2026-08-02T08:00:00.000Z', '/clear'),
    assistantTurn('2026-08-02T08:10:00.000Z', 'a2', 'claude-opus-5', 900),
  ]);
  const segs = segmentsFromTranscript(file);
  assert.deepStrictEqual(segs.map((s) => s.command), ['spec'],
    '/clear is a built-in, not a harness phase');
  const rows = costByPhase(file);
  assert.strictEqual(rows[0].output_tokens, 1000,
    'work after a built-in stays with the phase that was running');
});

test('work before any command is bucketed as freeform, not dropped', () => {
  const file = writeTranscript([
    userTurn('2026-08-02T07:00:00.000Z', 'just chatting about the design'),
    assistantTurn('2026-08-02T07:10:00.000Z', 'a1', 'claude-opus-5', 300),
    userTurn('2026-08-02T08:00:00.000Z', '/spec'),
    assistantTurn('2026-08-02T08:10:00.000Z', 'a2', 'claude-opus-5', 100),
  ]);
  const rows = costByPhase(file);
  const freeform = rows.find((r) => r.command === '(freeform)');
  assert.ok(freeform, 'pre-command work is reported rather than silently discarded');
  assert.strictEqual(freeform.output_tokens, 300);
  assert.strictEqual(rows.find((r) => r.command === 'spec').output_tokens, 100);
});

test('discovers subagent transcripts beside the session transcript', () => {
  // The durable location is a sibling directory of the transcript being read:
  //   <projects>/<slug>/<sessionUuid>/subagents/agent-*.jsonl
  // Searching a temp path keyed on a different uuid found nothing while these
  // files sat next to the transcript, undercounting a real session by 46% and
  // blaming "cleaned temp files" for it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-discovery-'));
  const session = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const transcript = path.join(dir, `${session}.jsonl`);
  fs.writeFileSync(transcript, '');
  const subagents = path.join(dir, session, 'subagents');
  fs.mkdirSync(subagents, { recursive: true });
  fs.writeFileSync(path.join(subagents, 'agent-abc123.jsonl'), '');
  // Non-agent files in the same tree must not be counted as subagent work.
  fs.writeFileSync(path.join(subagents, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(subagents, 'bash-output.output'), 'x');

  const found = subagentTranscriptsFor(transcript);
  assert.strictEqual(found.length, 1, `expected exactly one agent transcript, got ${JSON.stringify(found)}`);
  assert.match(found[0], /agent-abc123\.jsonl$/);
});

test('discovery returns empty rather than throwing when no subagents ran', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-discovery-none-'));
  const transcript = path.join(dir, 'ffffffff-0000-0000-0000-000000000000.jsonl');
  fs.writeFileSync(transcript, '');
  assert.deepStrictEqual(subagentTranscriptsFor(transcript), []);
});

test('a turn exactly on a phase boundary is billed once, not to both phases', () => {
  // Segment N's `until` is segment N+1's `since`. With both bounds inclusive a
  // boundary turn was counted twice, and dedup could not catch it because each
  // segment is a separate pass.
  const boundary = '2026-08-02T09:00:00.000Z';
  const file = writeTranscript([
    userTurn('2026-08-02T07:00:00.000Z', '/brd'),
    assistantTurn('2026-08-02T08:00:00.000Z', 'a1', 'claude-opus-5', 100),
    assistantTurn(boundary, 'boundary', 'claude-opus-5', 1000),
    userTurn(boundary, '/spec'),
    assistantTurn('2026-08-02T10:00:00.000Z', 'a2', 'claude-opus-5', 10),
  ]);
  const rows = costByPhase(file);
  const total = rows.reduce((sum, r) => sum + r.output_tokens, 0);
  assert.strictEqual(total, 1110, 'the boundary turn must be counted exactly once across all phases');
});

test('excludes <synthetic> turns — they are not a billable model', () => {
  const file = writeTranscript([
    userTurn('2026-08-02T07:00:00.000Z', '/spec'),
    assistantTurn('2026-08-02T07:10:00.000Z', 'a1', 'claude-opus-5', 100),
    assistantTurn('2026-08-02T07:20:00.000Z', 's1', '<synthetic>', 0),
  ]);
  const rows = costByPhase(file);
  assert.strictEqual(rows[0].messages, 1, 'synthetic turns are not counted as messages');
  assert.ok(!('<synthetic>' in rows[0].by_model), 'synthetic never appears as a model');
});

test('pools subagent transcripts into the phase window that dispatched them', () => {
  const main = writeTranscript([
    userTurn('2026-08-02T07:00:00.000Z', '/brd'),
    assistantTurn('2026-08-02T07:10:00.000Z', 'a1', 'claude-opus-5', 100),
    userTurn('2026-08-02T09:00:00.000Z', '/spec'),
    assistantTurn('2026-08-02T09:10:00.000Z', 'a2', 'claude-opus-5', 200),
  ]);
  // A subagent dispatched during /spec, living in its own transcript file.
  const sub = writeTranscript([
    assistantTurn('2026-08-02T09:30:00.000Z', 'sub1', 'claude-sonnet-5', 5000),
  ]);
  const rows = costByPhase(main, { extraTranscripts: [sub] });
  const brd = rows.find((r) => r.command === 'brd');
  const spec = rows.find((r) => r.command === 'spec');
  assert.strictEqual(brd.output_tokens, 100, 'subagent spend does not leak into an earlier phase');
  assert.strictEqual(spec.output_tokens, 5200, 'subagent output lands in the dispatching phase');
  assert.strictEqual(spec.subagent_output_tokens, 5000, 'subagent share is reported separately');
});

const { unpricedNote } = require('../.claude/scripts/phase-cost.js');

// The note is production output whose whole purpose is that a guess is visible.
// Computing it and never rendering it is the same silence it exists to break,
// so the surfacing needs a test of its own, not just the underlying field.
test('the unpriced-model note names each model once and is silent when all are priced', () => {
  assert.deepStrictEqual(unpricedNote([{ unpriced_models: [] }, {}]), []);
  const note = unpricedNote([
    { unpriced_models: ['claude-nextgen-9'] },
    { unpriced_models: ['claude-nextgen-9', 'some-other'] },
  ]);
  assert.strictEqual(note.length, 2, 'one headline plus one remedy line');
  assert.match(note[0], /claude-nextgen-9/);
  assert.match(note[0], /some-other/);
  assert.strictEqual((note[0].match(/claude-nextgen-9/g) || []).length, 1, 'deduplicated');
  assert.match(note[1], /model-pricing\.js/, 'must say where to add the price');
});
