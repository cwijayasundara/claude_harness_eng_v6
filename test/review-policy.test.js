const assert = require('assert');
const { test } = require('node:test');
const {
  touchesSecurityBoundary,
} = require('../.claude/hooks/lib/review-policy');

test('security trigger ignores non-source docs even when names contain security words', () => {
  assert.strictEqual(touchesSecurityBoundary('docs/auth-design.md'), false);
  assert.strictEqual(touchesSecurityBoundary('src/auth/session.ts'), true);
});

test('security trigger fires on data/API boundary files too', () => {
  assert.strictEqual(touchesSecurityBoundary('src/db/user-repository.ts'), true);
  assert.strictEqual(touchesSecurityBoundary('src/widgets/card.ts'), false);
});
