'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// W3 adds the brownfield CR lane: /test --from-cr turns a change request into a
// regression-pin set + a CR-grounded delta test plan, composing seam-finder,
// pinning-down-behavior, mutation-smoke, cr-index and trace-check.

test('cr-index.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude', 'scripts', 'cr-index.js')));
});

test('/test documents the --from-cr lane and its grounding gate', () => {
  const skill = read('.claude', 'skills', 'test', 'SKILL.md');
  assert.match(skill, /--from-cr/, 'advertises the mode');
  assert.match(skill, /cr-index\.js/, 'builds the CR acceptance index');
  assert.match(skill, /cr-grounding\.json/, 'runs the delta grounding gate');
  assert.match(skill, /regression-pin/i, 'produces the regression-pin set');
});

test('the CR lane composes the existing brownfield skills (no re-implementation)', () => {
  const skill = read('.claude', 'skills', 'test', 'SKILL.md');
  for (const dep of ['seam-finder', 'pinning-down-behavior', 'mutation-smoke.js', 'trace-check.js']) {
    assert.match(skill, new RegExp(dep.replace('.', '\\.')), `CR lane reuses ${dep}`);
  }
});

test('/change points at /test --from-cr when a CR document exists', () => {
  const change = read('.claude', 'skills', 'change', 'SKILL.md');
  assert.match(change, /--from-cr/, '/change references the CR test lane');
});
