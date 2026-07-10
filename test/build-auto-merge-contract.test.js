'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const BUILD = readSkillCorpus('build');

test('/build documents the --auto-merge flag and AUTO_MERGE env', () => {
  assert.match(BUILD, /--auto-merge/);
  assert.match(BUILD, /AUTO_MERGE/);
});

test('/build Phase 11 calls auto-merge.js after gh pr create', () => {
  assert.match(BUILD, /auto-merge\.js/);
});

test('Phase 11 no longer flatly forbids merge (AUTO_MERGE is the documented opt-out)', () => {
  // the old "Do not merge." absolute is replaced; "merge stays human unless" survives
  assert.match(BUILD, /unless.*AUTO_MERGE|AUTO_MERGE.*unless|merge stays human/i);
});
