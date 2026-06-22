'use strict';

const assert = require('assert');
const { test } = require('node:test');
const S = require('../.claude/scripts/build-chain-state.js');

const BLOCK_MID = [
  '=== Session 3 ===',
  'groups_remaining: [D, E, F]',
  'features_passing: 47 / 203',
  'next_action: Run evaluator against group D',
].join('\n');

const BLOCK_DONE = [
  '=== Session 9 ===',
  'groups_remaining: []',
  'features_passing: 203 / 203',
  'next_action: DONE — all groups complete',
].join('\n');

// When two session blocks exist, only the LAST is parsed.
const TWO_BLOCKS = `${BLOCK_MID}\n\n${BLOCK_DONE}`;

test('parseLastBlock reads the final block only', () => {
  const b = S.parseLastBlock(TWO_BLOCKS);
  assert.deepStrictEqual(b.groupsRemaining, []);
  assert.strictEqual(b.featuresPassing, 203);
  assert.match(b.nextAction, /^DONE/);
  assert.strictEqual(b.found, true);
});

test('parseLastBlock parses a non-empty remaining list', () => {
  const b = S.parseLastBlock(BLOCK_MID);
  assert.deepStrictEqual(b.groupsRemaining, ['D', 'E', 'F']);
  assert.strictEqual(b.featuresPassing, 47);
});

test('parseLastBlock on empty/garbage text reports not found', () => {
  const b = S.parseLastBlock('');
  assert.strictEqual(b.found, false);
  assert.deepStrictEqual(b.groupsRemaining, []);
  assert.strictEqual(b.featuresPassing, 0);
});

test('isBuildComplete is true on DONE next_action', () => {
  assert.strictEqual(S.isBuildComplete(S.parseLastBlock(BLOCK_DONE)), true);
});

test('isBuildComplete is true on empty groups_remaining even without DONE', () => {
  const b = S.parseLastBlock('groups_remaining: []\nnext_action: tidy up');
  assert.strictEqual(S.isBuildComplete(b), true);
});

test('isBuildComplete is false while groups remain', () => {
  assert.strictEqual(S.isBuildComplete(S.parseLastBlock(BLOCK_MID)), false);
});

test('nextPhase transitions', () => {
  assert.strictEqual(S.nextPhase(S.STATES.PLAN, S.parseLastBlock(BLOCK_MID)), S.STATES.BUILD);
  assert.strictEqual(S.nextPhase(S.STATES.BUILD, S.parseLastBlock(BLOCK_MID)), S.STATES.BUILD);
  assert.strictEqual(S.nextPhase(S.STATES.BUILD, S.parseLastBlock(BLOCK_DONE)), S.STATES.FINALIZE);
  assert.strictEqual(S.nextPhase(S.STATES.FINALIZE, S.parseLastBlock(BLOCK_DONE)), S.STATES.DONE);
});

test('stallExceeded and budgetExceeded are inclusive thresholds', () => {
  assert.strictEqual(S.stallExceeded(2, 3), false);
  assert.strictEqual(S.stallExceeded(3, 3), true);
  assert.strictEqual(S.budgetExceeded(49, 50), false);
  assert.strictEqual(S.budgetExceeded(50, 50), true);
});
