#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function findProjectDir(startDir) {
  let cur = startDir;
  while (true) {
    if (fs.existsSync(path.join(cur, '.claude'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function readMarker(stateDir, name) {
  try {
    return fs.readFileSync(path.join(stateDir, name), 'utf8').trim() || null;
  } catch (_) {
    return null;
  }
}

function countPendingReviews(stateDir) {
  try {
    const raw = fs.readFileSync(path.join(stateDir, 'pending-reviews.jsonl'), 'utf8');
    return raw.split('\n').filter(Boolean).length;
  } catch (_) {
    return 0;
  }
}

function harnessSha(projectDir) {
  try {
    const head = fs.readFileSync(path.join(projectDir, '.claude', 'HARNESS_SHA'), 'utf8').trim();
    if (head) return head;
  } catch (_) {}
  return process.env.CLAUDE_HARNESS_SHA || null;
}

function append(receiptPath, obj) {
  fs.appendFileSync(receiptPath, JSON.stringify(obj) + '\n');
}

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const eventKind = (input.hook_event_name || '').toString();
  const toolName = input.tool_name || '';

  const scriptDir = path.dirname(path.resolve(__filename));
  const projectDir = findProjectDir(scriptDir) || process.cwd();
  const stateDir = path.join(projectDir, '.claude', 'state');
  const runsDir = path.join(projectDir, '.claude', 'runs');
  if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const receiptPath = path.join(runsDir, `${date}.jsonl`);

  const lane = readMarker(stateDir, 'current-lane');
  const mode = readMarker(stateDir, 'current-mode');
  const iteration = readMarker(stateDir, 'current-iteration');
  const groupId = readMarker(stateDir, 'current-group');
  const storyId = readMarker(stateDir, 'current-story');

  if (eventKind === 'PostToolUse' && toolName === 'Task') {
    const ti = input.tool_input || {};
    const tr = input.tool_response || {};
    // Tokens + duration are covered by native OTEL (claude_code.token.usage,
    // claude_code.tool_result). Only harness-specific fields recorded here.
    append(receiptPath, {
      kind: 'subagent',
      ts: Date.now(),
      session_id: input.session_id || null,
      harness_sha: harnessSha(projectDir),
      lane,
      mode,
      iteration,
      group_id: groupId,
      story_id: storyId,
      agent: ti.subagent_type || null,
      exit: tr.is_error ? 'error' : 'ok',
    });
    process.exit(0);
  }

  if (eventKind === 'Stop' || eventKind === 'SubagentStop') {
    append(receiptPath, {
      kind: eventKind === 'Stop' ? 'turn' : 'subagent_stop',
      ts: Date.now(),
      session_id: input.session_id || null,
      harness_sha: harnessSha(projectDir),
      lane,
      mode,
      iteration,
      group_id: groupId,
      story_id: storyId,
      pending_reviews: countPendingReviews(stateDir),
      host: os.hostname(),
    });
    process.exit(0);
  }
} catch (_) {
  // Silent — stderr would surface as a hook error
}

process.exit(0);
