'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { applyAssertions } = require('./evals/helpers/assertions.js');
const { extractTranscript } = require('./evals/helpers/transcript.js');

function makeDirs(fixtureFiles, workFiles) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-assert-'));
  const fixtureDir = path.join(base, 'fixture');
  const workDir = path.join(base, 'work');
  for (const [rel, content] of Object.entries(fixtureFiles)) {
    const p = path.join(fixtureDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  for (const [rel, content] of Object.entries(workFiles)) {
    const p = path.join(workDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return { fixtureDir, workDir };
}

test('transcript_matches passes on match and fails on miss', () => {
  const { fixtureDir, workDir } = makeDirs({}, {});
  const ctx = { transcript: 'I wrote a Micro-Contract first.', fixtureDir, workDir };
  assert.deepStrictEqual(
    applyAssertions([{ type: 'transcript_matches', pattern: 'micro-contract' }], ctx),
    []
  );
  const failures = applyAssertions(
    [{ type: 'transcript_matches', pattern: 'escalate to /change' }],
    ctx
  );
  assert.strictEqual(failures.length, 1);
});

test('transcript_not_matches fails when forbidden text appears', () => {
  const { fixtureDir, workDir } = makeDirs({}, {});
  const ctx = { transcript: 'All tests pass!', fixtureDir, workDir };
  const failures = applyAssertions(
    [{ type: 'transcript_not_matches', pattern: 'all tests pass' }],
    ctx
  );
  assert.strictEqual(failures.length, 1);
});

test('files_unchanged compares work files against the fixture copy', () => {
  const { fixtureDir, workDir } = makeDirs(
    { 'dead-code.js': 'legacy();\n', 'calc.js': 'old\n' },
    { 'dead-code.js': 'legacy();\n', 'calc.js': 'new\n' }
  );
  const ctx = { transcript: '', fixtureDir, workDir };
  assert.deepStrictEqual(
    applyAssertions([{ type: 'files_unchanged', paths: ['dead-code.js'] }], ctx),
    []
  );
  const failures = applyAssertions(
    [{ type: 'files_unchanged', paths: ['calc.js'] }],
    ctx
  );
  assert.strictEqual(failures.length, 1);
});

test('workdir_unchanged detects edits, additions, and deletions', () => {
  const same = makeDirs({ 'app.js': 'x\n' }, { 'app.js': 'x\n' });
  assert.deepStrictEqual(
    applyAssertions([{ type: 'workdir_unchanged' }], { transcript: '', ...same }),
    []
  );
  const added = makeDirs({ 'app.js': 'x\n' }, { 'app.js': 'x\n', 'auth.js': 'new\n' });
  assert.strictEqual(
    applyAssertions([{ type: 'workdir_unchanged' }], { transcript: '', ...added }).length,
    1
  );
  const deleted = makeDirs({ 'app.js': 'x\n', 'b.js': 'y\n' }, { 'app.js': 'x\n' });
  assert.strictEqual(
    applyAssertions([{ type: 'workdir_unchanged' }], { transcript: '', ...deleted }).length,
    1
  );
});

test('workdir_unchanged ignores node_modules, .git, and .claude noise', () => {
  const { fixtureDir, workDir } = makeDirs(
    { 'app.js': 'x\n' },
    { 'app.js': 'x\n', 'node_modules/dep/index.js': 'z\n', '.claude/state.json': '{}\n' }
  );
  const ctx = { transcript: '', fixtureDir, workDir };
  assert.deepStrictEqual(applyAssertions([{ type: 'workdir_unchanged' }], ctx), []);
});

test('file_matches checks a pattern inside a work file', () => {
  const { fixtureDir, workDir } = makeDirs({}, { 'test/app.test.js': "test('multiply', ...)\n" });
  const ctx = { transcript: '', fixtureDir, workDir };
  assert.deepStrictEqual(
    applyAssertions([{ type: 'file_matches', path: 'test/app.test.js', pattern: 'multiply' }], ctx),
    []
  );
  assert.strictEqual(
    applyAssertions([{ type: 'file_matches', path: 'missing.js', pattern: 'x' }], ctx).length,
    1
  );
});

test('fixture_tests_pass runs node --test in the work dir', () => {
  const passing = makeDirs({}, {
    'app.test.js': "const {test}=require('node:test');const a=require('assert');test('ok',()=>a.ok(true));\n",
  });
  assert.deepStrictEqual(
    applyAssertions([{ type: 'fixture_tests_pass', expect: true }], { transcript: '', ...passing }),
    []
  );
  const failing = makeDirs({}, {
    'app.test.js': "const {test}=require('node:test');const a=require('assert');test('no',()=>a.ok(false));\n",
  });
  assert.strictEqual(
    applyAssertions([{ type: 'fixture_tests_pass', expect: true }], { transcript: '', ...failing }).length,
    1
  );
  assert.deepStrictEqual(
    applyAssertions([{ type: 'fixture_tests_pass', expect: false }], { transcript: '', ...failing }),
    []
  );
});

test('extractTranscript joins assistant text across stream-json events', () => {
  const stream = [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '## Micro-Contract\nfix sum()' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Edit' }, { type: 'text', text: 'Done.' }] },
    }),
    JSON.stringify({ type: 'result', result: 'final' }),
    'not json at all',
  ].join('\n');
  const transcript = extractTranscript(stream);
  assert.ok(transcript.includes('Micro-Contract'));
  assert.ok(transcript.includes('Done.'));
});

test('extractTranscript returns empty string for plain-text output', () => {
  assert.strictEqual(extractTranscript('just a normal final answer'), '');
});

test('unknown assertion type is reported as a failure, not skipped', () => {
  const { fixtureDir, workDir } = makeDirs({}, {});
  const failures = applyAssertions(
    [{ type: 'telepathy_check' }],
    { transcript: '', fixtureDir, workDir }
  );
  assert.strictEqual(failures.length, 1);
});
