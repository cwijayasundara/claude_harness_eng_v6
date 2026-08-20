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
//                                              [--in-session] [--rendering]
//
// --rendering: the caller is spec-render, i.e. already the post-/clear hop.
// Suppresses the operator checkpoint; the structural checks are unchanged.

const fs = require('fs');
const path = require('path');

const {
  checkShape, checkDecisions, checkHumanShaping, laneDisagreement, normalizeLane, BASIS,
} = require('../hooks/lib/decision-record.js');
const { renderHandoffBlock, RENDER_PHASES } = require('../hooks/lib/phase-handoff.js');
const { writeDecisionVerdict, sessionLane } = require('../hooks/lib/decision-verdict.js');

const REL = path.join('specs', 'decisions', 'spec-decisions.json');

function checkMilestone(doc) {
  const epics = doc.milestone && doc.milestone.epics;
  if (!Array.isArray(epics) || epics.length === 0) {
    return ['milestone.epics must name at least one epic — the renderer needs a scope to expand'];
  }
  const scope = doc.milestone.requirements_in_scope;
  if (!Array.isArray(scope) || scope.length === 0) {
    return ['milestone.requirements_in_scope must list the FR/NFR labels this run expands — run fill-spec-scope.js or write them in /spec'];
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


// A verdict written to stdout is gone the moment the run ends. Persist it so a
// later step — or a human asking "was this waived?" — can check, the way
// plan-approval.js leaves a receipt.
//
// `session_id` still records who shaped the decisions. The printed checkpoint
// tells a human to /clear then /spec --render-only. A waived headless lane
// and /build --in-session get no checkpoint and continue.
// `rendering` is the renderer declaring itself. spec-render runs this same
// gate at its Step 0; on a live run it read the checkpoint — written for the
// shaping session's operator — as an instruction to halt, and returned
// success having written nothing. It IS the post-clear hop the block asks
// for, so it must not be told to make it.
function checkpointOn(result, inSession, rendering) {
  return result.waived || inSession || rendering ? '' : renderHandoffBlock('spec');
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd();
  const laneIdx = argv.indexOf('--lane');
  const lane = laneIdx >= 0 ? argv[laneIdx + 1] : null;
  const file = path.join(root, REL);

  const inSession = argv.includes('--in-session');
  const rendering = argv.includes('--rendering');
  const result = validateDecisions(readDoc(file), { lane, sessionLane: sessionLane(root) });
  writeDecisionVerdict({
    root,
    gate: 'spec-decisions',
    verdictRel: RENDER_PHASES.spec.verdict,
    decisionsRel: REL,
    result,
    lane,
    inSession,
    rendering,
  });
  if (!result.ok) {
    process.stderr.write(`validate-spec-decisions: BLOCKED (${file})\n`);
    for (const e of result.errors) process.stderr.write(`  - ${e}\n`);
    process.stderr.write('\nRun /spec to shape the decisions before rendering.\n');
    process.exit(1);
  }
  const suffix = result.waived ? ` (human shaping waived by ${result.waived})` : '';
  process.stdout.write(`validate-spec-decisions: OK${suffix}\n`);
  process.stdout.write(checkpointOn(result, inSession, rendering));
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { validateDecisions, REL, BASIS };
