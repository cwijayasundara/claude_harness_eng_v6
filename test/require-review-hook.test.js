const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeHookProject, runHook } = require('./helpers/hook-fixture');

const HOOK = 'require-review.js';

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
      content: [
        { type: 'tool_use', name: toolName, input: { subagent_type: subagentType } },
      ],
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
