#!/usr/bin/env node

'use strict';

// PostToolUse(Bash) — the red-phase recorder (gap G41).
//
// Watches Bash for test runs and records what they said, so the harness can tell
// a test that FAILED FIRST (TDD) from one written to match code already there
// (a tautological test, catalogue #11). `tdd-test-first` in pre-write-gate.js
// proves a test EXISTS; nothing proved it ever failed. Its own comment says
// "pair with tdd-guard for red-green ordering" — this is that pair.
//
// Observation only: this hook never blocks. It writes the evidence that
// hooks/lib/test-write-lock.js (G42, session) and the test-integrity gate (G43,
// commit) then act on. Keeping the recorder non-blocking means a
// misclassification costs a spurious ledger row, never a wedged session.
//
// Classification is in lib/red-phase.js, durability in lib/red-phase-ledger.js;
// this file is only plumbing — the same split test-deletion-gate.js uses.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveProjectDir, runHook, reportFailure } = require('./lib/common');
const { classifyRun } = require('./lib/red-phase');
const { appendRun } = require('./lib/red-phase-ledger');
const { loadEnvelope } = require('./lib/task-envelope');

function headSha(projectDir) {
  try {
    return String(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectDir, encoding: 'utf8' })).trim();
  } catch (_) {
    return null; // no commits yet, or not a repo — the record is still useful
  }
}

function responseText(toolResponse) {
  const tr = toolResponse || {};
  if (typeof tr === 'string') return tr;
  return [tr.stdout, tr.stderr, tr.output, tr.error]
    .filter((x) => typeof x === 'string')
    .join('\n');
}

// Hash the test text AS IT RAN. This is what makes the G43 proof exact — it
// compares the text at the red run against the text at the green run, so a test
// weakened in between is arithmetic rather than opinion. A file we cannot read
// contributes no hash, and appendRun then refuses the whole record rather than
// storing a half-verifiable one.
function hashTestFiles(projectDir, files) {
  const hashes = {};
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(projectDir, file));
      hashes[file] = crypto.createHash('sha256').update(content).digest('hex');
    } catch (_) { /* unreadable — left absent on purpose */ }
  }
  return hashes;
}

function activeTaskId(projectDir) {
  const loaded = loadEnvelope(projectDir);
  return loaded.envelope ? loaded.envelope.task_id : null;
}

runHook('red-phase-record', (input) => {
  const command = (input.tool_input || {}).command;
  if (typeof command !== 'string' || !command) return;

  const projectDir = resolveProjectDir(path.dirname(path.resolve(__filename)));
  const run = classifyRun({ command, text: responseText(input.tool_response) });

  // Not a test run, or the environment was broken so nothing was proved. An
  // env-broken run is deliberately NOT recorded: `pytest` exiting non-zero
  // because pytest is absent would otherwise arm a lock against a test that
  // never ran.
  if (!run.isTestRun || run.verdict === 'env-broken' || !run.testFiles.length) return;

  try {
    appendRun(projectDir, {
      task_id: activeTaskId(projectDir),
      runner: run.runner,
      verdict: run.verdict,
      test_files: run.testFiles,
      file_hashes: hashTestFiles(projectDir, run.testFiles),
      head_sha: headSha(projectDir),
      command,
    });
  } catch (err) {
    // A recorder that cannot write must say so — a silently empty ledger looks
    // exactly like a project where every test passed first time.
    reportFailure('red-phase-record', err, { record: false });
  }
});
