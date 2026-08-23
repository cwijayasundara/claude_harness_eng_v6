'use strict';

// The shape of a REAL hook payload, captured from three live subagent writes on
// 2026-08-22 and one main-loop write in the same session.
//
// Both new hooks originally decided "am I inside a subagent?" by testing
// `transcript_path` for `/subagents/`. A subagent's tool call reports the
// PARENT session's transcript, so that test was ALWAYS false and both hooks
// were inert — the same defect class as matching on `"Task"` when the live tool
// name is `"Agent"`: a predicate never checked against a real payload.
//
// These fixtures are transcribed from the capture, so a future change to the
// predicate has to keep agreeing with what the runtime actually sends.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { isSubagentCall, subagentTranscript } = require('../.claude/hooks/lib/subagent-tool.js');

const SESSION = '69ed6c91-8b77-4a34-93e5-3a5bd2c3a0fe';
const PROJECTS = '/Users/x/.claude/projects/-Users-x-repo';

// Captured verbatim: keys agent_id, agent_type, cwd, hook_event_name,
// permission_mode, prompt_id, session_id, tool_input, tool_name, tool_use_id,
// transcript_path. Note transcript_path is the PARENT's.
const SUBAGENT_PAYLOAD = Object.freeze({
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  agent_id: 'a903f01c6c876463e',
  agent_type: 'general-purpose',
  session_id: SESSION,
  transcript_path: `${PROJECTS}/${SESSION}.jsonl`,
  tool_input: { file_path: '/tmp/probe.txt', content: 'x' },
  permission_mode: 'default',
  prompt_id: 'p1',
  tool_use_id: 't1',
  cwd: '/repo',
});

// Captured verbatim: carries `effort`, and NEITHER agent_id NOR agent_type.
const MAIN_LOOP_PAYLOAD = Object.freeze({
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  effort: 'high',
  session_id: SESSION,
  transcript_path: `${PROJECTS}/${SESSION}.jsonl`,
  tool_input: { file_path: '/repo/src/a.py', content: 'x' },
  permission_mode: 'default',
  prompt_id: 'p1',
  tool_use_id: 't1',
  cwd: '/repo',
});

test('a real subagent payload is detected, and the main loop is not', () => {
  assert.equal(isSubagentCall(SUBAGENT_PAYLOAD), true);
  assert.equal(isSubagentCall(MAIN_LOOP_PAYLOAD), false);
  assert.equal(isSubagentCall({}), false);
  assert.equal(isSubagentCall(null), false);
});

test('transcript_path is NOT a subagent discriminator — this is the inert-hook trap', () => {
  // Both payloads carry the SAME transcript_path. Any predicate that reads it
  // to answer "am I in a subagent?" cannot distinguish them, which is exactly
  // how both hooks came to be inert.
  assert.equal(SUBAGENT_PAYLOAD.transcript_path, MAIN_LOOP_PAYLOAD.transcript_path);
  assert.ok(!/[/\\]subagents[/\\]/.test(SUBAGENT_PAYLOAD.transcript_path),
    'a real subagent payload never reports a /subagents/ transcript path');
});

test("the subagent's OWN transcript is derived from session_id + agent_id", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-shape-'));
  const subDir = path.join(dir, SESSION, 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  const own = path.join(subDir, 'agent-a903f01c6c876463e.jsonl');
  fs.writeFileSync(own, '{}\n');

  const payload = { ...SUBAGENT_PAYLOAD, transcript_path: path.join(dir, `${SESSION}.jsonl`) };
  assert.equal(subagentTranscript(payload), own,
    'measuring the parent context instead would read the wrong agent entirely');
});

test('a NAMED agent resolves by the same exact filename rule', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-shape-'));
  const subDir = path.join(dir, SESSION, 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  // Real filename observed for a named agent; its agent_id is the same stem,
  // so the exact rule covers it and no fuzzy matching is needed.
  const named = path.join(subDir, 'agent-avacuity-audit-b570096b7f21f346.jsonl');
  fs.writeFileSync(named, '{}\n');

  const payload = {
    ...SUBAGENT_PAYLOAD,
    agent_id: 'avacuity-audit-b570096b7f21f346',
    transcript_path: path.join(dir, `${SESSION}.jsonl`),
  };
  assert.equal(subagentTranscript(payload), named);
});

test('an unresolvable transcript yields null so the caller fails open', () => {
  assert.equal(subagentTranscript(MAIN_LOOP_PAYLOAD), null, 'the main loop has no subagent transcript');
  assert.equal(subagentTranscript({ ...SUBAGENT_PAYLOAD, transcript_path: '' }), null);
  assert.equal(subagentTranscript({ ...SUBAGENT_PAYLOAD, session_id: '' }), null);
  assert.equal(subagentTranscript({
    ...SUBAGENT_PAYLOAD, transcript_path: '/nonexistent/x.jsonl',
  }), null, 'a missing subagents directory must not throw');
});
