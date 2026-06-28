'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const AUTO = fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'skills', 'auto', 'SKILL.md'), 'utf8');

test('/auto documents that the concurrency caps are hook-enforced', () => {
  assert.match(AUTO, /concurrency-gate/);
  assert.match(AUTO, /max_concurrent_agents|CLAUDE_MAX_CONCURRENT_AGENTS/);
  assert.match(AUTO, /backpressure|wait for in-flight|denied/i);
});
