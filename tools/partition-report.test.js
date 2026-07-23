'use strict';

// Tests for the profile-closure analysis — the general form of the partition rule.
// A composed install (kernel + a profile's packs) must be closed under hard references,
// or it crashes on a require() for a module the profile did not ship.

const test = require('node:test');
const assert = require('node:assert');
const { installs, computeProfileBreaks } = require('./partition-report');

const PROFILES = {
  kernel: { packs: [] },
  core: { packs: ['verification', 'telemetry'] },
  brownfield: { packs: ['verification', 'telemetry', 'brownfield'] },
};

test('installs treats the kernel as present in every profile', () => {
  assert.ok(installs(PROFILES.kernel, 'kernel'));
  assert.ok(installs(PROFILES.core, 'kernel'));
});

test('installs reflects a profile pack list', () => {
  assert.ok(installs(PROFILES.core, 'telemetry'));
  assert.ok(!installs(PROFILES.core, 'brownfield'));
});

test('an edge whose callee pack a profile omits is a profile break', () => {
  // telemetry ships in core; brownfield does not — so this edge crashes the core install.
  const breaks = computeProfileBreaks(
    [{ from: 'script:drift-report', to: 'lib:drift', fromPack: 'telemetry', toPack: 'brownfield' }],
    PROFILES
  );
  assert.strictEqual(breaks.length, 1);
  assert.deepStrictEqual(breaks[0].profiles, ['core'],
    'only core installs telemetry-without-brownfield; brownfield/full ship both');
});

test('an edge between packs that always travel together is not a break', () => {
  // Both endpoints are in the brownfield pack set that every profile installing the
  // caller also installs, so no composed install is missing the callee.
  const breaks = computeProfileBreaks(
    [{ from: 'lib:a', to: 'lib:b', fromPack: 'brownfield', toPack: 'brownfield' }],
    PROFILES
  );
  assert.deepStrictEqual(breaks, []);
});

test('an edge into the kernel never breaks a profile', () => {
  const breaks = computeProfileBreaks(
    [{ from: 'lib:a', to: 'lib:common', fromPack: 'brownfield', toPack: 'kernel' }],
    PROFILES
  );
  assert.deepStrictEqual(breaks, []);
});

test('no profiles declared means nothing can be judged broken', () => {
  const breaks = computeProfileBreaks(
    [{ from: 'lib:a', to: 'lib:b', fromPack: 'telemetry', toPack: 'brownfield' }],
    {}
  );
  assert.deepStrictEqual(breaks, []);
});
