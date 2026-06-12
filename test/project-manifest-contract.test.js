'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('/evaluate consumes the scaffolded manifest evaluation fields', () => {
  const evaluate = read('.claude/skills/evaluate/SKILL.md');

  assert.match(evaluate, /evaluation\.api_base_url/);
  assert.match(evaluate, /evaluation\.ui_base_url/);
  assert.match(evaluate, /evaluation\.health_check/);
  assert.doesNotMatch(evaluate, /exists with `api_base_url`, `ui_base_url`, and `health_check` fields/);
});

test('/scaffold keeps verification runtime mode separate from evaluation URLs', () => {
  const scaffold = read('.claude/commands/scaffold.md');

  assert.match(scaffold, /evaluation: api_base_url, ui_base_url, health_check/);
  assert.match(scaffold, /verification: mode, and mode-specific config/);
  assert.doesNotMatch(scaffold, /verification: mode, health_check, and mode-specific config/);
  assert.doesNotMatch(scaffold, /"health_check": \{ "url": "http:\/\/localhost/);
});

test('brownfield and perf-baseline refer to the same evaluation health-check contract', () => {
  const brownfield = read('.claude/skills/brownfield/SKILL.md');
  const perfBaseline = read('.claude/scripts/perf-baseline.js');

  assert.match(brownfield, /manifest has `evaluation\.api_base_url`/);
  assert.match(brownfield, /`evaluation\.health_check`/);
  assert.match(perfBaseline, /project-manifest\.json#evaluation\.api_base_url/);
  assert.match(perfBaseline, /evaluation\.health_check/);
});
