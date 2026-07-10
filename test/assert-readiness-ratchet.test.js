'use strict';

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const {
  evaluateReadinessRatchet,
  loadReadinessConfig,
} = require('../.claude/scripts/assert-readiness-ratchet');

const ROOT = path.resolve(__dirname, '..');

function report(active) {
  return { summary: { active, partial: 0, planned: 8 - active }, pillars: [] };
}

test('report mode always passes even when active is zero', () => {
  const r = evaluateReadinessRatchet(report(0), report(5), {
    mode: 'report',
    minActivePillars: 5,
    forbidRegression: true,
  });
  assert.strictEqual(r.pass, true);
  assert.ok(r.summaryLine.includes('report mode'));
});

test('ratchet fails when active below min_active_pillars', () => {
  const r = evaluateReadinessRatchet(report(2), report(2), {
    mode: 'ratchet',
    minActivePillars: 3,
    forbidRegression: false,
  });
  assert.strictEqual(r.pass, false);
  assert.ok(r.reasons.some((x) => x.includes('min_active_pillars')));
});

test('ratchet passes when active meets min and no regression check', () => {
  const r = evaluateReadinessRatchet(report(3), report(1), {
    mode: 'ratchet',
    minActivePillars: 3,
    forbidRegression: false,
  });
  assert.strictEqual(r.pass, true);
});

test('forbid_regression fails when active drops below baseline', () => {
  const r = evaluateReadinessRatchet(report(2), report(4), {
    mode: 'ratchet',
    minActivePillars: 0,
    forbidRegression: true,
  });
  assert.strictEqual(r.pass, false);
  assert.ok(r.reasons.some((x) => x.includes('regressed')));
});

test('forbid_regression passes when active holds or improves', () => {
  const hold = evaluateReadinessRatchet(report(4), report(4), {
    mode: 'ratchet',
    minActivePillars: 0,
    forbidRegression: true,
  });
  assert.strictEqual(hold.pass, true);

  const up = evaluateReadinessRatchet(report(5), report(4), {
    mode: 'ratchet',
    minActivePillars: 0,
    forbidRegression: true,
  });
  assert.strictEqual(up.pass, true);
});

test('forbid_regression without baseline fails in ratchet mode', () => {
  const r = evaluateReadinessRatchet(report(5), null, {
    mode: 'ratchet',
    minActivePillars: 0,
    forbidRegression: true,
  });
  assert.strictEqual(r.pass, false);
  assert.ok(r.reasons.some((x) => x.includes('baseline is missing')));
});

test('loadReadinessConfig reads Project Zero manifest as ratchet mode', () => {
  const cfg = loadReadinessConfig(ROOT);
  assert.strictEqual(cfg.mode, 'ratchet');
  assert.ok(cfg.minActivePillars >= 3);
  assert.strictEqual(cfg.forbidRegression, true);
});
