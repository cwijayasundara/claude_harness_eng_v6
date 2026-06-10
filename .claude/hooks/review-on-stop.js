#!/usr/bin/env node

'use strict';

// Stop hook — end-of-turn review gate + session-learnings advisories.
// Blocks the stop while source files written this turn (queued by
// verify-on-save.js) have not been seen by a reviewer agent. Reviewer spawns
// are recorded as 'Task' tool_use entries in transcripts ('Agent' in older
// builds). When not blocking, emits maintenance advisories for oversized
// state files (formerly session-learnings.js).

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

  // Break infinite loops: if we already blocked once this stop, don't block again
  if (input.stop_hook_active) {
    try {
      fs.writeFileSync(stateFile, '');
    } catch (_) {
      /* ignore */
    }
    process.exit(0);
  }

  const pending = readPending(stateFile);
  if (pending.length > 0) {
    const reviewedTs = lastReviewerTs(input.transcript_path);
    const unreviewed = pending.filter((p) => p.ts > reviewedTs);
    if (unreviewed.length > 0) {
      const fileList = [...new Set(unreviewed.map((p) => p.file))].map((f) => `  - ${f}`).join('\n');
      const reason =
        `Production code was written this turn but reviewer agents were not invoked.\n` +
        `Files awaiting review:\n${fileList}\n\n` +
        `Before stopping, invoke BOTH of these in a single message (parallel):\n` +
        `  1. Agent(subagent_type="clean-code-reviewer", prompt="Review the diff for clean-code/SOLID violations in the files above.")\n` +
        `  2. Agent(subagent_type="security-reviewer", prompt="Scan the diff for OWASP/security issues in the files above.")\n`;
      process.stdout.write(JSON.stringify({ decision: 'block', reason }));
      process.exit(0);
    }
    fs.writeFileSync(stateFile, '');
  }

  const advisories = learningAdvisories(stateDir);
  if (advisories.length > 0) {
    process.stdout.write(
      ['Session learnings review:', ...advisories.map((s) => `  - ${s}`),
        'Run /claude-md-management:revise-claude-md to apply learnings.'].join('\n') + '\n'
    );
  }
} catch (err) {
  reportFailure('review-on-stop', err);
}

process.exit(0);
