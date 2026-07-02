'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'pr-poll.js');
const { poll, recordHandled, loadState, run } = require(SCRIPT);

// gh stub: maps the first distinctive arg sequence to a canned payload.
function ghStub(payloads) {
  return (args) => {
    const key = args.join(' ');
    for (const [needle, out] of payloads) {
      if (key.includes(needle)) return typeof out === 'string' ? out : JSON.stringify(out);
    }
    throw new Error(`unexpected gh call: ${key}`);
  };
}

const VIEW = ['pr view', {
  headRefName: 'fix/some-branch',
  headRefOid: 'abc1234def',
  state: 'OPEN',
  mergeable: 'MERGEABLE',
  reviewDecision: 'CHANGES_REQUESTED',
}];
const CHECKS = ['pr checks', [
  { name: 'e2e', workflow: 'E2E', bucket: 'fail', link: 'https://ci/run/1' },
  { name: 'unit', workflow: 'CI', bucket: 'pass', link: 'https://ci/run/2' },
  { name: 'lint', workflow: 'CI', bucket: 'pending', link: 'https://ci/run/3' },
]];
const COMMENTS = ['pulls/42/comments', [
  { id: 9001, path: 'src/a.py', line: 12, body: 'This swallows the error', user: { login: 'reviewer1' } },
]];

test('poll surfaces failing checks and review comments with metadata', () => {
  const out = poll(42, { handled_checks: [], replied_comments: [] }, ghStub([VIEW, CHECKS, COMMENTS]));
  assert.strictEqual(out.head_sha, 'abc1234def');
  assert.strictEqual(out.head_branch, 'fix/some-branch');
  assert.deepStrictEqual(out.failures.map((f) => f.name), ['e2e']);
  assert.deepStrictEqual(out.comments.map((c) => c.id), [9001]);
  assert.strictEqual(out.comments[0].author, 'reviewer1');
  assert.strictEqual(out.clean, false);
});

test('handled checks are keyed by head SHA — same failure resurfaces on a new SHA', () => {
  const state = { handled_checks: ['abc1234def:e2e'], replied_comments: [9001] };
  const out = poll(42, state, ghStub([VIEW, CHECKS, COMMENTS]));
  assert.deepStrictEqual(out.failures, []);
  assert.deepStrictEqual(out.comments, []);
  const NEW_VIEW = ['pr view', { ...VIEW[1], headRefOid: 'ffff9999' }];
  const out2 = poll(42, state, ghStub([NEW_VIEW, CHECKS, COMMENTS]));
  assert.deepStrictEqual(out2.failures.map((f) => f.name), ['e2e']);
});

test('clean is true only when no failures, no pending checks, no unhandled comments', () => {
  const GREEN = ['pr checks', [{ name: 'unit', workflow: 'CI', bucket: 'pass', link: 'x' }]];
  const NONE = ['pulls/42/comments', []];
  const out = poll(42, { handled_checks: [], replied_comments: [] }, ghStub([VIEW, GREEN, NONE]));
  assert.strictEqual(out.clean, true);
  const PENDING = ['pr checks', [{ name: 'unit', workflow: 'CI', bucket: 'pending', link: 'x' }]];
  const out2 = poll(42, { handled_checks: [], replied_comments: [] }, ghStub([VIEW, PENDING, NONE]));
  assert.strictEqual(out2.clean, false);
});

test('recordHandled + loadState round-trip the state file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-poll-'));
  const file = path.join(dir, 'pr-respond-42.json');
  recordHandled(file, { check: 'abc1234def:e2e' });
  recordHandled(file, { comment: 9001 });
  const state = loadState(file);
  assert.deepStrictEqual(state.handled_checks, ['abc1234def:e2e']);
  assert.deepStrictEqual(state.replied_comments, [9001]);
  recordHandled(file, { check: 'abc1234def:e2e' }); // idempotent
  assert.deepStrictEqual(loadState(file).handled_checks, ['abc1234def:e2e']);
});

test('loadState tolerates a missing or corrupt state file (fresh state, loud stderr on corrupt)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-poll-'));
  const missing = loadState(path.join(dir, 'nope.json'));
  assert.deepStrictEqual(missing, { handled_checks: [], replied_comments: [] });
  const corrupt = path.join(dir, 'bad.json');
  fs.writeFileSync(corrupt, '{oops');
  const state = loadState(corrupt);
  assert.deepStrictEqual(state, { handled_checks: [], replied_comments: [] });
});

test('poll treats a malformed checks payload as empty with a warning, never throws', () => {
  const BAD = ['pr checks', 'not json'];
  const NONE = ['pulls/42/comments', []];
  const out = poll(42, { handled_checks: [], replied_comments: [] }, ghStub([VIEW, BAD, NONE]));
  assert.deepStrictEqual(out.failures, []);
  assert.strictEqual(out.clean, false); // unknown check state is NOT clean
});

test('raw_failure_count exposes handled-but-still-red so consumers can escalate instead of spin', () => {
  const state = { handled_checks: ['abc1234def:e2e'], replied_comments: [] };
  const NONE = ['pulls/42/comments', []];
  const out = poll(42, state, ghStub([VIEW, CHECKS, NONE]));
  assert.deepStrictEqual(out.failures, []);
  assert.strictEqual(out.raw_failure_count, 1);
  assert.strictEqual(out.clean, false);
});

test('skipping checks are neutral: skipped jobs cannot block clean, all-skipped is not clean', () => {
  const MIXED = ['pr checks', [
    { name: 'unit', workflow: 'CI', bucket: 'pass', link: 'x' },
    { name: 'docs-only', workflow: 'CI', bucket: 'skipping', link: 'y' },
  ]];
  const NONE = ['pulls/42/comments', []];
  const out = poll(42, { handled_checks: [], replied_comments: [] }, ghStub([VIEW, MIXED, NONE]));
  assert.strictEqual(out.clean, true);
  const ALLSKIP = ['pr checks', [{ name: 'docs-only', workflow: 'CI', bucket: 'skipping', link: 'y' }]];
  const out2 = poll(42, { handled_checks: [], replied_comments: [] }, ghStub([VIEW, ALLSKIP, NONE]));
  assert.strictEqual(out2.clean, false);
});

test('non-numeric comment ids are rejected loudly, never written to state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-poll-'));
  const file = path.join(dir, 's.json');
  recordHandled(file, { comment: Number('abc') });
  assert.deepStrictEqual(loadState(file).replied_comments, []);
});

test('run() rejects a non-numeric --record-comment with usage and exit code 2, writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-poll-'));
  const file = path.join(dir, 's.json');
  const originalWrite = process.stderr.write;
  let captured = '';
  process.stderr.write = (chunk) => { captured += chunk; return true; };
  let code;
  try {
    code = run(['42', '--state-file', file, '--record-comment', 'abc'], dir);
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.strictEqual(code, 2);
  assert.match(captured, /usage: pr-poll\.js/);
  assert.strictEqual(fs.existsSync(file), false);
});
