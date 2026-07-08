#!/usr/bin/env node

'use strict';

// Stop hook — bounded auto-continue for long autonomous runs.
//
// Replaces manually typing "continue" when the orchestrator ends a turn while
// the build still has verifiable unfinished work. OPT-IN: no-ops unless
// CLAUDE_AUTO_CONTINUE=1 (or true), so ordinary interactive sessions are never
// hijacked — you flip it on for an /auto run and off again afterwards.
//
// It nudges ONLY when harness state proves work remains (an incomplete
// current_group/groups_remaining in claude-progress.txt, or a features.json
// feature still failing) AND the build is making progress. The bound is on
// *no feature progress*: while the passing-feature count keeps rising the
// budget resets and it continues indefinitely (it's working); once the count
// stalls for MAX_NO_PROGRESS_CONTINUES consecutive turns it fails open LOUDLY
// and lets the session stop — a stuck build is surfaced to a human, not spun
// forever (the Devin "escalate-don't-spin" distinction).

const fs = require('fs');
const path = require('path');
const { resolveProjectDir, readHookInput, reportFailure } = require('./lib/common');

// Consecutive turns with no new passing feature before the watchdog gives up.
// A single story group can span several stops before any feature flips to pass,
// so this is deliberately loose; past it, the build is stuck (not idle) and a
// human should look.
const MAX_NO_PROGRESS_CONTINUES = 5;

function enabled() {
  const v = (process.env.CLAUDE_AUTO_CONTINUE || '').toLowerCase();
  return v === '1' || v === 'true';
}

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (_) {
    return '';
  }
}

function readIntFile(p) {
  try {
    const n = parseInt(fs.readFileSync(p, 'utf8'), 10);
    return Number.isFinite(n) ? n : null;
  } catch (_) {
    return null;
  }
}

function writeIntFile(p, n) {
  try {
    fs.writeFileSync(p, `${n}\n`);
  } catch (_) {
    /* best effort */
  }
}

function parseField(text, field) {
  const m = text.match(new RegExp(`^${field}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

// Passing-feature count is the progress metric the watchdog bounds on: the
// number of features.json entries with passes===true, falling back to the
// numerator of the progress file's "features_passing: X / Y" line.
function passingFeatures(projectDir) {
  try {
    const arr = JSON.parse(readText(path.join(projectDir, 'features.json')));
    if (Array.isArray(arr)) {
      return {
        passing: arr.filter((f) => f && f.passes === true).length,
        anyFailing: arr.some((f) => f && f.passes === false),
        total: arr.length,
      };
    }
  } catch (_) {
    /* fall through to progress-file parse */
  }
  return null;
}

function hasUnfinishedWork(progress, feats) {
  // Explicit completion marker wins — trust the orchestrator's own DONE.
  if (/^DONE\b/i.test(parseField(progress, 'next_action'))) return false;

  const currentGroup = parseField(progress, 'current_group').toLowerCase();
  if (currentGroup && currentGroup !== 'none' && currentGroup !== '[]') return true;

  const remaining = parseField(progress, 'groups_remaining'); // e.g. "[A, B]" or "[]"
  if (/\[\s*[^\]\s]/.test(remaining)) return true; // non-empty list

  // Only count a failing feature once a build is genuinely underway (some
  // feature has already passed), so a freshly scaffolded project with nothing
  // started is not mistaken for an in-flight build with work remaining.
  if (feats && feats.anyFailing && feats.passing > 0) return true;

  return false;
}

try {
  if (!enabled()) process.exit(0);

  readHookInput(); // drain stdin so Claude Code's pipe closes cleanly
  const projectDir = resolveProjectDir(path.dirname(path.resolve(__filename)));
  const stateDir = path.join(projectDir, '.claude', 'state');
  const countPath = path.join(stateDir, 'auto-continue-count');
  const progressPath = path.join(stateDir, 'auto-continue-progress');

  const progress = readText(path.join(projectDir, 'claude-progress.txt'));
  const feats = passingFeatures(projectDir);

  if (!hasUnfinishedWork(progress, feats)) {
    // Nothing left to do (or explicit DONE) — clear state, let the turn end.
    writeIntFile(countPath, 0);
    writeIntFile(progressPath, -1);
    process.exit(0);
  }

  const passing = feats
    ? feats.passing
    : parseInt((parseField(progress, 'features_passing').match(/(\d+)/) || [])[1] || '0', 10);
  const lastProgress = readIntFile(progressPath);
  const lastProgressN = lastProgress === null ? -1 : lastProgress;
  const totalStr = feats ? `${passing}/${feats.total}` : parseField(progress, 'features_passing') || `${passing}`;
  const remainingNote = `${totalStr} features passing; groups_remaining: ${parseField(progress, 'groups_remaining') || '(unknown)'}`;

  if (passing > lastProgressN) {
    // Build advanced since the last turn — reset the budget and keep going.
    writeIntFile(countPath, 0);
    writeIntFile(progressPath, passing);
    const reason =
      `Autonomous build is progressing (${remainingNote}) but the turn ended with work remaining.\n` +
      `Resume the build: pick up the next unfinished group/story and continue the /auto loop.\n` +
      `This gate clears when all features pass (write "next_action: DONE …" in claude-progress.txt). ` +
      `If you are genuinely BLOCKED on a decision only the user can make, STOP and state the blocker plainly instead of continuing.`;
    process.stdout.write(JSON.stringify({ decision: 'block', reason }));
    process.exit(0);
  }

  // No new passing feature since the last turn.
  const count = readIntFile(countPath) || 0;
  if (count >= MAX_NO_PROGRESS_CONTINUES) {
    // Bounded escape hatch: the build is stuck, not idle. Stop nudging, surface
    // it loudly, and let the session end so a human can intervene.
    writeIntFile(countPath, 0);
    reportFailure(
      'auto-continue-on-stop',
      new Error(`gave up after ${count} consecutive turns with no feature progress (${remainingNote})`)
    );
    process.stdout.write(
      `WARNING: auto-continue watchdog gave up after ${count} consecutive turns with no feature progress.\n` +
      `Build appears STUCK, not idle (${remainingNote}). Stopping for human intervention — ` +
      `check claude-progress.txt (blocked_stories / next_action) and .claude/state/hook-errors.log.\n`
    );
    process.exit(0);
  }

  writeIntFile(countPath, count + 1);
  const reason =
    `Autonomous build has unfinished work but the turn ended (${remainingNote}).\n` +
    `Resume the build: pick up the next unfinished group/story and continue the /auto loop ` +
    `[auto-continue ${count + 1}/${MAX_NO_PROGRESS_CONTINUES} with no new passing feature].\n` +
    `This gate clears when all features pass (write "next_action: DONE …" in claude-progress.txt). ` +
    `If you are genuinely BLOCKED — stuck without new information, or waiting on a decision only the user can make — ` +
    `do NOT spin: STOP and state exactly what you are blocked on.`;
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
} catch (err) {
  reportFailure('auto-continue-on-stop', err);
  process.exit(0); // a watchdog crash must never wedge the session
}
