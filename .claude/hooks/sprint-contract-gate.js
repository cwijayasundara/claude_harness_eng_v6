#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

let input;
try {
  input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
} catch (_) {
  process.exit(0);
}

const command = (input.tool_input && input.tool_input.command) || '';

// Only activate on git commit commands
if (!command.includes('git commit')) {
  process.exit(0);
}

// Find project root by walking up from script location to find .claude/
function findProjectDir(startDir) {
  let current = startDir;
  while (true) {
    const claudeDir = path.join(current, '.claude');
    if (fs.existsSync(claudeDir)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

const scriptDir = path.dirname(path.resolve(__filename));
const projectDir = findProjectDir(scriptDir) || process.cwd();

// Read claude-progress.txt to find current_group
const progressFile = path.join(projectDir, 'claude-progress.txt');

let progressContent;
try {
  progressContent = fs.readFileSync(progressFile, 'utf8');
} catch (_) {
  // No progress file — exit 0
  process.exit(0);
}

// Extract current_group value
const groupMatch = progressContent.match(/^current_group:\s*(.+)$/m);
if (!groupMatch || !groupMatch[1].trim()) {
  process.exit(0);
}

const group = groupMatch[1].trim();

// Check if sprint-contracts/{group}.json exists
const contractFile = path.join(projectDir, 'sprint-contracts', `${group}.json`);

if (!fs.existsSync(contractFile)) {
  process.exit(0);
}

// Contract exists — check evaluator report for "VERDICT: PASS"
const reportFile = path.join(projectDir, 'specs', 'reviews', 'evaluator-report.md');

let reportContent;
try {
  reportContent = fs.readFileSync(reportFile, 'utf8');
} catch (_) {
  // Report doesn't exist — verdict is not PASS
  process.stdout.write(
    `BLOCKED: Sprint contract for group ${group} not satisfied. Run /evaluate first.\nFix: Run /evaluate to verify the sprint contract, then retry the commit.\n`
  );
  process.exit(2);
}

// Use anchored regex to match "VERDICT: PASS" at the start of a line, avoiding false matches in comments
if (!/^VERDICT:\s*PASS\s*$/m.test(reportContent)) {
  process.stdout.write(
    `BLOCKED: Sprint contract for group ${group} not satisfied. Run /evaluate first.\nFix: Run /evaluate to verify the sprint contract, then retry the commit.\n`
  );
  process.exit(2);
}

process.exit(0);
