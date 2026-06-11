#!/usr/bin/env node

'use strict';

// Stop hook — end-of-turn review gate + session-learnings advisories.
// Blocks the stop while source files written this turn (queued by
// verify-on-save.js) have not been seen by a reviewer agent. Review evidence
// is a reviewer 'Task'/'Agent' tool_use in the transcript OR fresh verdict
// artifacts under specs/reviews/. Blocking is bounded: after
// MAX_CONSECUTIVE_BLOCKS the gate fails open loudly instead of looping.
// When not blocking, emits maintenance advisories for oversized state files
// and surfaces new hook-errors.log entries (gates that crashed fail open).

const fs = require('fs');
const path = require('path');
const { resolveProjectDir, readHookInput, reportFailure } = require('./lib/common');

const REVIEWER_AGENTS = new Set([
  'clean-code-reviewer',
  'security-reviewer',
  'pr-review-toolkit:code-reviewer',
  'code-review:code-review',
  'performance-optimizer',
]);

// Verdict artifacts are the strongest review evidence: written by the reviewer
// agents themselves, checked by mtime against the pending writes. Both must be
// fresh — the gate asks for clean-code AND security review.
const REQUIRED_VERDICTS = ['clean-code-verdict.json', 'security-verdict.json'];

// The gate may block this many consecutive stops; after that it fails open
// LOUDLY (stdout warning + hook-errors.log) instead of looping forever. A
// silent one-shot clear would let a model bypass review by simply stopping
// twice; a bounded budget keeps the escape hatch without the free pass.
const MAX_CONSECUTIVE_BLOCKS = 3;

function verdictTs(projectDir) {
  let oldest = Infinity;
  for (const name of REQUIRED_VERDICTS) {
    const p = path.join(projectDir, 'specs', 'reviews', name);
    let stat;
    try {
      stat = fs.statSync(p);
      // mtime alone is forgeable with an empty touch; require an actual
      // verdict payload before the file counts as review evidence.
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (typeof parsed.verdict !== 'string') return 0;
    } catch (_) {
      return 0; // missing or unparseable verdict — that reviewer has not run
    }
    if (stat.mtimeMs < oldest) oldest = stat.mtimeMs;
  }
  return oldest === Infinity ? 0 : oldest;
}

