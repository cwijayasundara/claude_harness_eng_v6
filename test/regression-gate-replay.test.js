'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detectLiveExternalReach } = require('../.claude/hooks/lib/regression-gate');

test('detectLiveExternalReach true on MissingFixtureError in child output', () => {
  assert.strictEqual(detectLiveExternalReach('E   replay_transport.MissingFixtureError: no recorded fixture for stripe/charge'), true);
});
test('detectLiveExternalReach true on GoldenNotFoundError', () => {
  assert.strictEqual(detectLiveExternalReach('fake_llm.GoldenNotFoundError: no golden LLM response for classify/ab12'), true);
});
test('detectLiveExternalReach false on ordinary assertion failure', () => {
  assert.strictEqual(detectLiveExternalReach('AssertionError: expected 200 got 500'), false);
});
test('detectLiveExternalReach false on a bare mention without the exception colon', () => {
  // a test titled after the class, or asserting on its name, must not false-fire
  assert.strictEqual(detectLiveExternalReach('ok 3 - raises MissingFixtureError when unrecorded'), false);
  assert.strictEqual(detectLiveExternalReach('# GoldenNotFoundError is the sentinel'), false);
});
test('detectLiveExternalReach false on empty/nullish input', () => {
  assert.strictEqual(detectLiveExternalReach(''), false);
  assert.strictEqual(detectLiveExternalReach(null), false);
  assert.strictEqual(detectLiveExternalReach(undefined), false);
});
