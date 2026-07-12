'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { mergeVerdicts } = require('../.claude/scripts/merge-review-verdicts');

const blockA = {
  gate: 'code-review',
  pass: false,
  summary: { block: 1, warn: 0, info: 0 },
  findings: [
    {
      id: 'CR-001',
      level: 'BLOCK',
      file: 'src/a.ts',
      line: 10,
      description: 'use-after-free style bug',
      fix: 'leak the box',
    },
  ],
};

const passB = {
  gate: 'code-review',
  pass: true,
  summary: { block: 0, warn: 0, info: 0 },
  findings: [],
};

const blockBSame = {
  gate: 'code-review',
  pass: false,
  summary: { block: 1, warn: 0, info: 0 },
  findings: [
    {
      id: 'CR-001',
      level: 'BLOCK',
      file: 'src/a.ts',
      line: 10,
      description: 'use-after-free style bug',
      fix: 'leak the box',
    },
  ],
};

test('union: any BLOCK fails even if other instance passes', () => {
  const m = mergeVerdicts(blockA, passB, 'union');
  assert.equal(m.pass, false);
  assert.equal(m.summary.block, 1);
  assert.equal(m.policy, 'union');
});

test('majority: single-instance BLOCK does not fail when other passes', () => {
  const m = mergeVerdicts(blockA, passB, 'majority');
  assert.equal(m.pass, true);
  assert.equal(m.summary.block, 0);
});

test('majority: both BLOCKing same finding fails', () => {
  const m = mergeVerdicts(blockA, blockBSame, 'majority');
  assert.equal(m.pass, false);
  assert.ok(m.summary.block >= 1);
});

test('union dedupes identical findings', () => {
  const m = mergeVerdicts(blockA, blockBSame, 'union');
  assert.equal(m.findings.filter((f) => f.level === 'BLOCK').length, 1);
});
