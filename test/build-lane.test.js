'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { parseBuildInvocation } = require('../.claude/scripts/build-lane.js');
const { readSkillCorpus } = require('./helpers/skill-corpus');

// Phase 4 progressive loading moved Step 0's procedure into references/ —
// read the corpus (SKILL.md + references/*.md) so this contract survives that split.
const BUILD_SKILL = readSkillCorpus('build');

test('full auto and lite flags are order-independent', () => {
  const a = parseBuildInvocation('/build --auto --lite docs/prd.md');
  const b = parseBuildInvocation('/build --lite docs/prd.md --auto');

  assert.strictEqual(a.lane, 'lite-auto');
  assert.deepStrictEqual(b, a);
  assert.strictEqual(a.prdPath, 'docs/prd.md');
  assert.strictEqual(a.humanGates, 0);
  assert.strictEqual(a.requiresPrd, true);
});

test('gated build keeps the per-phase human gates', () => {
  const r = parseBuildInvocation('/build docs/prd.md');

  assert.strictEqual(r.lane, 'gated');
  assert.strictEqual(r.prdPath, 'docs/prd.md');
  assert.strictEqual(r.humanGates, 3);
  assert.strictEqual(r.auto, false);
});

test('autonomous build has one consolidated approval gate', () => {
  const r = parseBuildInvocation('/build docs/prd.md --autonomous --mode lean --pod 3');

  assert.strictEqual(r.lane, 'autonomous');
  assert.strictEqual(r.mode, 'lean');
  assert.strictEqual(r.pod, 3);
  assert.strictEqual(r.humanGates, 1);
});

test('full auto requires a PRD path', () => {
  const r = parseBuildInvocation('/build --auto');

  assert.strictEqual(r.valid, false);
  assert.match(r.error, /PRD/i);
});

test('finalize is an explicit terminal lane', () => {
  const r = parseBuildInvocation('/build --auto --finalize');

  assert.strictEqual(r.lane, 'finalize');
  assert.strictEqual(r.humanGates, 0);
  assert.strictEqual(r.requiresPrd, false);
});

test('PRD path is extracted when it precedes the flags (regression)', () => {
  // The exact invocation that was reported as "no requirements came through".
  const r = parseBuildInvocation('/build docs/todo-cli-brd-prompt.md --lite --auto');

  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.lane, 'lite-auto');
  assert.strictEqual(r.prdPath, 'docs/todo-cli-brd-prompt.md');
  assert.strictEqual(r.requiresPrd, true);
  assert.strictEqual(r.humanGates, 0);
});

test('build SKILL wires the parser as a mandatory first step (no dead code)', () => {
  // The parser only prevents dropped-PRD bugs if the skill actually runs it.
  // Guard against it silently becoming dead code again.
  assert.match(BUILD_SKILL, /build-lane\.js/, 'SKILL.md must invoke build-lane.js');
  assert.match(
    BUILD_SKILL,
    /Step 0[\s\S]*build-lane\.js/,
    'build-lane.js must be invoked as the first step, before phase routing',
  );
  assert.match(
    BUILD_SKILL,
    /Do not parse the flags or the PRD path by hand/i,
    'SKILL.md must forbid hand-parsing the invocation',
  );
});

test('build SKILL feeds the real invocation to the parser via $ARGUMENTS (regression)', () => {
  // The original bug: the parser was wired in but fed a prose placeholder the
  // forked agent could not substitute, so it ran empty and silently resolved to
  // the bare `gated` lane with prdPath:null. The fix is harness interpolation —
  // the parser must be invoked with "$ARGUMENTS", never a "<placeholder>".
  assert.match(
    BUILD_SKILL,
    /build-lane\.js"?\s+"\$ARGUMENTS"/,
    'build-lane.js must be invoked with the interpolated "$ARGUMENTS", not a hand-substituted placeholder',
  );
  assert.doesNotMatch(
    BUILD_SKILL,
    /build-lane\.js"?\s+"<[^>]*>"/,
    'build-lane.js must not be invoked with a prose <placeholder> the fork has to substitute by hand',
  );
});

test('--single-pr is surfaced without changing lane or prd', () => {
  const r = parseBuildInvocation('/build docs/prd.md --auto --single-pr');
  assert.strictEqual(r.lane, 'auto');
  assert.strictEqual(r.prdPath, 'docs/prd.md');
  assert.strictEqual(r.singlePr, true);
});

test('singlePr defaults to false', () => {
  const r = parseBuildInvocation('/build docs/prd.md --auto');
  assert.strictEqual(r.singlePr, false);
});

test('--auto-merge is surfaced without changing lane or prd', () => {
  const r = parseBuildInvocation('/build docs/prd.md --auto --auto-merge');
  assert.strictEqual(r.lane, 'auto');
  assert.strictEqual(r.prdPath, 'docs/prd.md');
  assert.strictEqual(r.autoMerge, true);
});

test('autoMerge defaults to false', () => {
  const r = parseBuildInvocation('/build docs/prd.md --auto');
  assert.strictEqual(r.autoMerge, false);
});
