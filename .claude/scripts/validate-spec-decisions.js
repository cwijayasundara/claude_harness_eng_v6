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

const {
  checkShape, checkDecisions, checkHumanShaping, laneDisagreement, normalizeLane, BASIS,
} = require('../hooks/lib/decision-record.js');

const REL = path.join('specs', 'decisions', 'spec-decisions.json');

function checkMilestone(doc) {
  const epics = doc.milestone && doc.milestone.epics;
  if (!Array.isArray(epics) || epics.length === 0) {
    return ['milestone.epics must name at least one epic — the renderer needs a scope to expand'];
  }
  return [];
}

/**
 * @param {object} doc parsed spec-decisions.json
 * @param {object} [opts] {lane} — '--auto' | '--autonomous' waives the human rules
 * @returns {{ok: boolean, errors: string[], waived: string|null}}
 */
function validateDecisions(doc, opts = {}) {
  const lane = normalizeLane(opts.lane);
  const disagreement = laneDisagreement(lane, opts.sessionLane);
  const effectiveLane = disagreement ? null : lane;
  const shape = checkShape(doc, 'spec');
  if (shape.length) return { ok: false, errors: shape, waived: effectiveLane };

  const errors = disagreement ? [disagreement] : [];
  errors.push(...checkMilestone(doc));
  errors.push(...checkDecisions(doc.decisions));
  if (doc.decisions.length === 0) {
    errors.push('decisions must contain at least one decision');
  } else if (!effectiveLane) {
    errors.push(...checkHumanShaping(doc.decisions));
  }
  return { ok: errors.length === 0, errors, waived: effectiveLane };
}

function readDoc(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function sessionLane(root) {
  try {
    return fs.readFileSync(path.join(root, '.claude', 'state', 'current-lane'), 'utf8').trim();
  } catch (_) {
    return null;
  }
}

// A verdict written to stdout is gone the moment the run ends. Persist it so a
// later step — or a human asking "was this waived?" — can check, the way
// plan-approval.js leaves a receipt.
function writeVerdict(root, result, lane) {
  const out = path.join(root, 'specs', 'reviews', 'spec-decisions-verdict.json');
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify({
      gate: 'spec-decisions',
      pass: result.ok,
      waived_by: result.waived,
      claimed_lane: lane || null,
      session_lane: sessionLane(root),
      errors: result.errors,
      checked_at: new Date().toISOString(),
    }, null, 2)}\n`);
  } catch (_) { /* a receipt we cannot write must not block the gate */ }
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd();
  const laneIdx = argv.indexOf('--lane');
  const lane = laneIdx >= 0 ? argv[laneIdx + 1] : null;
  const file = path.join(root, REL);

  const result = validateDecisions(readDoc(file), { lane, sessionLane: sessionLane(root) });
  writeVerdict(root, result, lane);
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
