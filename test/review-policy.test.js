const assert = require('assert');
const { test } = require('node:test');
const {
  reviewPolicy,
  touchesSecurityBoundary,
} = require('../.claude/hooks/lib/review-policy');

test('review policy uses one quality reviewer for low-risk production writes', () => {
  const policy = reviewPolicy([{ file: 'src/widgets/card.ts', ts: 1 }]);

  assert.strictEqual(policy.scope, 'tiny');
  assert.deepStrictEqual(policy.required.map((r) => r.agent), ['clean-code-reviewer']);
  assert.deepStrictEqual(policy.securityFiles, []);
});

test('review policy adds security reviewer for security and data boundaries', () => {
  const policy = reviewPolicy([
    { file: 'src/routes/auth.ts', ts: 1 },
    { file: 'src/db/user-repository.ts', ts: 1 },
  ]);

  assert.deepStrictEqual(policy.required.map((r) => r.agent), [
    'clean-code-reviewer',
    'security-reviewer',
  ]);
  assert.deepStrictEqual(policy.securityFiles, [
    'src/routes/auth.ts',
    'src/db/user-repository.ts',
  ]);
});

test('security trigger ignores non-source docs even when names contain security words', () => {
  assert.strictEqual(touchesSecurityBoundary('docs/auth-design.md'), false);
  assert.strictEqual(touchesSecurityBoundary('src/auth/session.ts'), true);
});
