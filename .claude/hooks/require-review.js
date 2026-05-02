#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const REVIEWER_AGENTS = new Set([
  'clean-code-reviewer',
  'security-reviewer',
  'pr-review-toolkit:code-reviewer',
  'code-review:code-review',
  'performance-optimizer',
]);

function findProjectDir(startDir) {
  let cur = startDir;
  while (true) {
    if (fs.existsSync(path.join(cur, '.claude'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
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
  const raw = fs.readFileSync(transcriptPath, 'utf8');
  for (const line of raw.split('\n')) {
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
      if (part && part.type === 'tool_use' && part.name === 'Agent') {
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

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));

  const scriptDir = path.dirname(path.resolve(__filename));
  const projectDir = findProjectDir(scriptDir) || process.cwd();
  const stateFile = path.join(projectDir, '.claude', 'state', 'pending-reviews.jsonl');

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
  if (pending.length === 0) process.exit(0);

  const reviewedTs = lastReviewerTs(input.transcript_path);
  const unreviewed = pending.filter((p) => p.ts > reviewedTs);

  if (unreviewed.length === 0) {
    fs.writeFileSync(stateFile, '');
    process.exit(0);
  }

  const fileList = [...new Set(unreviewed.map((p) => p.file))].map((f) => `  - ${f}`).join('\n');
  const reason =
    `Production code was written this turn but reviewer agents were not invoked.\n` +
    `Files awaiting review:\n${fileList}\n\n` +
    `Before stopping, invoke BOTH of these in a single message (parallel):\n` +
    `  1. Agent(subagent_type="clean-code-reviewer", prompt="Review the diff for clean-code/SOLID violations in the files above.")\n` +
    `  2. Agent(subagent_type="security-reviewer", prompt="Scan the diff for OWASP/security issues in the files above.")\n`;

  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
} catch (_) {
  // Silent exit — stderr output triggers "hook error" in Claude Code
}

process.exit(0);
