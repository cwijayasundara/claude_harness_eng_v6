'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

// Structural gate for the behavioral eval suite. The golden tasks define how the
// harness's agents/skills must behave; the model run is gated on a key, but every
// task definition is validated deterministically here so a malformed or
// dangling spec fails CI immediately — the behavioral contracts stay first-class.

const ROOT = path.join(__dirname, '..');
const TASKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'evals', 'tasks.json'), 'utf8'));
const FIXTURES = path.join(ROOT, 'test', 'evals', 'fixtures');

// Single source of truth: the types the assertion engine actually dispatches.
const KNOWN_ASSERTIONS = new Set([
  'transcript_matches', 'transcript_not_matches', 'files_unchanged', 'workdir_unchanged',
  'file_exists', 'file_absent', 'file_matches', 'fixture_tests_pass',
]);

const REQUIRED_FIELD = {
  transcript_matches: 'pattern',
  transcript_not_matches: 'pattern',
  file_matches: 'path',
  file_exists: 'path',
  file_absent: 'path',
  files_unchanged: 'paths',
  fixture_tests_pass: 'expect',
};

test('tasks.json parses and contains a non-empty task list', () => {
  assert.ok(Array.isArray(TASKS.tasks) && TASKS.tasks.length > 0);
});

test('the known-assertion set matches the engine dispatch (no drift)', () => {
  const engine = fs.readFileSync(path.join(ROOT, 'test', 'evals', 'helpers', 'assertions.js'), 'utf8');
  for (const type of KNOWN_ASSERTIONS) {
    assert.match(engine, new RegExp(`'${type}'`), `assertions.js dispatches ${type}`);
  }
});

test('every task id is present and unique', () => {
  const ids = TASKS.tasks.map((t) => t.id);
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0), 'ids are non-empty strings');
  assert.strictEqual(new Set(ids).size, ids.length, 'ids are unique');
});

test('every task has the required descriptive + run fields', () => {
  for (const t of TASKS.tasks) {
    assert.ok(typeof t.behavior === 'string' && t.behavior.length > 0, `${t.id}: behavior`);
    assert.ok(typeof t.prompt === 'string' && t.prompt.length > 0, `${t.id}: prompt`);
    assert.ok(typeof t.fixture === 'string' && t.fixture.length > 0, `${t.id}: fixture`);
    assert.ok(Array.isArray(t.assertions) && t.assertions.length > 0, `${t.id}: assertions`);
  }
});

test("every task's fixture directory exists", () => {
  for (const t of TASKS.tasks) {
    assert.ok(fs.existsSync(path.join(FIXTURES, t.fixture)), `${t.id}: fixture dir ${t.fixture} missing`);
  }
});

test('every assertion uses a known type and carries its required field', () => {
  for (const t of TASKS.tasks) {
    for (const a of t.assertions) {
      assert.ok(KNOWN_ASSERTIONS.has(a.type), `${t.id}: unknown assertion type ${a.type}`);
      const field = REQUIRED_FIELD[a.type];
      if (field) assert.ok(a[field] != null, `${t.id}: ${a.type} missing ${field}`);
    }
  }
});

test('transcript/file patterns are valid regular expressions', () => {
  for (const t of TASKS.tasks) {
    for (const a of t.assertions) {
      if (a.pattern != null) assert.doesNotThrow(() => new RegExp(a.pattern), `${t.id}: bad regex ${a.pattern}`);
    }
  }
});
