'use strict';

// specs/reviews/sensor-waivers.json had a schema, a validator, a documented policy in
// docs/sensor-arbitration.md, and a "Waive:" line in every gate's failure message — but
// nothing ever READ it for enforcement. The mechanism was inert: the only real escape was
// the blunt HARNESS_*_GATE=off, which the policy explicitly says is not a substitute for
// a reviewed waiver.
//
// These tests pin the application rules. A waiver is a narrow, reviewed, expiring
// exception — never a silent suppression, and never a blanket bypass.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { findWaiver } = require('../.claude/hooks/lib/pre-commit-util');

const TODAY = '2026-07-23';
const VALID = {
  sensor_id: 'test-deletion-guard',
  scope: 'test/x.test.js',
  reason: 'a reviewed exception with a real explanation',
  expires: '2026-12-31',
  approved_by: 'A Human',
};

function rootWith(waivers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waiver-'));
  fs.mkdirSync(path.join(dir, 'specs', 'reviews'), { recursive: true });
  if (waivers !== null) {
    fs.writeFileSync(path.join(dir, 'specs', 'reviews', 'sensor-waivers.json'), JSON.stringify({ waivers }));
  }
  return dir;
}

test('a valid, unexpired waiver matching the sensor is found', () => {
  const w = findWaiver(rootWith([VALID]), 'test-deletion-guard', TODAY);
  assert.ok(w);
  assert.strictEqual(w.approved_by, 'A Human');
});

test('a waiver for a DIFFERENT sensor does not apply', () => {
  assert.strictEqual(findWaiver(rootWith([VALID]), 'secret-scan', TODAY), null,
    'a waiver must never leak across sensors');
});

test('an EXPIRED waiver does not apply', () => {
  const expired = { ...VALID, expires: '2026-01-01' };
  assert.strictEqual(findWaiver(rootWith([expired]), 'test-deletion-guard', TODAY), null,
    'a waiver is a reviewed note with an expiry, not a permanent suppression');
});

test('a waiver expiring TODAY still applies; the day after it does not', () => {
  const w = { ...VALID, expires: TODAY };
  assert.ok(findWaiver(rootWith([w]), 'test-deletion-guard', TODAY));
  assert.strictEqual(findWaiver(rootWith([w]), 'test-deletion-guard', '2026-07-24'), null);
});

test('a waiver missing a required field does not apply', () => {
  for (const missing of ['reason', 'expires', 'approved_by', 'scope']) {
    const bad = { ...VALID };
    delete bad[missing];
    assert.strictEqual(findWaiver(rootWith([bad]), 'test-deletion-guard', TODAY), null,
      `a waiver without ${missing} is not reviewable and must not suppress a gate`);
  }
});

test('a placeholder reason does not apply', () => {
  // The schema sets a 12-char floor; a waiver whose reason is "n/a" is a box-tick, and
  // the point of requiring a reason is to force the question to be answered.
  const bad = { ...VALID, reason: 'n/a' };
  assert.strictEqual(findWaiver(rootWith([bad]), 'test-deletion-guard', TODAY), null);
});

test('no waivers file means no waiver — never an implicit pass', () => {
  assert.strictEqual(findWaiver(rootWith(null), 'test-deletion-guard', TODAY), null);
});

test('a malformed waivers file does not waive anything', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waiver-bad-'));
  fs.mkdirSync(path.join(dir, 'specs', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs', 'reviews', 'sensor-waivers.json'), '{ not json');
  assert.strictEqual(findWaiver(dir, 'test-deletion-guard', TODAY), null,
    'an unparseable waiver file must fail closed, not open');
});

test('the repo\'s own committed waiver is valid and applies to test-deletion-guard', () => {
  // Round-trips the REAL file rather than a fixture: a waiver that validates against the
  // schema but does not actually apply would be indistinguishable from none.
  const repo = path.resolve(__dirname, '..');
  const w = findWaiver(repo, 'test-deletion-guard', TODAY);
  assert.ok(w, 'the committed waiver must actually apply');
  assert.match(w.scope, /readiness-ratchet-ci/);
  assert.ok(w.approved_by && w.approved_by !== 'harness', 'approval must name a human');
});
