'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { classifyRisk, maxTier } = require('../.claude/scripts/risk-envelope');

const NOW = new Date('2026-07-26T12:00:00.000Z');

test('maxTier never lowers an existing risk tier', () => {
  assert.strictEqual(maxTier('R3', 'R1'), 'R3');
  assert.strictEqual(maxTier('R1', 'R2'), 'R2');
});

test('documentation-only work is R0 when no higher-risk text signal exists', () => {
  const result = classifyRisk({
    taskId: 'DOC-1',
    text: 'Clarify the installation guide',
    files: ['docs/install.md'],
    now: NOW,
  });
  assert.strictEqual(result.tier, 'R0');
  assert.strictEqual(result.required_approvals, 0);
  assert.deepStrictEqual(result.allowed_paths, ['docs/install.md']);
});

test('dependency changes have an R2 floor and require supply-chain evidence', () => {
  const result = classifyRisk({
    taskId: 'DEP-1',
    text: 'Upgrade a dependency',
    files: ['package.json', 'package-lock.json'],
    now: NOW,
  });
  assert.strictEqual(result.tier, 'R2');
  assert.ok(result.required_evidence.includes('dependency_scan'));
  assert.ok(result.forbidden_actions.includes('modify_branch_protection'));
});

test('authentication and sensitive-data changes have an R3 floor', () => {
  const result = classifyRisk({
    taskId: 'AUTH-1',
    text: 'Add OAuth login and persist a user token',
    files: ['src/auth/oauth.ts'],
    now: NOW,
  });
  assert.strictEqual(result.tier, 'R3');
  assert.strictEqual(result.required_approvals, 2);
  assert.ok(result.required_evidence.includes('security_review'));
  assert.ok(result.forbidden_actions.includes('deploy'));
});

test('production access is R4 and agents may only prepare evidence', () => {
  const result = classifyRisk({
    taskId: 'PROD-1',
    text: 'Apply an irreversible change to the production database',
    files: ['scripts/prod-migrate.ts'],
    now: NOW,
  });
  assert.strictEqual(result.tier, 'R4');
  assert.ok(result.required_evidence.includes('human_execution'));
  assert.ok(result.forbidden_actions.includes('execute_production_change'));
});

test('a broad design-touching ordinary change receives at least R2', () => {
  const result = classifyRisk({
    taskId: 'FEAT-1',
    text: 'Update four existing views',
    files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
    now: NOW,
  });
  assert.strictEqual(result.tier, 'R2');
  assert.ok(result.signals.includes('design_touching'));
});
