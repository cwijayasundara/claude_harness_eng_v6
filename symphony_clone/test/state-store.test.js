'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StateStore } = require('../src/orchestrator/state-store');

test('StateStore records retry metadata after a failed attempt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symphony-state-'));
  const store = new StateStore({ stateDir: dir });
  const issue = { id: 'issue-1', key: 'ENG-1' };

  store.startRun(issue, { attempt: 1, groupId: 'A' });
  const run = store.recordFailure(issue, new Error('claude failed'), {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    now: new Date('2026-05-01T10:00:00.000Z')
  });

  assert.equal(run.status, 'retry_wait');
  assert.equal(run.attempt, 1);
  assert.equal(run.lastError, 'claude failed');
  assert.equal(run.nextRetryAt, '2026-05-01T10:00:01.000Z');
  assert.equal(store.dueForRetry(issue, new Date('2026-05-01T10:00:00.500Z')), false);
  assert.equal(store.dueForRetry(issue, new Date('2026-05-01T10:00:01.000Z')), true);
});

test('StateStore marks exhausted retries as failed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symphony-state-'));
  const store = new StateStore({ stateDir: dir });
  const issue = { id: 'issue-1', key: 'ENG-1' };

  store.startRun(issue, { attempt: 3, groupId: 'A' });
  const run = store.recordFailure(issue, new Error('done trying'), {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    now: new Date('2026-05-01T10:00:00.000Z')
  });

  assert.equal(run.status, 'failed');
  assert.equal(run.nextRetryAt, null);
});

