const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeHookProject, runHook } = require('./helpers/hook-fixture');

const HOOK = 'auto-continue-on-stop.js';
const ON = { CLAUDE_AUTO_CONTINUE: '1' };
// Explicit off — empty string reads as disabled (see enabled() in the hook).
// Set it rather than relying on an absent ambient var, since the harness's own
// settings.json now ships CLAUDE_AUTO_CONTINUE=1 and would leak into the runner.
const OFF = { CLAUDE_AUTO_CONTINUE: '' };

function writeProgress(projectDir, fields) {
  const body = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n';
  fs.writeFileSync(path.join(projectDir, 'claude-progress.txt'), body);
}

function writeFeatures(projectDir, passes) {
  const arr = passes.map((p, i) => ({ id: `F${i}`, passes: p }));
  fs.writeFileSync(path.join(projectDir, 'features.json'), JSON.stringify(arr));
}

function statePath(projectDir, name) {
  return path.join(projectDir, '.claude', 'state', name);
}

function seedState(projectDir, count, progress) {
  if (count !== undefined) fs.writeFileSync(statePath(projectDir, 'auto-continue-count'), `${count}\n`);
  if (progress !== undefined) fs.writeFileSync(statePath(projectDir, 'auto-continue-progress'), `${progress}\n`);
}

test('no-ops entirely when CLAUDE_AUTO_CONTINUE is off, even with work remaining', async () => {
  const projectDir = makeHookProject([HOOK]);
  writeProgress(projectDir, { groups_remaining: '[A]', current_group: 'A', next_action: 'build' });
  const result = await runHook(projectDir, HOOK, {}, OFF);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '', `expected silence, got: ${result.stdout}`);
});

test('blocks the stop when an active build has work remaining', async () => {
  const projectDir = makeHookProject([HOOK]);
  writeProgress(projectDir, { groups_remaining: '[A]', current_group: 'A', features_passing: '0 / 2', next_action: 'build' });
  writeFeatures(projectDir, [false, false]);
  const result = await runHook(projectDir, HOOK, {}, ON);
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.decision, 'block');
  assert.match(out.reason, /Resume the build/);
});

test('does not block when next_action is DONE', async () => {
  const projectDir = makeHookProject([HOOK]);
  writeProgress(projectDir, { groups_remaining: '[]', current_group: 'none', next_action: 'DONE — all groups complete' });
  writeFeatures(projectDir, [true, true]);
  const result = await runHook(projectDir, HOOK, {}, ON);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '', `expected silence, got: ${result.stdout}`);
});

test('does not block when no group is active and no feature is failing', async () => {
  const projectDir = makeHookProject([HOOK]);
  writeProgress(projectDir, { groups_remaining: '[]', current_group: 'none', next_action: 'Run /build to start' });
  writeFeatures(projectDir, [true, true]);
  const result = await runHook(projectDir, HOOK, {}, ON);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
});

test('does not block a freshly scaffolded project (failing features but none passing yet)', async () => {
  const projectDir = makeHookProject([HOOK]);
  writeProgress(projectDir, { groups_remaining: '[]', current_group: 'none', next_action: 'Run /build to start' });
  writeFeatures(projectDir, [false, false]); // nothing started
  const result = await runHook(projectDir, HOOK, {}, ON);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
});

test('defers to the review gate while a review cycle is open', async () => {
  const projectDir = makeHookProject([HOOK]);
  writeProgress(projectDir, { groups_remaining: '[A]', current_group: 'A', next_action: 'build' });
  fs.writeFileSync(statePath(projectDir, 'review-block-count'), '1');
  const result = await runHook(projectDir, HOOK, {}, ON);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '', `expected deferral, got: ${result.stdout}`);
  // counter must not advance while deferring
  assert.ok(!fs.existsSync(statePath(projectDir, 'auto-continue-count')));
});

test('resets the no-progress budget when a new feature passes', async () => {
  const projectDir = makeHookProject([HOOK]);
  writeProgress(projectDir, { groups_remaining: '[A]', current_group: 'A', next_action: 'build' });
  writeFeatures(projectDir, [true, true, false]); // 2 passing now
  seedState(projectDir, 3, 1); // last turn only 1 was passing
  const result = await runHook(projectDir, HOOK, {}, ON);
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.decision, 'block');
  assert.strictEqual(fs.readFileSync(statePath(projectDir, 'auto-continue-count'), 'utf8').trim(), '0');
  assert.strictEqual(fs.readFileSync(statePath(projectDir, 'auto-continue-progress'), 'utf8').trim(), '2');
});

test('increments the budget when there is no new passing feature', async () => {
  const projectDir = makeHookProject([HOOK]);
  writeProgress(projectDir, { groups_remaining: '[A]', current_group: 'A', next_action: 'build' });
  writeFeatures(projectDir, [true, false]); // 1 passing
  seedState(projectDir, 1, 1); // same as last turn
  const result = await runHook(projectDir, HOOK, {}, ON);
  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.decision, 'block');
  assert.match(out.reason, /2\/5/);
  assert.strictEqual(fs.readFileSync(statePath(projectDir, 'auto-continue-count'), 'utf8').trim(), '2');
});

test('fails open loudly after the no-progress budget is exhausted', async () => {
  const projectDir = makeHookProject([HOOK]);
  writeProgress(projectDir, { groups_remaining: '[A]', current_group: 'A', features_passing: '1 / 2', next_action: 'build' });
  writeFeatures(projectDir, [true, false]);
  seedState(projectDir, 5, 1); // already at the cap, no progress
  const result = await runHook(projectDir, HOOK, {}, ON);
  assert.strictEqual(result.status, 0);
  assert.ok(!result.stdout.startsWith('{'), `expected no block, got: ${result.stdout}`);
  assert.match(result.stdout, /STUCK/);
  assert.strictEqual(fs.readFileSync(statePath(projectDir, 'auto-continue-count'), 'utf8').trim(), '0');
  const errLog = fs.readFileSync(statePath(projectDir, 'hook-errors.log'), 'utf8');
  assert.match(errLog, /no feature progress/);
});
