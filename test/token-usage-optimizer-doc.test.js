'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('token governor links to the broader token usage optimizer design', () => {
  const governor = read('docs/token-governor.md');
  assert.match(governor, /token-usage-optimizer-design\.md/);
});

test('token usage optimizer design covers navigation, context, and tool-output layers', () => {
  const design = read('docs/token-usage-optimizer-design.md');
  assert.match(design, /Navigation Optimizer/);
  assert.match(design, /Context Access Optimizer/);
  assert.match(design, /Tool Output Optimizer/);
  assert.match(design, /Compress-Cache-Retrieve/);
  assert.match(design, /context-pack\.js/);
  assert.match(design, /context-store\.js/);
  assert.match(design, /context-retrieve\.js/);
  assert.match(design, /run-compact\.js/);
  assert.match(design, /search-compact\.js/);
  assert.match(design, /token-advisor\.js/);
  assert.match(design, /broad_source_read/);
  assert.match(design, /verbose_command/);
  assert.match(design, /tool-output-pack\.js/);
  assert.match(design, /estimated_tokens_saved_per_orientation/);
});
