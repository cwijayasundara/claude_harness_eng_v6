'use strict';

// Co-located AUTO_MERGE config coverage (the broader config suite lives in test/).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('./config');

const baseEnv = () => ({ TARGET_REPO_URL: 'git@github.com:o/r.git', LINEAR_API_KEY: 'k', LINEAR_PROJECT_SLUG: 's' });

test('autoMerge defaults: disabled, merge method, Done state', () => {
  const c = loadConfig(baseEnv(), { loadDotEnv: false });
  assert.equal(c.autoMerge.enabled, false);
  assert.equal(c.autoMerge.method, 'merge');
  assert.equal(c.autoMerge.doneState, 'Done');
});

test('autoMerge reads AUTO_MERGE / MERGE_METHOD / DONE_STATE', () => {
  const c = loadConfig({ ...baseEnv(), AUTO_MERGE: 'true', MERGE_METHOD: 'squash', DONE_STATE: 'Shipped' }, { loadDotEnv: false });
  assert.equal(c.autoMerge.enabled, true);
  assert.equal(c.autoMerge.method, 'squash');
  assert.equal(c.autoMerge.doneState, 'Shipped');
});

test('invalid MERGE_METHOD is rejected', () => {
  assert.throws(() => loadConfig({ ...baseEnv(), MERGE_METHOD: 'rocket' }, { loadDotEnv: false }), /MERGE_METHOD/);
});

test('planning config: PLAN_LABEL / PLANNED_STATE with defaults', () => {
  const def = loadConfig(baseEnv(), { loadDotEnv: false });
  assert.equal(def.tracker.planLabel, 'agent-plan');
  assert.equal(def.tracker.plannedState, 'Planned');
  const custom = loadConfig({ ...baseEnv(), PLAN_LABEL: 'prd-ready', PLANNED_STATE: 'Groomed' }, { loadDotEnv: false });
  assert.equal(custom.tracker.planLabel, 'prd-ready');
  assert.equal(custom.tracker.plannedState, 'Groomed');
});
