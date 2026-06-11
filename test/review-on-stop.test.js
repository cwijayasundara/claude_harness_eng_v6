const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeHookProject, runHook } = require('./helpers/hook-fixture');

const HOOK = 'review-on-stop.js';

function writePending(projectDir, entries) {
  fs.writeFileSync(
    path.join(projectDir, '.claude', 'state', 'pending-reviews.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
  );
}

function writeTranscript(projectDir, messages) {
  const transcriptPath = path.join(projectDir, 'transcript.jsonl');
  fs.writeFileSync(transcriptPath, messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
  return transcriptPath;
}

function reviewerToolUse(toolName, subagentType, isoTs) {
  return {
    timestamp: isoTs,
    message: {
      content: [{ type: 'tool_use', name: toolName, input: { subagent_type: subagentType } }],
    },
  };
}

test('blocks the stop when pending files were never reviewed', async () => {
  const projectDir = makeHookProject([HOOK]);
  writePending(projectDir, [{ file: 'src/api.ts', ts: 1000 }]);
  const transcriptPath = writeTranscript(projectDir, [
    { timestamp: new Date(2000).toISOString(), message: { content: [{ type: 'text', text: 'done' }] } },
  ]);
  const result = await runHook(projectDir, HOOK, { transcript_path: transcriptPath });
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.decision, 'block');
  assert.ok(out.reason.includes('src/api.ts'));
});

test('does not block when a reviewer was spawned via the Task tool after the write', async () => {
  const projectDir = makeHookProject([HOOK]);
  writePending(projectDir, [{ file: 'src/api.ts', ts: 1000 }]);
  const transcriptPath = writeTranscript(projectDir, [
    reviewerToolUse('Task', 'clean-code-reviewer', new Date(2000).toISOString()),
    reviewerToolUse('Task', 'security-reviewer', new Date(2000).toISOString()),
  ]);
  const result = await runHook(projectDir, HOOK, { transcript_path: transcriptPath });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '', `expected no block, got: ${result.stdout}`);
});

test('does not block when a reviewer was spawned via the Agent tool after the write', async () => {
  const projectDir = makeHookProject([HOOK]);
  writePending(projectDir, [{ file: 'src/api.ts', ts: 1000 }]);
  const transcriptPath = writeTranscript(projectDir, [
    reviewerToolUse('Agent', 'security-reviewer', new Date(2000).toISOString()),
  ]);
  const result = await runHook(projectDir, HOOK, { transcript_path: transcriptPath });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '', `expected no block, got: ${result.stdout}`);
});

test('still blocks when the only reviewer run predates the pending write', async () => {
  const projectDir = makeHookProject([HOOK]);
  writePending(projectDir, [{ file: 'src/api.ts', ts: 5000 }]);
  const transcriptPath = writeTranscript(projectDir, [
    reviewerToolUse('Task', 'clean-code-reviewer', new Date(2000).toISOString()),
  ]);
  const result = await runHook(projectDir, HOOK, { transcript_path: transcriptPath });
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.decision, 'block');
});

function writeVerdicts(projectDir, names, mtimeMs) {
  const dir = path.join(projectDir, 'specs', 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, '{"verdict":"PASS"}');
    if (mtimeMs) fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
  }
}

test('stop_hook_active alone does not clear the queue — still blocks without review evidence', async () => {
  const projectDir = makeHookProject([HOOK]);
  writePending(projectDir, [{ file: 'src/api.ts', ts: 1000 }]);
  const transcriptPath = writeTranscript(projectDir, [
    { timestamp: new Date(2000).toISOString(), message: { content: [{ type: 'text', text: 'done' }] } },
  ]);
  const result = await runHook(projectDir, HOOK, { transcript_path: transcriptPath, stop_hook_active: true });
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.decision, 'block');
});

test('fresh verdict artifacts satisfy the gate without transcript evidence', async () => {
  const projectDir = makeHookProject([HOOK]);
  writePending(projectDir, [{ file: 'src/api.ts', ts: 1000 }]);
  writeVerdicts(projectDir, ['clean-code-verdict.json', 'security-verdict.json']); // mtime = now > ts
  const transcriptPath = writeTranscript(projectDir, [
    { timestamp: new Date(2000).toISOString(), message: { content: [{ type: 'text', text: 'done' }] } },
  ]);
  const result = await runHook(projectDir, HOOK, { transcript_path: transcriptPath, stop_hook_active: true });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '', `expected no block, got: ${result.stdout}`);
  const queue = fs.readFileSync(path.join(projectDir, '.claude', 'state', 'pending-reviews.jsonl'), 'utf8');
  assert.strictEqual(queue, '');
});

