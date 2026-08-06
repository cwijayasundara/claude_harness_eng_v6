/**
 * Skipped-gate sensor (R7, detect-not-block).
 *
 * The audited run left no `brd-approval.json` and no `design-approval.json`.
 * The gates were prose the agent could omit, and — the part that mattered —
 * **nobody could tell afterwards**. Two of three planning gates simply did not
 * happen and the run looked normal.
 *
 * Enforcing them in a hook is not available: hooks fire on tool calls, and
 * there is no phase-transition event to gate. `phaseRan` also tests directory
 * existence rather than authorship, so in any repo that has run /build once,
 * every later /feature, /change, /vibe and /refactor would be blocked for not
 * producing artifacts they were never meant to produce.
 *
 * So this detects and reports. It never blocks. Making "silently didn't run"
 * measurable is the property that was missing; blocking is not.
 */
'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { EXPECTED_PHASES, detectSkippedGates } = require('../.claude/hooks/lib/gate-receipt-sensor.js');

// Injected so the rules are testable without a filesystem.
const world = ({ artifacts = [], receipts = {} }) => ({
  phaseRan: (phase) => artifacts.includes(phase),
  readReceipt: (phase) => receipts[phase] || null,
});

test('a lane that runs planning gates and recorded them reports nothing', () => {
  const found = detectSkippedGates('gated', world({
    artifacts: ['brd', 'spec', 'design', 'test'],
    receipts: {
      brd: { status: 'approved' },
      spec: { status: 'approved' },
      design: { status: 'approved' },
      test: { status: 'approved' },
    },
  }));
  assert.deepStrictEqual(found, []);
});

test('a phase whose artifacts exist with no receipt is reported', () => {
  const found = detectSkippedGates('gated', world({
    artifacts: ['brd', 'spec', 'design'],
    receipts: { spec: { status: 'approved' } },
  }));
  assert.deepStrictEqual(found.map((f) => f.phase), ['brd', 'design'],
    'exactly the two gates the audited run silently skipped');
  assert.ok(found.every((f) => /no receipt/i.test(f.reason)));
});

test('a waiver is not a skipped gate — deliberately headless is a different fact', () => {
  const found = detectSkippedGates('gated', world({
    artifacts: ['brd', 'spec'],
    receipts: { brd: { status: 'waived', waived_by: '--auto' }, spec: { status: 'approved' } },
  }));
  assert.deepStrictEqual(found, []);
});

test('a changes-requested receipt is reported — the loop never reached approval', () => {
  const found = detectSkippedGates('gated', world({
    artifacts: ['spec'],
    receipts: { spec: { status: 'changes-requested' } },
  }));
  assert.deepStrictEqual(found.map((f) => f.phase), ['spec']);
});

test('a phase that never ran is not a skipped gate', () => {
  // /build stopping after Phase 2 has not skipped design — it has not reached it.
  const found = detectSkippedGates('gated', world({
    artifacts: ['brd', 'spec'],
    receipts: { brd: { status: 'approved' }, spec: { status: 'approved' } },
  }));
  assert.deepStrictEqual(found, []);
});

test('lanes that own no planning gate are never reported, however full specs/ is', () => {
  // This is the false-block case a hook gate could not avoid: /feature, /change,
  // /vibe and /refactor all reach /auto writing no BRD, and in any repo that has
  // run /build once the specs/ directories are populated forever after.
  const populated = world({
    artifacts: ['brd', 'spec', 'design', 'test'],
    receipts: {},
  });
  for (const lane of ['feature', 'change', 'vibe', 'refactor', 'gate', 'freeform', 'unknown']) {
    assert.deepStrictEqual(detectSkippedGates(lane, populated), [], `${lane} owns no planning gate`);
  }
});

test('the lane-to-phases map is explicit, so adding a lane is a decision', () => {
  assert.deepStrictEqual(EXPECTED_PHASES.gated, ['brd', 'spec', 'design', 'test']);
  assert.deepStrictEqual(EXPECTED_PHASES.sprint, ['brd', 'spec', 'design']);
  assert.strictEqual(EXPECTED_PHASES.feature, undefined);
  assert.strictEqual(EXPECTED_PHASES.finalize, undefined);
});

test('a lane string with stray whitespace still resolves', () => {
  const found = detectSkippedGates(' gated ', world({ artifacts: ['brd'], receipts: {} }));
  assert.deepStrictEqual(found.map((f) => f.phase), ['brd'],
    'record-run writes lanes like "build --auto"; the base lane is what carries the gates');
});

// The lane vocabulary is NOT the command name. record-run.js writes
// parseBuildInvocation().lane, which build-lane.js defines as gated | auto |
// autonomous | lite | lite-auto | lite-autonomous | finalize. "build" is never
// written. Keying on "build" made the sensor inert for every real /build run —
// the exact incident its own header cites — and every test hand-injected the
// lane, so nothing exercised the real value and it shipped green.
const { parseBuildInvocation } = require('../.claude/scripts/build-lane.js');
const { appliesTo } = require('../.claude/hooks/lib/gate-receipt-sensor.js');

test('the sensor applies to every lane /build actually writes', () => {
  const invocations = [
    '/build prd.md', '/build prd.md --auto', '/build prd.md --autonomous',
    '/build prd.md --lite', '/build prd.md --lite --auto',
  ];
  for (const prompt of invocations) {
    const { lane } = parseBuildInvocation(prompt);
    assert.strictEqual(appliesTo(lane), true,
      `/build wrote lane "${lane}" — the sensor must apply to it`);
  }
});

test('finalize is not applicable — it runs the tail, not the planning phases', () => {
  const { lane } = parseBuildInvocation('/build --finalize');
  assert.strictEqual(lane, 'finalize');
  assert.strictEqual(appliesTo('finalize'), false);
});

test('/sprint keeps its own lane name, which is the command', () => {
  assert.strictEqual(appliesTo('sprint'), true);
});

test('lanes that own no planning gate still do not apply', () => {
  for (const lane of ['loop', 'feature', 'vibe', 'change', 'gate', '', null, undefined]) {
    assert.strictEqual(appliesTo(lane), false, `${lane} owns no planning gate`);
  }
});

test('a real gated lane with missing receipts reports them', () => {
  const { lane } = parseBuildInvocation('/build prd.md');
  const found = detectSkippedGates(lane, world({
    artifacts: ['brd', 'spec', 'design'], receipts: { spec: { status: 'approved' } },
  }));
  assert.deepStrictEqual(found.map((f) => f.phase), ['brd', 'design'],
    'the two gates the audited run skipped, via the lane record-run really writes');
});
