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

const { writeSnapshot } = require('../.claude/hooks/lib/phase-cost-persist.js');

test('--write persists a rollup and a delta ledger row', () => {
  const file = writeTranscript([
    userTurn('2026-08-16T07:00:00.000Z', '/brd --prd docs/x.md'),
    assistantTurn('2026-08-16T07:30:00.000Z', 'a1', 'claude-opus-5', 1e6),
  ]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-cost-write-'));
  const first = writeSnapshot(root, {
    transcriptPath: file,
    step: 'brd-gates',
    event: 'step',
    sessionId: 's1',
  });
  assert.strictEqual(first.written, true);
  assert.strictEqual(first.rows[0].command, 'brd');
  assert.strictEqual(Math.round(first.grand_usd), 25);
  const latest = JSON.parse(fs.readFileSync(path.join(root, '.claude/state/phase-cost.json'), 'utf8'));
  assert.strictEqual(latest.step, 'brd-gates');
  const ledger = fs.readFileSync(path.join(root, '.claude/state/phase-cost.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(ledger.length, 1);
  assert.strictEqual(ledger[0].step, 'brd-gates');
  assert.strictEqual(Math.round(ledger[0].delta_usd), 25);

  const dup = writeSnapshot(root, {
    transcriptPath: file,
    step: 'brd-gates',
    event: 'step',
  });
  assert.strictEqual(dup.written, false, 'identical fingerprint is not double-logged');
  const still = fs.readFileSync(path.join(root, '.claude/state/phase-cost.jsonl'), 'utf8')
    .trim().split('\n');
  assert.strictEqual(still.length, 1);
});

test('a later persist records only the delta since the last write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-cost-delta-'));
  const file = path.join(dir, 't.jsonl');
  const rows = [
    userTurn('2026-08-16T07:00:00.000Z', '/brd'),
    assistantTurn('2026-08-16T07:10:00.000Z', 'a1', 'claude-opus-5', 1e6),
  ];
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-cost-delta-root-'));
  writeSnapshot(root, { transcriptPath: file, step: 'brd' });
  rows.push(userTurn('2026-08-16T09:00:00.000Z', '/spec'));
  rows.push(assistantTurn('2026-08-16T09:10:00.000Z', 'a2', 'claude-sonnet-5', 1e6));
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const second = writeSnapshot(root, { transcriptPath: file, step: 'spec' });
  assert.strictEqual(second.written, true);
  const ledger = fs.readFileSync(path.join(root, '.claude/state/phase-cost.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(ledger.length, 2);
  assert.strictEqual(Math.round(ledger[1].delta_usd), 15, 'only the spec increment');
  assert.strictEqual(Math.round(ledger[1].grand_usd), 40);
});

// The two --write tests above call writeSnapshot() in-process. The CLI is a
// different entry path — argument parsing, transcript discovery, the persist
// hop — and only a subprocess exercises it. This test was originally written to
// catch an export-ordering bug that made --write die on a require cycle; the
// cycle is gone now (the shared half lives in phase-cost-core.js), but the
// end-to-end CLI path is worth pinning on its own account.
test('the --write CLI persists from a cold process', () => {
  const { execFileSync } = require('child_process');
  const file = writeTranscript([
    userTurn('2026-08-16T07:00:00.000Z', '/spec'),
    assistantTurn('2026-08-16T07:30:00.000Z', 'a1', 'claude-opus-5', 1e6),
  ]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-cost-cli-'));
  const out = execFileSync('node', [
    path.join(__dirname, '..', '.claude', 'scripts', 'phase-cost.js'),
    file, '--write', '--step', 'spec-al', '--json',
  ], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(JSON.parse(out).step, 'spec-al');
  const ledger = fs.readFileSync(path.join(root, '.claude/state/phase-cost.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(ledger.length, 1);
  assert.strictEqual(ledger[0].step, 'spec-al', 'the ledger row carries the step label');
});


// The invariant the phase-cost-core.js split establishes. Nothing else would
// notice it being undone: re-adding `require('../../scripts/phase-cost.js')` to
// the persist lib re-forms the cycle, and every test here would stay green
// until someone ran the CLI — which is exactly how the original bug survived.
test('the persist lib does not require the CLI back', () => {
  const persist = fs.readFileSync(
    path.join(__dirname, '..', '.claude/hooks/lib/phase-cost-persist.js'), 'utf8',
  );
  assert.doesNotMatch(persist, /require\(['"][^'"]*scripts\/phase-cost(\.js)?['"]\)/,
    'the shared half belongs in phase-cost-core.js, not behind a cycle');
  assert.match(persist, /require\(['"]\.\/phase-cost-core\.js['"]\)/,
    'and it must actually use the core');
});


// The human-readable table had no test, so a ReferenceError in renderRow
// survived the full suite — the extraction moved FREEFORM into the core and
// only eslint noticed the renderer still referenced it. The default CLI mode is
// the table, so this is the path a human actually sees.
test('the CLI renders a table, including a pre-command (freeform) segment', () => {
  const { execFileSync } = require('child_process');
  const file = writeTranscript([
    userTurn('2026-08-16T06:00:00.000Z', 'just chatting, no slash command'),
    assistantTurn('2026-08-16T06:10:00.000Z', 'a0', 'claude-opus-5', 1e5),
    userTurn('2026-08-16T07:00:00.000Z', '/spec'),
    assistantTurn('2026-08-16T07:30:00.000Z', 'a1', 'claude-opus-5', 1e6),
  ]);
  const out = execFileSync('node', [
    path.join(__dirname, '..', '.claude', 'scripts', 'phase-cost.js'), file,
  ], { encoding: 'utf8' });
  // Line-anchored on purpose: an unbound FREEFORM makes the comparison false
  // and the renderer emits `/(freeform)`, which an unanchored /\(freeform\)/
  // still matches. The bug this test exists for would slip straight through.
  assert.match(out, /^\(freeform\)/m, 'the pre-command segment is labelled, not slash-prefixed');
  assert.match(out, /\/spec/);
  assert.match(out, /TOTAL/);
});

const { turnProfile } = require('../.claude/hooks/lib/phase-cost-core.js');

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
