'use strict';

// Shared validation for a phase decisions record.
//
// `/spec` and `/design` both split into a main-session shaping half that records
// the load-bearing calls and a forked sidekick half that expands them. The rules
// that make that split real are the same in both: a decision must have been
// chosen by a human, and the record must say honestly who chose it.
//
// Phase-specific rules live in the per-phase validators; only the shared spine
// is here, so the two cannot drift the way the pricing formula did.

const BASIS = new Set(['human', 'default-accepted', 'headless-default']);
const LANES = new Set(['--auto', '--autonomous']);

function checkShape(doc, phase) {
  if (!doc || typeof doc !== 'object') return ['decisions file is missing or not a JSON object'];
  if (doc.phase !== phase) return [`phase must be "${phase}", found ${JSON.stringify(doc.phase)}`];
  if (!Array.isArray(doc.decisions)) return ['decisions must be an array'];
  return [];
}

function checkDecision(entry, index, seen) {
  const errors = [];
  const id = entry && entry.id ? String(entry.id) : `#${index + 1}`;
  if (!entry || typeof entry !== 'object') return [`decision ${id} is not an object`];
  if (!entry.id) errors.push(`decision ${id} has no id`);
  else if (seen.has(entry.id)) errors.push(`duplicate decision id ${entry.id}`);
  else seen.add(entry.id);
  if (!String(entry.question || '').trim()) errors.push(`decision ${id} has no question`);
  if (!String(entry.chosen || '').trim()) errors.push(`decision ${id} has no chosen answer`);
  if (!BASIS.has(entry.basis)) {
    errors.push(`decision ${id} has basis ${JSON.stringify(entry.basis)}; expected one of ${[...BASIS].join(' | ')}`);
  }
  return errors;
}

function checkDecisions(decisions) {
  const errors = [];
  const seen = new Set();
  decisions.forEach((entry, i) => errors.push(...checkDecision(entry, i, seen)));
  return errors;
}

// The human requirement — the only part a headless lane may waive.
function checkHumanShaping(decisions) {
  const errors = [];
  const loadBearing = decisions.filter((d) => d && d.load_bearing === true);
  if (loadBearing.length === 0) {
    errors.push('no decision is marked load_bearing: true — mark the calls that shape the outcome');
  }
  for (const entry of loadBearing) {
    if (entry.basis !== 'human') {
      errors.push(`load-bearing decision ${entry.id} has basis "${entry.basis}"; it must be "human"`);
    }
  }
  if (!decisions.some((d) => d && d.basis === 'human')) {
    errors.push('no decision has basis "human" — a decisions file the human never shaped cannot unlock the renderer');
  }
  return errors;
}

// `--lane` is supplied by the same agent these gates constrain, so a claimed
// waiver is corroborated against .claude/state/current-lane, which record-run
// writes from the actual invocation. Absent marker = no contradiction.
function laneDisagreement(lane, sessionLane) {
  if (!lane || sessionLane == null || sessionLane === '') return null;
  const headless = /--auto|--autonomous|\bauto\b|\bautonomous\b/.test(String(sessionLane));
  return headless ? null
    : `--lane ${lane} was claimed, but the session lane is "${sessionLane}" — a gated run cannot waive itself`;
}

function normalizeLane(lane) {
  return LANES.has(lane) ? lane : null;
}

module.exports = {
  BASIS,
  LANES,
  checkShape,
  checkDecision,
  checkDecisions,
  checkHumanShaping,
  laneDisagreement,
  normalizeLane,
};
