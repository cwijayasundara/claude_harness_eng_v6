'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const { loadTasks, stageFixture, runTask, runAll } = require('./evals/run-evals.js');

// The model invocation is injected, so the runner's orchestration — fixture
// staging, transcript assertion, change detection, pass/fail counting, and error
// handling — is verified here with a fake invoker. No model, no API key.

const FIXTURES = path.join(__dirname, 'evals', 'fixtures');

function task(overrides) {
  return { id: 't', behavior: 'b', fixture: 'clean-app', prompt: 'p', assertions: [], ...overrides };
}

test('stageFixture makes an independent pristine + working copy', () => {
  const { fixtureDir, workDir } = stageFixture(FIXTURES, 'clean-app');
  assert.ok(fs.existsSync(path.join(fixtureDir, 'app.js')));
  assert.ok(fs.existsSync(path.join(workDir, 'app.js')));
  fs.writeFileSync(path.join(workDir, 'app.js'), 'changed');
  assert.notStrictEqual(
    fs.readFileSync(path.join(workDir, 'app.js'), 'utf8'),
    fs.readFileSync(path.join(fixtureDir, 'app.js'), 'utf8'),
    'mutating the work copy does not touch the pristine copy'
  );
});

test('the invoker runs in a workdir already staged with the fixture', () => {
  let sawFixture = false;
  const invoke = ({ cwd }) => { sawFixture = fs.existsSync(path.join(cwd, 'app.js')); return 'ok'; };
  runTask(task(), { invoke, fixturesDir: FIXTURES });
  assert.ok(sawFixture, 'invoke received a cwd containing the staged fixture');
});

test('runTask passes when the transcript matches and nothing changed', () => {
  const invoke = () => 'I asked: which kind of validation did you want?';
  const r = runTask(task({ assertions: [
    { type: 'transcript_matches', pattern: 'which kind' },
    { type: 'workdir_unchanged' },
  ] }), { invoke, fixturesDir: FIXTURES });
  assert.strictEqual(r.pass, true);
  assert.deepStrictEqual(r.failures, []);
});

test('runTask fails when the agent changes files under workdir_unchanged', () => {
  const invoke = ({ cwd }) => { fs.writeFileSync(path.join(cwd, 'app.js'), 'mutated'); return 'done'; };
  const r = runTask(task({ assertions: [{ type: 'workdir_unchanged' }] }), { invoke, fixturesDir: FIXTURES });
  assert.strictEqual(r.pass, false);
  assert.ok(r.failures.length >= 1);
});

test('runTask captures an invoker error instead of crashing', () => {
  const invoke = () => { throw new Error('boom'); };
  const r = runTask(task({ assertions: [{ type: 'transcript_matches', pattern: 'INVOKE_ERROR' }] }),
    { invoke, fixturesDir: FIXTURES });
  assert.strictEqual(r.pass, true, 'the error surfaced in the transcript and was asserted on');
});

test('runAll tallies passed and failed across tasks', () => {
  const invoke = () => 'hello';
  const tasks = [
    task({ id: 'ok', assertions: [{ type: 'transcript_matches', pattern: 'hello' }] }),
    task({ id: 'bad', assertions: [{ type: 'transcript_matches', pattern: 'goodbye' }] }),
  ];
  const { passed, failed, results } = runAll(tasks, { invoke, fixturesDir: FIXTURES });
  assert.strictEqual(passed, 1);
  assert.strictEqual(failed, 1);
  assert.deepStrictEqual(results.map((r) => r.id), ['ok', 'bad']);
});

test('loadTasks reads the committed task suite', () => {
  const tasks = loadTasks(path.join(__dirname, 'evals', 'tasks.json'));
  assert.ok(Array.isArray(tasks) && tasks.length > 0);
});
