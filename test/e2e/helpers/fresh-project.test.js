'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { freshProject } = require('./fresh-project');

test('freshProject resets a dir under test/e2e and seeds the PRD', () => {
  const dir = path.join(__dirname, '..', 'tmp-fresh-project-test');
  const prd = path.join(__dirname, '..', 'fixtures', 'counter-prd.md');
  try {
    freshProject(dir, prd);
    assert.ok(fs.existsSync(path.join(dir, '.git')), 'git repo initialized');
    assert.ok(fs.existsSync(path.join(dir, 'prd.md')), 'PRD seeded');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('freshProject refuses to wipe a path outside test/e2e (no rm)', () => {
  assert.throws(() => freshProject('/tmp/evil-e2e-target', null), /refusing to wipe/);
});
