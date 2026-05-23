#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const STALE_DAYS = 14;
const STALE_COMMITS = 50;
const WATCHED_SKILLS = new Set(['improve', 'refactor', 'vibe', 'fix-issue', 'brownfield']);
const WATCHED_TOKENS = ['/improve', '/refactor', '/vibe', '/fix-issue'];

function findProjectDir(startDir) {
  let cur = startDir;
  while (true) {
    if (fs.existsSync(path.join(cur, '.claude'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function mostRecentMtime(dir) {
  let newest = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) { stack.push(full); continue; }
      try {
        const m = fs.statSync(full).mtimeMs;
        if (m > newest) newest = m;
      } catch (_) {}
    }
  }
  return newest;
}

function commitsSince(projectDir, sinceMs) {
  try {
    const sinceIso = new Date(sinceMs).toISOString();
    const out = execFileSync('git', ['-C', projectDir, 'log', `--since=${sinceIso}`, '--oneline'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    return out.split('\n').filter(Boolean).length;
  } catch (_) { return 0; }
}

function relevantPrompt(text) {
  if (!text) return false;
  return WATCHED_TOKENS.some((tok) => text.includes(tok));
}

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const event = (input.hook_event_name || '').toString();

  const scriptDir = path.dirname(path.resolve(__filename));
  const projectDir = findProjectDir(scriptDir) || process.cwd();

  const brownfieldDir = path.join(projectDir, 'specs', 'brownfield');
  if (!fs.existsSync(brownfieldDir)) process.exit(0);

  let shouldCheck = false;
  if (event === 'UserPromptSubmit') {
    shouldCheck = relevantPrompt(input.prompt || '');
  } else if (event === 'PreToolUse' && input.tool_name === 'Task') {
    const ti = input.tool_input || {};
    shouldCheck = WATCHED_SKILLS.has((ti.subagent_type || '').toString());
  }
  if (!shouldCheck) process.exit(0);

  const newest = mostRecentMtime(brownfieldDir);
  if (!newest) process.exit(0);

  const ageDays = (Date.now() - newest) / (1000 * 60 * 60 * 24);
  const churn = commitsSince(projectDir, newest);
  if (ageDays < STALE_DAYS && churn < STALE_COMMITS) process.exit(0);

  process.stdout.write(
    `[brownfield-staleness] specs/brownfield/ last updated ${ageDays.toFixed(1)} days ago; ${churn} commit(s) since.\n` +
      `Consider re-running /brownfield before substantial /improve, /refactor, or /vibe work — stale maps are the #1 driver of bad seam choices.\n`
  );
} catch (_) {}

process.exit(0);
