'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  isAgentSession, contextPackOk, testRan, evaluateTrajectory,
} = require('../.claude/hooks/lib/trajectory-contract');

const NOW = Date.parse('2026-08-19T12:00:00.000Z');

test('isAgentSession is false until a receipt exists', () => {
  assert.strictEqual(isAgentSession({}), false);
  assert.strictEqual(isAgentSession({ atRed: [{ storyId: 'S-1' }] }), true);
  assert.strictEqual(isAgentSession({ redPhaseEvents: [{ verdict: 'fail' }] }), true);
});

test('contextPackOk rejects missing, stale, or unparseable receipts', () => {
  const hour = 60 * 60 * 1000;
  assert.strictEqual(contextPackOk(null, NOW, hour), false);
  assert.strictEqual(contextPackOk({ ts: 'nope' }, NOW, hour), false);
  assert.strictEqual(contextPackOk({ ts: '2026-08-19T11:30:00.000Z' }, NOW, hour), true);
  assert.strictEqual(contextPackOk({ ts: '2026-08-18T12:00:00.000Z' }, NOW, hour), false);
});

test('testRan accepts at-red, coverage, or a real red-phase verdict', () => {
  assert.strictEqual(testRan({}), false);
  assert.strictEqual(testRan({ atRed: [{}] }), true);
  assert.strictEqual(testRan({ coverageVerdicts: [{}] }), true);
  assert.strictEqual(testRan({ redPhaseEvents: [{ verdict: 'env-broken' }] }), false);
  assert.strictEqual(testRan({ redPhaseEvents: [{ verdict: 'pass' }] }), true);
});

test('evaluateTrajectory skips when there is no story-owned file or no agent session', () => {
  assert.strictEqual(evaluateTrajectory({
    storyOwnedFiles: [], receipts: { atRed: [{}] }, now: NOW,
  }).status, 'skip');
  assert.strictEqual(evaluateTrajectory({
    storyOwnedFiles: ['src/a.js'], receipts: {}, now: NOW,
  }).status, 'skip');
});

test('evaluateTrajectory fails an agent session with no test evidence', () => {
  const v = evaluateTrajectory({
    storyOwnedFiles: ['src/a.js'],
    graphReal: false,
    receipts: { contextPack: { ts: '2026-08-19T11:50:00.000Z' } },
    now: NOW,
  });
  assert.strictEqual(v.status, 'fail');
  assert.ok(v.checks.find((c) => c.id === 'test_ran' && c.ok === false));
});

test('evaluateTrajectory requires a fresh context pack only when the graph is real', () => {
  const receipts = {
    atRed: [{}],
    contextPack: { ts: '2026-08-18T12:00:00.000Z' },
  };
  assert.strictEqual(evaluateTrajectory({
    storyOwnedFiles: ['src/a.js'], graphReal: false, receipts, now: NOW,
  }).status, 'pass');
  const brown = evaluateTrajectory({
    storyOwnedFiles: ['src/a.js'], graphReal: true, receipts, now: NOW,
  });
  assert.strictEqual(brown.status, 'fail');
  assert.ok(brown.checks.find((c) => c.id === 'context_pack' && c.ok === false));
});
