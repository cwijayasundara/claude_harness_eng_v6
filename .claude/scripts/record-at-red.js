#!/usr/bin/env node

'use strict';

// Receipt-recording half of gap G23 (at-first-proof). Mirrors record-
// coverage-verdict.js's role for G17: writing-acceptance-tests-first's
// Process step 5 ("Run it. Confirm it fails for the right reason.") was a
// prompt-level instruction only, with nothing proving the run actually
// happened. This wraps that run: it executes the story's AT test command
// and, when the command FAILS (the AT is red), appends a receipt
// {storyId, atPath, observedRedAt, testCmd} to
// specs/reviews/at-red-receipts.jsonl — the same append-only, gitignored
// (**/specs/reviews/) convention coverage-verdicts.jsonl already uses.
//
// When the command PASSES (green), no receipt is written: per the skill's
// own Red Flags, "An AT that passes against unmodified/unimplemented code"
// proves nothing. This script instead prints that exact rationale and exits
// non-zero, so the calling skill step's transcript makes the non-receipt
// outcome loud rather than silently absent.
//
// Known limitation (disclosed, not hidden — the same "disclosed, not
// silently accepted" precedent G17 sets for its own two limitations, see
// HARNESS.md G23): a receipt's timestamp mechanically proves the AT was
// confirmed red AT SOME POINT before commit. It cannot prove strict
// chronological ordering relative to a specific later implementation commit
// without fragile git-history archaeology — the value this proves is "the
// AT existed and was proven red," not "provably happened strictly before
// every line of the implementation diff."
//
// CLI: node .claude/scripts/record-at-red.js --story <story-id>
//        --at-file <path-to-AT> --test-cmd "<cmd>" [--root DIR]
//        [--out specs/reviews/at-red-receipts.jsonl]

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEFAULT_OUT = path.join('specs', 'reviews', 'at-red-receipts.jsonl');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

function resolveOutPath(root, argv) {
  const out = arg(argv, '--out', DEFAULT_OUT);
  return path.isAbsolute(out) ? out : path.join(root, out);
}

function appendReceipt(outPath, receipt) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.appendFileSync(outPath, JSON.stringify(receipt) + '\n');
}

// Runs the AT's own test command. Mirrors mutation-smoke.js's runMutant
// pattern exactly: execSync throwing (non-zero exit, or a timeout) means the
// command failed, i.e. the AT is red. No throw means the AT passed (green).
// testCmd is the operator's own test command, run through a shell because it
// needs shell features — configuration, never untrusted input.
function runTestCmd(testCmd, cwd, execFn) {
  const runner = execFn || ((cmd, opts) => execSync(cmd, opts));
  try {
    runner(testCmd, { cwd, stdio: 'ignore' });
    return false; // green
  } catch (_) {
    return true; // red
  }
}

function usage() {
  process.stderr.write(
    'usage: record-at-red.js --story <story-id> --at-file <path> ' +
    '--test-cmd "<cmd>" [--root DIR] [--out <path>]\n'
  );
}

function reportGreen() {
  process.stdout.write(
    'record-at-red: AT PASSED against current code — no receipt recorded.\n' +
    '  "An AT that passes against unmodified/unimplemented code proves nothing"\n' +
    '  (writing-acceptance-tests-first Red Flags).\n' +
    '  Fix: the AT must fail for the right reason (missing implementation, or the\n' +
    '  assigned behavior simply missing) before implementation proceeds.\n'
  );
}

function run(argv, root, deps) {
  const story = arg(argv, '--story', null);
  const atFile = arg(argv, '--at-file', null);
  const testCmd = arg(argv, '--test-cmd', null);
  if (!story || !atFile || !testCmd) {
    usage();
    return 2;
  }
  const now = (deps && deps.now) || (() => new Date().toISOString());
  const outPath = resolveOutPath(root, argv);
  const isRed = runTestCmd(testCmd, root, deps && deps.exec);

  if (!isRed) {
    reportGreen();
    return 1;
  }

  appendReceipt(outPath, { storyId: story, atPath: atFile, observedRedAt: now(), testCmd });
  process.stdout.write(`record-at-red: AT confirmed RED for story ${story} — receipt recorded (${outPath}).\n`);
  return 0;
}

module.exports = { run, resolveOutPath, appendReceipt, runTestCmd };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
