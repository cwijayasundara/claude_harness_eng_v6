'use strict';

// Every lane that writes production code must reach a reviewer, and must name
// that reviewer itself.
//
// This exists because /vibe lost its review silently. Its Step 7 read "the Stop
// hook requires reviewer agents before the turn ends" — true when written, false
// after the per-turn review gate was removed from review-on-stop.js, which is
// now purely advisory. /vibe named no reviewer of its own, so the lightest lane
// (the one most likely to touch production code casually) ended up the only one
// with no agentic review at all. Nothing failed; the promise in CLAUDE.md simply
// stopped being kept.
//
// The rule these assertions encode: a lane's review is wired IN THE LANE. A lane
// that delegates review to a shared mechanism cannot tell when that mechanism
// changes underneath it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Lanes a human can invoke that end with production code changed. /brownfield,
// /code-map and /status are absent because they never write source.
const WRITING_LANES = ['vibe', 'change', 'refactor', 'implement', 'auto', 'gate'];

// Areas where a review must be a SECURITY review, not just a code review.
const BOUNDARY = /auth|secret|persistence|migration|payment|upload|input handling/i;

test('every production-code lane names a reviewer agent itself', () => {
  for (const lane of WRITING_LANES) {
    assert.match(
      readSkillCorpus(lane), /code-reviewer/,
      `/${lane} writes production code but names no reviewer — review inherited from a shared `
      + 'mechanism is review that can disappear without the lane noticing',
    );
  }
});

test('no lane claims the Stop hook enforces review — it does not', () => {
  // The exact stale sentence that made /vibe look reviewed for as long as it was not.
  for (const lane of WRITING_LANES) {
    assert.doesNotMatch(
      readSkillCorpus(lane), /Stop hook requires reviewer agents/i,
      `/${lane} cites a gate that review-on-stop.js explicitly removed`,
    );
  }
});

test('review-on-stop stays advisory, and says so where a reader will look', () => {
  const hook = read('.claude/hooks/review-on-stop.js');
  assert.match(hook, /purely advisory/,
    'if this hook ever blocks again, the lanes must be updated deliberately, not by accident');
});

test('/vibe runs a standard-tier review and escalates rather than reviewing security', () => {
  const vibe = readSkillCorpus('vibe');
  assert.match(vibe, /review-tier\.js/, '/vibe must resolve its review tier like every other lane');
  assert.match(vibe, /Step 7 — Review \[REQUIRED\]/,
    'an optional review in the lane most likely to be used casually is not a review');
  assert.match(vibe, /BLOCK/, '/vibe must state what a blocking finding does');
  assert.match(vibe, /[Ee]scalate to `\/change`/,
    'a security finding means the change was misclassified, not that /vibe should review it');
  assert.doesNotMatch(vibe, /[Ss]pawn.*security-reviewer/,
    'a lane that reviews security work will start accepting security work');
});

test('lanes that may cross a security boundary reach security-reviewer', () => {
  for (const lane of ['change', 'refactor', 'auto', 'gate']) {
    const corpus = readSkillCorpus(lane);
    assert.match(corpus, /security-reviewer/,
      `/${lane} can move a trust boundary and must be able to reach a security review`);
    assert.match(corpus, BOUNDARY,
      `/${lane} must say which areas trigger the security review, not leave it to taste`);
  }
});
