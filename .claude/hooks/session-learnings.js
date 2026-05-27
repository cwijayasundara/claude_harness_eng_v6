#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function findProjectDir(startDir) {
  let cur = startDir;
  while (true) {
    if (fs.existsSync(path.join(cur, '.claude'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

try {
  const projectDir = findProjectDir(process.cwd());
  if (!projectDir) process.exit(0);

  const stateDir = path.join(projectDir, '.claude', 'state');
  const learnedRulesPath = path.join(stateDir, 'learned-rules.md');
  const iterLogPath = path.join(stateDir, 'iteration-log.md');
  const failuresPath = path.join(stateDir, 'failures.md');

  const suggestions = [];

  if (fs.existsSync(learnedRulesPath)) {
    const rules = fs.readFileSync(learnedRulesPath, 'utf8');
    const ruleCount = (rules.match(/^- /gm) || []).length;
    if (ruleCount >= 10) {
      suggestions.push(`learned-rules.md has ${ruleCount} rules — consider reviewing and promoting stable patterns to CLAUDE.md`);
    }
  }

  if (fs.existsSync(failuresPath)) {
    const failures = fs.readFileSync(failuresPath, 'utf8').trim();
    if (failures.length > 0) {
      const failLines = failures.split('\n').filter(l => l.trim().length > 0);
      if (failLines.length >= 5) {
        suggestions.push(`failures.md has ${failLines.length} entries — recurring patterns should become CLAUDE.md rules or hook enforcement`);
      }
    }
  }

  if (fs.existsSync(iterLogPath)) {
    const stat = fs.statSync(iterLogPath);
    const sizeMB = stat.size / (1024 * 1024);
    if (sizeMB > 1) {
      suggestions.push(`iteration-log.md is ${sizeMB.toFixed(1)}MB — consider archiving older entries to .claude/state/archive/`);
    }
  }

  const telemetryLedger = path.join(stateDir, 'telemetry-ledger.jsonl');
  if (fs.existsSync(telemetryLedger)) {
    const stat = fs.statSync(telemetryLedger);
    const sizeMB = stat.size / (1024 * 1024);
    if (sizeMB > 5) {
      suggestions.push(`telemetry-ledger.jsonl is ${sizeMB.toFixed(1)}MB — run the archive-state skill or truncate older entries`);
    }
  }

  if (suggestions.length > 0) {
    const msg = [
      'Session learnings review:',
      ...suggestions.map(s => `  - ${s}`),
      'Run /claude-md-management:revise-claude-md to apply learnings.'
    ].join('\n');
    process.stdout.write(msg + '\n');
  }
} catch (_) {
  // Silent exit
}

process.exit(0);
