#!/usr/bin/env node

'use strict';

// Decisions gate for the /spec shaping -> rendering split.
//
// `/spec` (main session, frontier model) holds the dialogue and writes
// specs/decisions/spec-decisions.json. `spec-render` (forked, sidekick model)
// expands it into the story graph. This script is what makes that split real:
// the renderer refuses to run against a decisions file the human never shaped.
//
// The audited failure it exists to stop: 6 clarifications whose every `basis`
// ended "Original planner reasoning: …" — the planner wrote both the question
// and the answer — followed by 1.83 MB of artifacts nobody had agreed to.
//
// Usage:
//   node .claude/scripts/validate-spec-decisions.js [--root DIR] [--lane --auto|--autonomous]

const fs = require('fs');
const path = require('path');

const REL = path.join('specs', 'decisions', 'spec-decisions.json');
const LANES = new Set(['--auto', '--autonomous']);
const BASIS = new Set(['human', 'default-accepted', 'headless-default']);

function checkShape(doc) {
  if (!doc || typeof doc !== 'object') return ['decisions file is missing or not a JSON object'];
  if (doc.phase !== 'spec') return [`phase must be "spec", found ${JSON.stringify(doc.phase)}`];
  if (!Array.isArray(doc.decisions)) return ['decisions must be an array'];
  return [];
}

function checkMilestone(doc) {
  const epics = doc.milestone && doc.milestone.epics;
  if (!Array.isArray(epics) || epics.length === 0) {
    return ['milestone.epics must name at least one epic — the renderer needs a scope to expand'];
  }
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

// The human requirement — the only part a headless lane may waive.
function checkHumanShaping(decisions) {
  const errors = [];
  const loadBearing = decisions.filter((d) => d && d.load_bearing === true);
  if (loadBearing.length === 0) {
    errors.push('no decision is marked load_bearing: true — mark the calls that shape scope');
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

/**
 * @param {object} doc parsed spec-decisions.json
 * @param {object} [opts] {lane} — '--auto' | '--autonomous' waives the human rules
 * @returns {{ok: boolean, errors: string[], waived: string|null}}
 */
function validateDecisions(doc, opts = {}) {
  const lane = LANES.has(opts.lane) ? opts.lane : null;
  const shape = checkShape(doc);
  if (shape.length) return { ok: false, errors: shape, waived: lane };

  const errors = [...checkMilestone(doc)];
  const seen = new Set();
  doc.decisions.forEach((entry, i) => errors.push(...checkDecision(entry, i, seen)));
  if (doc.decisions.length === 0) {
    errors.push('decisions must contain at least one decision');
  } else if (!lane) {
    errors.push(...checkHumanShaping(doc.decisions));
  }
  return { ok: errors.length === 0, errors, waived: lane };
}

function readDoc(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd();
  const laneIdx = argv.indexOf('--lane');
  const lane = laneIdx >= 0 ? argv[laneIdx + 1] : null;
  const file = path.join(root, REL);

  const result = validateDecisions(readDoc(file), { lane });
  if (!result.ok) {
    process.stderr.write(`validate-spec-decisions: BLOCKED (${file})\n`);
    for (const e of result.errors) process.stderr.write(`  - ${e}\n`);
    process.stderr.write('\nRun /spec to shape the decisions before rendering.\n');
    process.exit(1);
  }
  const suffix = result.waived ? ` (human shaping waived by ${result.waived})` : '';
  process.stdout.write(`validate-spec-decisions: OK${suffix}\n`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { validateDecisions, REL, BASIS };
