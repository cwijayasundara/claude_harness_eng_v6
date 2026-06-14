#!/usr/bin/env node

'use strict';

// Behavioral eval runner. Each golden task (tasks.json) stages its fixture into a
// throwaway workdir, drives Claude with the task prompt, and applies the
// deterministic assertion engine to the transcript + resulting files.
//
// The model invocation is the only non-deterministic part; it is isolated in
// claudeInvoke and injected everywhere else, so run-evals's orchestration is
// unit-tested with a fake invoker (test/evals-runner.test.js) and the task specs
// are structurally validated (test/evals-tasks.test.js) — both in plain `npm
// test`. The real model run is gated on an API key and run via `npm run
// test:evals` (locally or in the guarded CI job).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { applyAssertions } = require('./helpers/assertions.js');

function loadTasks(tasksPath) {
  return JSON.parse(fs.readFileSync(tasksPath, 'utf8')).tasks || [];
}

// Stage a pristine copy (for change-detection) and a working copy (where the
// agent operates). workdir_unchanged/files_unchanged compare the two.
function stageFixture(fixturesDir, fixture) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-'));
  const src = path.join(fixturesDir, fixture);
  const fixtureDir = path.join(base, 'fixture');
  const workDir = path.join(base, 'work');
  fs.cpSync(src, fixtureDir, { recursive: true });
  fs.cpSync(src, workDir, { recursive: true });
  return { base, fixtureDir, workDir };
}

function runTask(task, { invoke, fixturesDir }) {
  const { fixtureDir, workDir } = stageFixture(fixturesDir, task.fixture);
  let transcript;
  try {
    transcript = invoke({ prompt: task.prompt, cwd: workDir, plugin: !!task.plugin, model: process.env.EVAL_MODEL }) || '';
  } catch (e) {
    transcript = `INVOKE_ERROR: ${e.message}`;
  }
  const failures = applyAssertions(task.assertions, { transcript, fixtureDir, workDir });
  return { id: task.id, behavior: task.behavior, pass: failures.length === 0, failures };
}

function runAll(tasks, opts) {
  const results = tasks.map((t) => runTask(t, opts));
  return { results, passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length };
}

// The isolated, brittle part: shell out to the Claude Code CLI in print mode.
// Flags may vary by CLI version; override the binary with EVAL_CLAUDE_BIN.
function claudeInvoke({ prompt, cwd, plugin, model }) {
  const args = ['-p', prompt, '--output-format', 'text', '--permission-mode', 'bypassPermissions'];
  if (model) args.push('--model', model);
  if (plugin) args.push('--plugin-dir', path.join(__dirname, '..', '..', '.claude'));
  return execFileSync(process.env.EVAL_CLAUDE_BIN || 'claude', args, { cwd, timeout: 600000, encoding: 'utf8' });
}

function main() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.EVAL_CLAUDE_BIN) {
    process.stdout.write('test:evals — skipped (set ANTHROPIC_API_KEY to run model evals; ' +
      'task specs + assertion engine are validated in `npm test`)\n');
    process.exit(0);
  }
  let tasks = loadTasks(path.join(__dirname, 'tasks.json'));
  if (process.env.EVAL_TASK) tasks = tasks.filter((t) => t.id === process.env.EVAL_TASK);
  const { results, passed, failed } = runAll(tasks, { invoke: claudeInvoke, fixturesDir: path.join(__dirname, 'fixtures') });
  for (const r of results) {
    process.stdout.write(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} — ${r.behavior}\n`);
    for (const f of r.failures) process.stdout.write(`    - ${f}\n`);
  }
  process.stdout.write(`evals: ${passed} passed, ${failed} failed of ${results.length}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

module.exports = { loadTasks, stageFixture, runTask, runAll };

if (require.main === module) main();
