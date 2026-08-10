#!/usr/bin/env node

'use strict';

// Decisions gate for the /design shaping -> rendering split.
//
// `/design` runs in the main session and records the architecture calls to
// specs/decisions/design-decisions.json; `design-render` forks onto the sidekick
// model and expands them into the nine design documents and the mockups.
//
// Shares its spine with the /spec gate (see hooks/lib/decision-record.js) and
// adds one rule of its own: a load-bearing decision must say what it RULES OUT.
// That comes from what the audited design got right — its decision table is
// literally "| Decision | What it rules out |", and the alternatives-rejected
// section is the most useful content in 632 KB of output. A decision that
// forecloses nothing was a preference, and it will not survive the first
// implementer who prefers otherwise.
//
// Usage:
//   node .claude/scripts/validate-design-decisions.js [--root DIR] [--lane --auto|--autonomous]

const fs = require('fs');
const path = require('path');
const {
  checkShape, checkDecisions, checkHumanShaping, laneDisagreement, normalizeLane,
} = require('../hooks/lib/decision-record.js');
const { renderHandoffBlock } = require('../hooks/lib/phase-handoff.js');
const { writeDecisionVerdict, sessionLane } = require('../hooks/lib/decision-verdict.js');

const REL = path.join('specs', 'decisions', 'design-decisions.json');
const VERDICT_REL = path.join('specs', 'reviews', 'design-decisions-verdict.json');

// A foreclosed alternative has to name something. These are the ways a model
// fills the field without deciding anything.
const PLACEHOLDER = /^(n\/?a|none|nothing|tbd|todo|unknown|-{1,3})$/i;

function checkStack(doc) {
  const stack = doc.stack;
  if (!stack || typeof stack !== 'object' || Object.keys(stack).length === 0) {
    return ['stack must name the committed technologies — it governs every later module choice'];
  }
  return [];
}

// Design-specific: a load-bearing decision must foreclose an alternative.
function checkRulesOut(decisions) {
  const errors = [];
  for (const entry of decisions.filter((d) => d && d.load_bearing === true)) {
    const rulesOut = String(entry.rules_out || '').trim();
    if (!rulesOut || PLACEHOLDER.test(rulesOut)) {
      errors.push(
        `load-bearing decision ${entry.id} does not say what it rules out — `
        + 'a decision that forecloses nothing is a preference, not a decision',
      );
    }
  }
  return errors;
}

/**
 * @param {object} doc parsed design-decisions.json
 * @param {object} [opts] {lane, sessionLane}
 * @returns {{ok: boolean, errors: string[], waived: string|null}}
 */
function validateDesignDecisions(doc, opts = {}) {
  const lane = normalizeLane(opts.lane);
  const disagreement = laneDisagreement(lane, opts.sessionLane);
  const effectiveLane = disagreement ? null : lane;

  const shape = checkShape(doc, 'design');
  if (shape.length) return { ok: false, errors: shape, waived: effectiveLane };

  const errors = disagreement ? [disagreement] : [];
  errors.push(...checkStack(doc));
  errors.push(...checkDecisions(doc.decisions));
  errors.push(...checkRulesOut(doc.decisions));
  if (doc.decisions.length === 0) {
    errors.push('decisions must contain at least one decision');
  } else if (!effectiveLane) {
    errors.push(...checkHumanShaping(doc.decisions));
  }
  return { ok: errors.length === 0, errors, waived: effectiveLane };
}

// The checkpoint prints only when there is a human who can act on it: a waived
// headless lane has nobody to run /clear, and /build cannot clear itself.
function checkpointOn(result, inSession) {
  return result.waived || inSession ? '' : renderHandoffBlock('design');
}

function readDoc(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null; // validated as missing by checkShape
  }
}

function report(result, file, inSession) {
  if (!result.ok) {
    process.stderr.write(`validate-design-decisions: BLOCKED (${file})\n`);
    for (const e of result.errors) process.stderr.write(`  - ${e}\n`);
    process.stderr.write('\nRun /design to shape the architecture decisions before rendering.\n');
    return 1;
  }
  const suffix = result.waived ? ` (human shaping waived by ${result.waived})` : '';
  process.stdout.write(`validate-design-decisions: OK${suffix}\n`);
  process.stdout.write(checkpointOn(result, inSession));
  return 0;
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  const root = arg('--root') || process.cwd();
  const lane = arg('--lane');
  const inSession = argv.includes('--in-session');
  const file = path.join(root, REL);

  const result = validateDesignDecisions(readDoc(file), { lane, sessionLane: sessionLane(root) });
  writeDecisionVerdict({
    root, gate: 'design-decisions', verdictRel: VERDICT_REL, decisionsRel: REL, result, lane, inSession,
  });
  const code = report(result, file, inSession);
  if (code !== 0) process.exit(code);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { validateDesignDecisions, REL };
