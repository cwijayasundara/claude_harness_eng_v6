'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const AUTO = readSkillCorpus('auto');

test('/auto documents that the concurrency caps are hook-enforced', () => {
  assert.match(AUTO, /concurrency-gate/);
  assert.match(AUTO, /max_concurrent_agents|CLAUDE_MAX_CONCURRENT_AGENTS/);
  assert.match(AUTO, /backpressure|wait for in-flight|denied/i);
});