test('verdict artifacts older than the pending write do not satisfy the gate', async () => {
  const projectDir = makeHookProject([HOOK]);
  const now = Date.now();
  writePending(projectDir, [{ file: 'src/api.ts', ts: now }]);
  writeVerdicts(projectDir, ['clean-code-verdict.json', 'security-verdict.json'], now - 60000);
  const result = await runHook(projectDir, HOOK, { transcript_path: null });
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.decision, 'block');
});

test('a single verdict artifact is not enough — both reviewers must have run', async () => {
  const projectDir = makeHookProject([HOOK]);
  writePending(projectDir, [{ file: 'src/api.ts', ts: 1000 }]);
  writeVerdicts(projectDir, ['clean-code-verdict.json']);
  const result = await runHook(projectDir, HOOK, { transcript_path: null });
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.decision, 'block');
});

test('fails open loudly after the block budget is exhausted', async () => {
  const projectDir = makeHookProject([HOOK]);
  writePending(projectDir, [{ file: 'src/api.ts', ts: 1000 }]);
  fs.writeFileSync(path.join(projectDir, '.claude', 'state', 'review-block-count'), '3');
  const result = await runHook(projectDir, HOOK, { transcript_path: null, stop_hook_active: true });
  assert.strictEqual(result.status, 0);
  assert.ok(!result.stdout.startsWith('{'), `expected no block decision, got: ${result.stdout}`);
  assert.ok(result.stdout.includes('failed open'), result.stdout);
  assert.ok(result.stdout.includes('src/api.ts'), result.stdout);
  const queue = fs.readFileSync(path.join(projectDir, '.claude', 'state', 'pending-reviews.jsonl'), 'utf8');
  assert.strictEqual(queue, '');
  const count = fs.readFileSync(path.join(projectDir, '.claude', 'state', 'review-block-count'), 'utf8').trim();
  assert.strictEqual(count, '0');
  const errLog = fs.readFileSync(path.join(projectDir, '.claude', 'state', 'hook-errors.log'), 'utf8');
  assert.ok(errLog.includes('failed open'), errLog);
});

test('block counter resets once the gate is satisfied', async () => {
  const projectDir = makeHookProject([HOOK]);
  writePending(projectDir, [{ file: 'src/api.ts', ts: 1000 }]);
  fs.writeFileSync(path.join(projectDir, '.claude', 'state', 'review-block-count'), '2');
  const transcriptPath = writeTranscript(projectDir, [
    reviewerToolUse('Task', 'clean-code-reviewer', new Date(2000).toISOString()),
  ]);
  const result = await runHook(projectDir, HOOK, { transcript_path: transcriptPath });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
  const count = fs.readFileSync(path.join(projectDir, '.claude', 'state', 'review-block-count'), 'utf8').trim();
  assert.strictEqual(count, '0');
});

test('surfaces new hook-errors.log entries as an advisory, once', async () => {
  const projectDir = makeHookProject([HOOK]);
  fs.writeFileSync(
    path.join(projectDir, '.claude', 'state', 'hook-errors.log'),
    '2026-06-11T00:00:00Z pre-commit: uv exploded\n'
  );
  const first = await runHook(projectDir, HOOK, { transcript_path: null });
  assert.strictEqual(first.status, 0);
  assert.ok(first.stdout.includes('hook-errors.log'), first.stdout);
  const second = await runHook(projectDir, HOOK, { transcript_path: null });
  assert.ok(!second.stdout.includes('hook-errors.log'), `advisory repeated: ${second.stdout}`);
});

test('emits session-learnings advisories when not blocking', async () => {
  const projectDir = makeHookProject([HOOK]);
  const rules = '# Learned Rules\n' + Array.from({ length: 12 }, (_, i) => `- rule ${i}`).join('\n') + '\n';
  fs.writeFileSync(path.join(projectDir, '.claude', 'state', 'learned-rules.md'), rules);
  const result = await runHook(projectDir, HOOK, { transcript_path: null });
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('learned-rules.md'), result.stdout);
});

test('garbage verdict files do not satisfy the gate', async () => {
  const projectDir = makeHookProject([HOOK]);
  writePending(projectDir, [{ file: 'src/api.ts', ts: 1000 }]);
  const dir = path.join(projectDir, 'specs', 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'clean-code-verdict.json'), '');
  fs.writeFileSync(path.join(dir, 'security-verdict.json'), 'not json');
  const result = await runHook(projectDir, HOOK, { transcript_path: null });
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.decision, 'block');
});
