'use strict';

const assert = require('assert');
const { test } = require('node:test');
const {
  contentHash, forbiddenAction, pathMatches, stampEnvelope, validateEnvelope,
} = require('../.claude/hooks/lib/task-envelope');
const { buildEnvelope } = require('../.claude/scripts/task-envelope');

const RISK = {
  task_id: 'TASK-1',
  tier: 'R3',
  allowed_paths: ['src/auth/**'],
  forbidden_actions: ['merge', 'deploy'],
  required_evidence: ['unit', 'security_review'],
  required_approvals: 2,
};

test('buildEnvelope binds risk, intent, scope, budget, and stopping conditions', () => {
  const envelope = buildEnvelope({
    risk: RISK,
    intent: 'add login',
    allowedPaths: ['test/auth/**'],
    budgets: { warn_at_pct: 80, dimensions: [{ unit: 'agents', limit: 10 }] },
    now: new Date('2026-07-26T12:00:00.000Z'),
  });
  assert.strictEqual(envelope.task_id, 'TASK-1');
  assert.strictEqual(envelope.risk_tier, 'R3');
  assert.deepStrictEqual(envelope.allowed_paths, ['test/auth/**', 'src/auth/**']);
  assert.deepStrictEqual(validateEnvelope(envelope), []);
  assert.strictEqual(envelope.integrity.hash, contentHash(envelope));
});

test('integrity validation detects envelope mutation', () => {
  const envelope = stampEnvelope({
    schema_version: 1, task_id: 'T', risk_tier: 'R1',
    allowed_paths: ['src/**'], forbidden_actions: [], required_evidence: [],
    budgets: { dimensions: [{ unit: 'agents', limit: 1 }] },
  });
  envelope.allowed_paths.push('**');
  assert.ok(validateEnvelope(envelope).includes('integrity hash mismatch'));
});

test('path matching supports exact, recursive, and one-level scopes', () => {
  assert.strictEqual(pathMatches('src/a.ts', 'src/a.ts'), true);
  assert.strictEqual(pathMatches('src/**', 'src/deep/a.ts'), true);
  assert.strictEqual(pathMatches('src/*', 'src/a.ts'), true);
  assert.strictEqual(pathMatches('src/*', 'src/deep/a.ts'), false);
  assert.strictEqual(pathMatches('src/**', 'test/a.ts'), false);
});

test('forbiddenAction maps approved action names to semantic command checks', () => {
  const envelope = { forbidden_actions: ['merge', 'deploy'] };
  assert.strictEqual(forbiddenAction(envelope, 'gh pr merge 12'), 'merge');
  assert.strictEqual(forbiddenAction(envelope, 'npm run deploy'), 'deploy');
  assert.strictEqual(forbiddenAction(envelope, 'npm test'), null);
});
