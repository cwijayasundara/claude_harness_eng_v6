'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const EVAL = read('.claude/agents/evaluator.md');
const CODE_REVIEWER = read('.claude/agents/code-reviewer.md');

test('evaluator documents the brownfield-adherence rubric', () => {
  assert.match(EVAL, /brownfield-adherence/i);
  assert.match(EVAL, /DeepWiki/);
  assert.match(EVAL, /parallel structure/i);
  assert.match(EVAL, /seam/i);
});

test('code-reviewer documents the design-adherence lens', () => {
  assert.match(CODE_REVIEWER, /adherence/i);
  assert.match(CODE_REVIEWER, /seam/i);
  assert.match(CODE_REVIEWER, /parallel structure/i);
});
