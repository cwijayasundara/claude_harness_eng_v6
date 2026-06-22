'use strict';

// Pure decision logic for the build-chain driver. No process spawning and no
// file I/O — every function takes already-read text or plain numbers so the
// cross-process orchestration can be unit-tested without invoking `claude`.
//
// The parsing conventions mirror .claude/hooks/auto-continue-on-stop.js so the
// cross-process chain makes the same "is there work left / did it progress"
// decision the in-session watchdog already makes.

const STATES = Object.freeze({
  PLAN: 'PLAN',
  BUILD: 'BUILD',
  FINALIZE: 'FINALIZE',
  DONE: 'DONE',
  STUCK: 'STUCK',
});

function lastBlockText(progressText) {
  const idx = progressText.lastIndexOf('=== Session');
  return idx === -1 ? progressText : progressText.slice(idx);
}

function field(text, name) {
  const m = text.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

function parseGroups(listText) {
  const inner = (listText.match(/\[(.*)\]/) || [, ''])[1].trim();
  if (!inner) return [];
  return inner.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseLastBlock(progressText) {
  const text = lastBlockText(progressText || '');
  const found = /=== Session/.test(text) || /groups_remaining:/.test(text);
  const passingStr = field(text, 'features_passing'); // "47 / 203"
  return {
    groupsRemaining: parseGroups(field(text, 'groups_remaining')),
    nextAction: field(text, 'next_action'),
    featuresPassing: parseInt((passingStr.match(/(\d+)/) || [])[1] || '0', 10),
    found,
  };
}

function isBuildComplete(block) {
  if (/^DONE\b/i.test(block.nextAction)) return true;
  return block.groupsRemaining.length === 0;
}

function nextPhase(currentPhase, block) {
  if (currentPhase === STATES.PLAN) return STATES.BUILD;
  if (currentPhase === STATES.BUILD) return isBuildComplete(block) ? STATES.FINALIZE : STATES.BUILD;
  if (currentPhase === STATES.FINALIZE) return STATES.DONE;
  if (currentPhase === STATES.STUCK) return STATES.STUCK; // terminal — never auto-advances
  if (currentPhase === STATES.DONE) return STATES.DONE;   // terminal
  return STATES.DONE;
}

const stallExceeded = (streak, max) => streak >= max;
const budgetExceeded = (linkCount, max) => linkCount >= max;

module.exports = {
  STATES,
  parseLastBlock,
  isBuildComplete,
  nextPhase,
  stallExceeded,
  budgetExceeded,
};