function readBlockCount(stateDir) {
  try {
    const n = parseInt(fs.readFileSync(path.join(stateDir, 'review-block-count'), 'utf8'), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (_) {
    return 0;
  }
}

function writeBlockCount(stateDir, n) {
  try {
    fs.writeFileSync(path.join(stateDir, 'review-block-count'), `${n}\n`);
  } catch (_) {
    /* best effort */
  }
}

function readPending(stateFile) {
  if (!fs.existsSync(stateFile)) return [];
  const out = [];
  for (const line of fs.readFileSync(stateFile, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch (_) {
      /* skip malformed */
    }
  }
  return out;
}

function lastReviewerTs(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return 0;
  let lastTs = 0;
  for (const line of fs.readFileSync(transcriptPath, 'utf8').split('\n')) {
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (_) {
      continue;
    }
    const parts =
      (msg.message && Array.isArray(msg.message.content) && msg.message.content) ||
      (Array.isArray(msg.content) && msg.content) ||
      [];
    for (const part of parts) {
      if (part && part.type === 'tool_use' && (part.name === 'Task' || part.name === 'Agent')) {
        const sub = part.input && (part.input.subagent_type || part.input.subagent);
        if (sub && REVIEWER_AGENTS.has(sub)) {
          const tsRaw = msg.timestamp || (msg.message && msg.message.timestamp);
          const ts = tsRaw ? Date.parse(tsRaw) : Date.now();
          if (ts > lastTs) lastTs = ts;
        }
      }
    }
  }
  return lastTs;
}

function readOffset(offsetPath) {
  try {
    const n = parseInt(fs.readFileSync(offsetPath, 'utf8'), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (_) {
    return 0;
  }
}

function readSlice(logPath, from) {
  try {
    return fs.readFileSync(logPath, 'utf8').slice(from);
  } catch (_) {
    return '';
  }
}

// Surface hook crashes (gates that failed open) exactly once per new batch of
// log entries — a silently disabled gate is indistinguishable from a passing
// one unless someone reads the log.
function hookErrorAdvisory(stateDir) {
  const logPath = path.join(stateDir, 'hook-errors.log');
  const offsetPath = path.join(stateDir, 'hook-errors.offset');
  let size = 0;
  try {
    size = fs.statSync(logPath).size;
  } catch (_) {
    return null;
  }
  const seen = readOffset(offsetPath);
  if (size <= seen) return null;
  const lines = readSlice(logPath, seen).split('\n').filter(Boolean);
  try {
    fs.writeFileSync(offsetPath, `${size}\n`);
  } catch (_) {
    /* best effort */
  }
  if (lines.length === 0) return null;
  return `hook-errors.log has ${lines.length} new entr${lines.length === 1 ? 'y' : 'ies'} — a quality gate crashed and failed open (last: "${lines[lines.length - 1]}"). Review .claude/state/hook-errors.log`;
}

function learningAdvisories(stateDir) {
  const out = [];
  const learnedRulesPath = path.join(stateDir, 'learned-rules.md');
  if (fs.existsSync(learnedRulesPath)) {
    const ruleCount = (fs.readFileSync(learnedRulesPath, 'utf8').match(/^- /gm) || []).length;
    if (ruleCount >= 10) {
      out.push(`learned-rules.md has ${ruleCount} rules — consider reviewing and promoting stable patterns to CLAUDE.md`);
    }
  }
  const failuresPath = path.join(stateDir, 'failures.md');
  if (fs.existsSync(failuresPath)) {
    const failLines = fs.readFileSync(failuresPath, 'utf8').trim().split('\n').filter((l) => l.trim());
    if (failLines.length >= 5) {
      out.push(`failures.md has ${failLines.length} entries — recurring patterns should become CLAUDE.md rules or hook enforcement`);
    }
  }
  for (const [name, limitMB] of [['iteration-log.md', 1], ['telemetry-ledger.jsonl', 5]]) {
    const p = path.join(stateDir, name);
    if (fs.existsSync(p)) {
      const sizeMB = fs.statSync(p).size / (1024 * 1024);
      if (sizeMB > limitMB) {
        out.push(`${name} is ${sizeMB.toFixed(1)}MB — archive older entries via node .claude/scripts/archive-state.js`);
      }
    }
  }
  return out;
}

try {
  const input = readHookInput();
  const projectDir = resolveProjectDir(path.dirname(path.resolve(__filename)));
  const stateDir = path.join(projectDir, '.claude', 'state');
  const stateFile = path.join(stateDir, 'pending-reviews.jsonl');

  const pending = readPending(stateFile);
  if (pending.length === 0) {
    writeBlockCount(stateDir, 0); // no open review cycle — drop any stale counter
  } else {
    // Review evidence: a reviewer agent spawn recorded in the transcript, or
    // fresh verdict artifacts on disk (mtime after the pending writes).
    const reviewedTs = Math.max(lastReviewerTs(input.transcript_path), verdictTs(projectDir));
    const unreviewed = pending.filter((p) => p.ts > reviewedTs);
    if (unreviewed.length === 0) {
      fs.writeFileSync(stateFile, '');
      writeBlockCount(stateDir, 0);
    } else {
      const blocks = readBlockCount(stateDir);
      const fileList = [...new Set(unreviewed.map((p) => p.file))].map((f) => `  - ${f}`).join('\n');
      if (blocks >= MAX_CONSECUTIVE_BLOCKS) {
        // Bounded escape hatch: never loop forever, but never fail open silently.
        fs.writeFileSync(stateFile, '');
        writeBlockCount(stateDir, 0);
        reportFailure('review-on-stop', new Error(`reviewer gate failed open after ${blocks} consecutive blocks; unreviewed files:\n${fileList}`));
        process.stdout.write(
          `WARNING: reviewer gate failed open after ${blocks} consecutive blocks.\n` +
          `These files were written WITHOUT clean-code/security review:\n${fileList}\n` +
          `Run the clean-code-reviewer and security-reviewer agents before shipping this work.\n`
        );
      } else {
        writeBlockCount(stateDir, blocks + 1);
        const reason =
          `Production code was written this turn but not reviewed.\n` +
          `Files awaiting review:\n${fileList}\n\n` +
          `Before stopping, invoke BOTH of these in a single message (parallel):\n` +
          `  1. Agent(subagent_type="clean-code-reviewer", prompt="Review the diff for clean-code/SOLID violations in the files above.")\n` +
          `  2. Agent(subagent_type="security-reviewer", prompt="Scan the diff for OWASP/security issues in the files above.")\n` +
          `The gate clears when the reviewer agents have run (their verdicts land in specs/reviews/).\n`;
        process.stdout.write(JSON.stringify({ decision: 'block', reason }));
        process.exit(0);
      }
    }
  }

  const advisories = learningAdvisories(stateDir);
  const errAdvisory = hookErrorAdvisory(stateDir);
  if (errAdvisory) advisories.unshift(errAdvisory);
  if (advisories.length > 0) {
    process.stdout.write(
      ['Session learnings review:', ...advisories.map((s) => `  - ${s}`),
        'Apply learnings: run /claude-md-management:revise-claude-md if that plugin is installed, otherwise edit CLAUDE.md directly to promote these patterns.'].join('\n') + '\n'
    );
  }
} catch (err) {
  reportFailure('review-on-stop', err);
}

process.exit(0);
