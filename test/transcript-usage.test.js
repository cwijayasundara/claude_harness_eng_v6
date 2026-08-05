/**
 * Transcript-derived token usage.
 *
 * Hook payloads carry NO token/cost/model data (Claude Code documents only
 * session_id, prompt_id, transcript_path, cwd, permission_mode, effort,
 * hook_event_name as common fields). The one usable handle is transcript_path,
 * so real metering has to come from the transcript JSONL.
 *
 * The load-bearing invariant here is DEDUP: a single assistant message is
 * written to the transcript once per content block, and every one of those
 * lines repeats the SAME usage object. Summing lines instead of messages
 * overcounts (measured ~68% inflation on a real 1661-line transcript).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { usageFromTranscript } = require('../.claude/hooks/lib/transcript-usage');

function writeTranscript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-transcript-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return file;
}

function assistant({ id, requestId, model = 'claude-sonnet-5', ts, usage, isSidechain = false }) {
  return {
    type: 'assistant',
    isSidechain,
    requestId,
    timestamp: ts,
    message: { id, model, usage },
  };
}

const U = (input, output, cacheRead = 0, cacheCreate = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheCreate,
});

test('missing or unreadable transcript returns a zeroed result, never throws', () => {
  const res = usageFromTranscript('/nonexistent/path/transcript.jsonl');
  assert.strictEqual(res.messages, 0);
  assert.strictEqual(res.input_tokens, 0);
  assert.strictEqual(res.output_tokens, 0);
  assert.strictEqual(res.model, null);
});

test('sums input/output/cache tokens across distinct assistant messages', () => {
  const file = writeTranscript([
    assistant({ id: 'm1', requestId: 'r1', ts: '2026-08-05T10:00:00.000Z', usage: U(10, 100, 1000, 50) }),
    assistant({ id: 'm2', requestId: 'r2', ts: '2026-08-05T10:01:00.000Z', usage: U(20, 200, 2000, 60) }),
  ]);
  const res = usageFromTranscript(file);
  assert.strictEqual(res.messages, 2);
  assert.strictEqual(res.input_tokens, 30);
  assert.strictEqual(res.output_tokens, 300);
  assert.strictEqual(res.cache_read_tokens, 3000);
  assert.strictEqual(res.cache_creation_tokens, 110);
});

test('deduplicates repeated lines that share one message id — the overcount guard', () => {
  const usage = U(10, 100, 1000, 50);
  const file = writeTranscript([
    assistant({ id: 'm1', requestId: 'r1', ts: '2026-08-05T10:00:00.000Z', usage }),
    assistant({ id: 'm1', requestId: 'r1', ts: '2026-08-05T10:00:00.000Z', usage }),
    assistant({ id: 'm1', requestId: 'r1', ts: '2026-08-05T10:00:00.000Z', usage }),
  ]);
  const res = usageFromTranscript(file);
  assert.strictEqual(res.messages, 1, 'three lines of one message must count once');
  assert.strictEqual(res.input_tokens, 10);
  assert.strictEqual(res.output_tokens, 100);
  assert.strictEqual(res.cache_read_tokens, 1000);
});

test('ignores malformed lines, non-assistant lines, and messages with no usage', () => {
  const file = writeTranscript([
    '{ not json',
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { id: 'm0', model: 'claude-sonnet-5' } }),
    assistant({ id: 'm1', requestId: 'r1', ts: '2026-08-05T10:00:00.000Z', usage: U(5, 50) }),
  ]);
  const res = usageFromTranscript(file);
  assert.strictEqual(res.messages, 1);
  assert.strictEqual(res.output_tokens, 50);
});

test('breaks usage down per model and reports the dominant model', () => {
  const file = writeTranscript([
    assistant({ id: 'm1', requestId: 'r1', model: 'claude-opus-5', ts: '2026-08-05T10:00:00.000Z', usage: U(0, 900) }),
    assistant({ id: 'm2', requestId: 'r2', model: 'claude-sonnet-5', ts: '2026-08-05T10:01:00.000Z', usage: U(0, 100) }),
  ]);
  const res = usageFromTranscript(file);
  assert.strictEqual(res.by_model['claude-opus-5'].output_tokens, 900);
  assert.strictEqual(res.by_model['claude-sonnet-5'].output_tokens, 100);
  assert.strictEqual(res.model, 'claude-opus-5', 'dominant model is the one with most output tokens');
});

test('windows by timestamp so a phase can be costed independently', () => {
  const file = writeTranscript([
    assistant({ id: 'm1', requestId: 'r1', ts: '2026-08-05T09:00:00.000Z', usage: U(0, 10) }),
    assistant({ id: 'm2', requestId: 'r2', ts: '2026-08-05T10:00:00.000Z', usage: U(0, 20) }),
    assistant({ id: 'm3', requestId: 'r3', ts: '2026-08-05T11:00:00.000Z', usage: U(0, 40) }),
  ]);
  const res = usageFromTranscript(file, {
    since: Date.parse('2026-08-05T09:30:00.000Z'),
    until: Date.parse('2026-08-05T10:30:00.000Z'),
  });
  assert.strictEqual(res.messages, 1);
  assert.strictEqual(res.output_tokens, 20);
});

test('separates sidechain (subagent) turns from main-loop turns', () => {
  const file = writeTranscript([
    assistant({ id: 'm1', requestId: 'r1', ts: '2026-08-05T10:00:00.000Z', usage: U(0, 10) }),
    assistant({ id: 'm2', requestId: 'r2', ts: '2026-08-05T10:01:00.000Z', usage: U(0, 90), isSidechain: true }),
  ]);
  const all = usageFromTranscript(file);
  assert.strictEqual(all.output_tokens, 100);
  assert.strictEqual(all.sidechain_output_tokens, 90, 'sidechain share is reported separately');

  const mainOnly = usageFromTranscript(file, { includeSidechain: false });
  assert.strictEqual(mainOnly.output_tokens, 10);
});

test('a dated model id is priced as its model, not silently as Opus', () => {
  // Real ids carry date suffixes (claude-haiku-4-5-20251001); MODEL_PRICE keys
  // do not. Falling through to the Opus default overpriced Haiku 5x, and the
  // report rendered the id with no indication a fallback had happened.
  const file = writeTranscript([
    assistant({
      id: 'm1', requestId: 'r1', model: 'claude-haiku-4-5-20251001',
      ts: '2026-08-05T10:00:00.000Z', usage: U(0, 1e6),
    }),
  ]);
  const res = usageFromTranscript(file);
  assert.strictEqual(Math.round(res.cost_usd), 5, 'haiku output is $5/1M, not opus $25/1M');
  assert.deepStrictEqual(res.unpriced_models, [], 'a dated id of a known model is not unpriced');
});

test('a genuinely unknown model is reported rather than silently defaulted', () => {
  const file = writeTranscript([
    assistant({ id: 'm1', requestId: 'r1', model: 'claude-nextgen-9', ts: '2026-08-05T10:00:00.000Z', usage: U(0, 10) }),
  ]);
  assert.deepStrictEqual(usageFromTranscript(file).unpriced_models, ['claude-nextgen-9']);
});

test('cache creation is priced at the 1.25x write rate, not the base input rate', () => {
  const file = writeTranscript([
    assistant({
      id: 'm1', requestId: 'r1', model: 'claude-opus-5',
      ts: '2026-08-05T10:00:00.000Z', usage: U(0, 0, 0, 1e6),
    }),
  ]);
  // Opus input $5/1M; a 5-minute cache write bills at 1.25x base.
  assert.strictEqual(Number(usageFromTranscript(file).cost_usd.toFixed(2)), 6.25);
});

test('prices usage per model so a phase cost is a number, not an estimate label', () => {
  const file = writeTranscript([
    assistant({ id: 'm1', requestId: 'r1', model: 'claude-opus-5', ts: '2026-08-05T10:00:00.000Z', usage: U(1e6, 1e6) }),
  ]);
  const res = usageFromTranscript(file);
  // Opus 5: $5/1M in, $25/1M out (docs/model-allocation.md).
  assert.strictEqual(Math.round(res.cost_usd), 30);
});
