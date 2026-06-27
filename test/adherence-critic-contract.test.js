'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const EVAL = read('.claude/agents/evaluator.md');
const DIFF = read('.claude/agents/diff-reviewer.md');

test('evaluator documents the brownfield-adherence rubric', () => {
  assert.match(EVAL, /brownfield-adherence/i);
  assert.match(EVAL, /DeepWiki/);
  assert.match(EVAL, /parallel structure/i);
  assert.match(EVAL, /seam/i);
});

test('diff-reviewer documents the design-adherence lens', () => {
  assert.match(DIFF, /adherence/i);
  assert.match(DIFF, /seam/i);
  assert.match(DIFF, /parallel structure/i);
});
