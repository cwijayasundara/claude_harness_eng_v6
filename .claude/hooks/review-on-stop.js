#!/usr/bin/env node

'use strict';

// Stop hook — session-learnings + hook-error advisories.
//
// Previously also blocked the stop until source files written this turn had
// been seen by a reviewer agent (a per-turn review-gate). That gate was
// removed: all reviewer agents (code-reviewer, security-reviewer) now run
// only at the pre-PR checkpoints they already had — end of /implement,
// /change, /refactor, /auto's Section 5 ratchet gate, and /gate — never
// mid-development on every turn. This hook is now purely advisory: it
// surfaces stale session-learnings files and newly logged hook crashes
// (gates that crashed fail open, which would otherwise be silent).

const fs = require('fs');
const path = require('path');
const { resolveProjectDir, readHookInput, reportFailure } = require('./lib/common');

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
  readHookInput();
  const projectDir = resolveProjectDir(path.dirname(path.resolve(__filename)));
  const stateDir = path.join(projectDir, '.claude', 'state');

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
