'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('/gate documents canvas-sync as a blocking living-design check', () => {
  const gate = read('.claude/skills/gate/SKILL.md');
  assert.match(gate, /npm run canvas-sync/);
  assert.match(gate, /BLOCK/);
  assert.match(gate, /sensor-waivers\.json/);
});

test('/change updates Canvas before design-governed behavior changes proceed', () => {
  const change = read('.claude/skills/change/SKILL.md');
  assert.match(change, /reasons-canvas\.md/);
  assert.match(change, /npm run canvas-sync/);
  assert.match(change, /self-correct/);
});

test('/refactor blocks governed moves until Canvas Governs is updated', () => {
  const refactor = read('.claude/skills/refactor/SKILL.md');
  assert.match(refactor, /reasons-canvas\.md/);
  assert.match(refactor, /npm run canvas-sync/);
  assert.match(refactor, /hard-block/i);
});
