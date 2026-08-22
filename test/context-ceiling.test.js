'use strict';

// The context ceiling exists because cache reads are the integral of resident
// context over turns, and the audited E1-S1 implementer ran 208 turns from 18K
// to 324K for $16.87 — with only ~111K tokens of real content in it.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { test } = require('node:test');
const {
  decideCeiling, currentContext, contextOf, isHandoffPath, isNonSourcePath,
  SOFT_CEILING_TOKENS, HARD_CEILING_TOKENS,
} = require('../.claude/hooks/lib/context-ceiling.js');

const HOOK = path.join(__dirname, '..', '.claude', 'hooks', 'context-ceiling.js');

test('a subagent past the hard ceiling is told to hand off', () => {
  const v = decideCeiling({ context: 324000, isSubagent: true });
  assert.equal(v.level, 'hard');
  assert.match(v.message, /324K/);
  assert.match(v.message, /handoff/);
  assert.match(v.message, /RETURN to your lead/);
});

test('the soft ceiling warns without refusing', () => {
  const v = decideCeiling({ context: SOFT_CEILING_TOKENS + 1, isSubagent: true });
  assert.equal(v.level, 'soft');
  assert.match(v.message, /approaching/);
});

test('a small context is untouched', () => {
  assert.equal(decideCeiling({ context: 18000, isSubagent: true }).level, 'ok');
});

test('the main loop is exempt — it has /clear and a human', () => {
  assert.equal(decideCeiling({ context: 500000, isSubagent: false }).level, 'ok');
});

test('writing the handoff itself is never refused, at any size', () => {
  const v = decideCeiling({ context: 900000, isSubagent: true, writingHandoff: true });
  assert.equal(v.level, 'ok', 'refusing the handoff write would strand the work it exists to carry');
});

test('an unreadable context yields no verdict rather than a block', () => {
  assert.equal(decideCeiling({ context: null, isSubagent: true }).level, 'ok');
});

test('contextOf sums everything the request had to carry', () => {
  assert.equal(contextOf({ cache_read_input_tokens: 300000, cache_creation_input_tokens: 20000, input_tokens: 2 }), 320002);
  assert.equal(contextOf({ output_tokens: 500 }), null, 'output is not resident context');
  assert.equal(contextOf(null), null);
});

test('isHandoffPath recognises the note and nothing else', () => {
  assert.equal(isHandoffPath('/w/.claude/state/handoff/E1-S1.md'), true);
  assert.equal(isHandoffPath('/w/backend/src/services/auth.py'), false);
});

test('the ceiling governs SOURCE writes only, as implementer.md and HARNESS.md promise', () => {
  // Blocking every write past 200K would strand a different job entirely: an
  // evaluator subagent past the ceiling could not write its specs/reviews/*.json
  // verdict, which a downstream gate then reads as missing evidence.
  for (const evidence of ['/w/specs/reviews/gate.json', '/w/docs/notes.md', '/w/.claude/state/x.json']) {
    assert.equal(isNonSourcePath(evidence), true, `${evidence} is evidence or state, not product source`);
    assert.equal(decideCeiling({ context: 900000, isSubagent: true, writingHandoff: isNonSourcePath(evidence) }).level,
      'ok', `${evidence} must stay writable past the ceiling`);
  }
  for (const source of ['/w/backend/src/services/auth.py', '/w/frontend/src/App.tsx']) {
    assert.equal(isNonSourcePath(source), false);
    assert.equal(decideCeiling({ context: 900000, isSubagent: true, writingHandoff: isNonSourcePath(source) }).level,
      'hard', `${source} is what the ceiling exists to stop`);
  }
});

test('currentContext reads the NEWEST usage from a transcript tail', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-ceiling-'));
  const file = path.join(dir, 'agent.jsonl');
  const turn = (id, cr) => JSON.stringify({
    type: 'assistant',
    message: { id: `m${id}`, model: 'claude-sonnet-5', usage: { input_tokens: 2, cache_read_input_tokens: cr, output_tokens: 5 } },
  });
  fs.writeFileSync(file, `${[turn(1, 18000), turn(2, 140000), turn(3, 323623)].join('\n')}\n`);
  assert.equal(currentContext(file), 323625);
});

test('currentContext survives a tail that starts mid-line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-ceiling-'));
  const file = path.join(dir, 'agent.jsonl');
  const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(400 * 1024) } });
  const last = JSON.stringify({
    type: 'assistant', message: { id: 'm9', usage: { cache_read_input_tokens: 250000, input_tokens: 2 } },
  });
  fs.writeFileSync(file, `${filler}\n${last}\n`);
  assert.equal(currentContext(file), 250002, 'a truncated leading line must not abort the scan');
});

test('currentContext returns null for a missing or usage-free transcript', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-ceiling-'));
  assert.equal(currentContext(path.join(dir, 'nope.jsonl')), null);
  const empty = path.join(dir, 'empty.jsonl');
  fs.writeFileSync(empty, `${JSON.stringify({ type: 'user', message: { content: 'hi' } })}\n`);
  assert.equal(currentContext(empty), null);
});

// ── hook wrapper ────────────────────────────────────────────────────────────

function transcriptAt(ctx) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-hook-'));
  const sub = path.join(dir, 'sess', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const file = path.join(sub, 'agent-a1.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({
    type: 'assistant', message: { id: 'm1', usage: { cache_read_input_tokens: ctx, input_tokens: 0 } },
  })}\n`);
  return file;
}

// spawnSync, not execFileSync: the soft ceiling exits 0 AND writes to stderr,
// and execFileSync surfaces stderr only on a throw — so a success-path warning
// would be invisible and the soft-ceiling assertion would pass vacuously.
function runHook(payload) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr || '' };
}

const write = (transcriptPath, filePath) => ({
  hook_event_name: 'PreToolUse', tool_name: 'Write', transcript_path: transcriptPath,
  tool_input: { file_path: filePath, content: 'x' },
});

test('the hook refuses a source write past the hard ceiling', () => {
  const r = runHook(write(transcriptAt(HARD_CEILING_TOKENS + 1), '/w/backend/src/auth.py'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /hand-off ceiling/);
});

test('the hook allows the handoff write past the hard ceiling', () => {
  const r = runHook(write(transcriptAt(400000), '/w/.claude/state/handoff/E1-S1.md'));
  assert.equal(r.status, 0, 'the escape must stay open');
});

test('the hook allows an evaluator verdict past the hard ceiling', () => {
  const r = runHook(write(transcriptAt(400000), '/w/specs/reviews/gate.json'));
  assert.equal(r.status, 0, 'refusing evidence would break a downstream gate, not save money');
});

test('the hook warns but allows at the soft ceiling', () => {
  const r = runHook(write(transcriptAt(SOFT_CEILING_TOKENS + 1), '/w/backend/src/auth.py'));
  assert.equal(r.status, 0);
  assert.match(r.stderr, /approaching/);
});

test('the hook ignores the main loop entirely', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-hook-main-'));
  const file = path.join(dir, 'sess.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({
    type: 'assistant', message: { id: 'm1', usage: { cache_read_input_tokens: 900000 } },
  })}\n`);
  assert.equal(runHook(write(file, '/w/backend/src/auth.py')).status, 0);
});

test('the hook fails open on malformed stdin', () => {
  try {
    execFileSync('node', [HOOK], { input: 'not json', encoding: 'utf8' });
  } catch (err) { assert.fail(`must exit 0, got ${err.status}`); }
});
