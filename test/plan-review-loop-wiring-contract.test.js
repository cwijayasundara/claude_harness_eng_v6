'use strict';

// Locks the human plan-review loop into the pipeline. Assertions are about the
// seam — that all three planning phases run the loop, that each downstream phase
// blocks on the receipt, and that the headless lanes record a waiver instead of
// silently skipping. The receipt/gate logic itself is plan-approval.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { shipsIn } = require('./helpers/pack-membership');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { PHASES } = require(path.join(ROOT, '.claude/scripts/plan-approval.js'));

test('package.json exposes the gate', () => {
  assert.strictEqual(
    JSON.parse(read('package.json')).scripts['plan-approval'],
    'node .claude/scripts/plan-approval.js',
  );
});

test('every phase the gate knows about actually runs the loop', () => {
  for (const phase of PHASES) {
    const corpus = readSkillCorpus(phase);
    assert.match(corpus, /plan-review-loop/, `/${phase} must invoke the shared review loop`);
    assert.match(corpus, /plan-approval\.js/, `/${phase} must record its review rounds`);
    assert.match(
      corpus, new RegExp(`--phase ${phase}\\b`),
      `/${phase} must record under its own phase name`,
    );
  }
});

test('each planning phase blocks on the previous phase review, and /auto on all three', () => {
  assert.match(
    readSkillCorpus('design'), /plan-approval\.js check --phase spec/,
    '/design must not design against an unapproved story graph',
  );
  const testCorpus = readSkillCorpus('test');
  assert.match(
    testCorpus, /plan-approval\.js check --phase spec/,
    '/test must not write obligations against an unreviewed decomposition',
  );
  assert.doesNotMatch(
    testCorpus, /plan-approval\.js check --phase design/,
    '/test --plan-only runs concurrently with /design in Phase 3; gating on design would deadlock it',
  );
  assert.match(
    readSkillCorpus('auto'), /plan-approval\.js check --phase all/,
    '/auto must not build a plan no human closed the loop on',
  );
});

test('/auto states the block as a hard one, naming the post-approval-edit case', () => {
  const auto = readSkillCorpus('auto');
  assert.match(auto, /HARD BLOCK/, 'a prose-only suggestion is what this control replaces');
  assert.match(auto, /edited after approval|changed since approval/i,
    'the staleness case is the one a reader is most likely to miss');
});

test('the headless lanes record a waiver rather than leaving the receipt absent', () => {
  const build = readSkillCorpus('build');
  assert.match(build, /plan-approval\.js waive/, '/build must waive for the collapsed lanes');
  assert.match(build, /--lane --auto(nomous)?\b/, 'a waiver must name the lane that granted it');
  const loop = read('.claude/skills/plan-review-loop/SKILL.md');
  assert.match(loop, /--require-human/, 'the loop must document how a gated lane refuses waivers');
});

test('the loop keeps the dialogue shape that distinguishes it from approve/reject', () => {
  const loop = read('.claude/skills/plan-review-loop/SKILL.md');
  for (const [label, pattern] of [
    ['a review brief rather than an artifact dump', /review brief/i],
    ['one question at a time', /[Oo]ne question at a time/],
    ['alternatives at contested forks', /2[–-]3 alternatives/],
    ['a changelog that surfaces declined feedback', /changelog/i],
    ['a round cap so the loop cannot hang', /[Rr]ound cap/],
  ]) {
    assert.match(loop, pattern, `the loop must keep ${label}`);
  }
  assert.match(loop, /clarify/, 'the question budget is reused from /clarify, not reinvented');
});

test('each phase names where its own uncertainty already lives', () => {
  // brd joined this list late. It carried the [REQUIRED SUB-SKILL] header while
  // its body still said "display the BRD and ask: approve, or provide
  // corrections" — and a real run behaved the way the body said, closing in one
  // round on a one-word reply. A phase with no challenge sources has nothing to
  // build a dialogue out of, so the header alone was never going to hold.
  const sources = {
    brd: /brd-open-questions\.json/,
    spec: /plan-confidence\.json/,
    design: /reasons-canvas\.md/,
    test: /constraint-obligations\.json/,
  };
  for (const [phase, pattern] of Object.entries(sources)) {
    const corpus = readSkillCorpus(phase);
    assert.match(corpus, /[Cc]hallenge sources/, `/${phase} must list what to challenge`);
    assert.match(corpus, pattern, `/${phase} must draw on its own uncertainty signal`);
  }
});

test('no phase gate degrades into the single approve/reject question', () => {
  for (const phase of PHASES) {
    assert.doesNotMatch(
      readSkillCorpus(phase),
      /Approve to proceed to `?\/\w+`?, or provide corrections/,
      `/${phase} must run the loop, not ask one question the human can close with "yes"`,
    );
  }
});

test('manifest and HARNESS.md register both controls with budget justifications', () => {
  const manifest = JSON.parse(read('harness-manifest.json'));
  const sensor = manifest.sensors.find((x) => x.id === 'plan-approval');
  assert.ok(sensor, 'expected a plan-approval sensor entry');
  assert.strictEqual(sensor.axis, 'traceability');
  assert.strictEqual(sensor.cadence, 'planning');
  assert.strictEqual(sensor.status, 'active');
  assert.strictEqual(sensor.wired_at, '.claude/scripts/plan-approval.js');
  assert.ok(sensor.net_add_justification);

  const guide = manifest.guides.find((x) => x.id === 'plan-review-loop');
  assert.ok(guide, 'expected a plan-review-loop guide entry');
  assert.strictEqual(guide.wired_at, '.claude/skills/plan-review-loop/SKILL.md');
  assert.ok(guide.net_add_justification);

  const harness = read('HARNESS.md');
  assert.match(harness, /plan-approval/);
  assert.match(harness, /plan-review-loop/);
});

test('scaffold-copy propagates the loop and its gate to scaffolded projects', () => {
  assert.ok(shipsIn('plan-approval', 'script').includes('core'),
    'the gate must ship wherever the planning phases do');
  assert.ok(shipsIn('plan-review-loop', 'skill').includes('core'),
    'a gate whose skill did not ship would block every scaffolded project');
});
