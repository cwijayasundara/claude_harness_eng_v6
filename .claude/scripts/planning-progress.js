#!/usr/bin/env node

'use strict';

// Planning-phase next-action stamp. /status used to keep saying "Run /brd"
// after spec was approved because claude-progress.txt is an /auto seed.

const fs = require('fs');
const path = require('path');

const NEXT = {
  brd: 'Run /spec',
  spec: 'Run /design',
  design: 'Run /test',
  test: 'Run /auto',
};

const PHASE_ORDER = ['brd', 'spec', 'design', 'test'];

function receiptPath(root, phase) {
  return path.join(root, 'specs', 'reviews', `${phase}-approval.json`);
}

function receiptStatus(root, phase) {
  try {
    return JSON.parse(fs.readFileSync(receiptPath(root, phase), 'utf8')).status || null;
  } catch (_) {
    return null;
  }
}

function latestPlanningPhase(root) {
  let found = null;
  for (const phase of PHASE_ORDER) {
    const status = receiptStatus(root, phase);
    if (status === 'approved' || status === 'waived') found = phase;
  }
  return found;
}

function stampPlanningProgress(root, phase) {
  const next = NEXT[phase];
  if (!next) return null;
  const file = path.join(root, 'claude-progress.txt');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { /* new file */ }
  if (/^next_action:/m.test(text)) {
    text = text.replace(/^next_action:.*$/m, `next_action: ${next}`);
  } else {
    text = `${text.replace(/\s*$/, '')}\nnext_action: ${next}\n`;
  }
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
  return next;
}

function implementationStarted(progress) {
  const completed = progress && progress.groups_completed;
  const current = progress && progress.current_group;
  const hasCompleted = Array.isArray(completed) ? completed.length > 0
    : (typeof completed === 'string' && completed !== '[]' && completed.toLowerCase() !== 'none');
  return !!(hasCompleted || (current && current !== 'none'));
}

module.exports = {
  NEXT,
  stampPlanningProgress,
  latestPlanningPhase,
  implementationStarted,
  receiptStatus,
};
