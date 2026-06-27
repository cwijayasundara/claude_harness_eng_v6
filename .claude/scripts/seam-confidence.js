'use strict';

// Deterministic seam-confidence gate — the first layer of autonomous-brownfield
// adherence enforcement. Pure band logic takes the scored candidates so it is
// unit-testable; the CLI reads code-graph.json, runs the seam scorer, and prints
// the band. "Is there a clean seam to extend?" — not "did the plan use it?"
// (that is the judged adherence critic).

const THRESHOLD = 0.5; // matches sprouting-instead-of-editing's seam cutoff

function seamConfidence(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { band: 'low', target_seam: null, total_score: 0, reasons: ['no seam candidates for this goal'] };
  }
  const best = candidates.reduce((a, b) => (b.total_score > a.total_score ? b : a));
  const reasons = [];
  let band = 'high';
  if (best.total_score < THRESHOLD) {
    band = 'low';
    reasons.push(`best seam score ${best.total_score} < ${THRESHOLD}`);
  }
  if (best.recommended_action === 'avoid') {
    band = 'low';
    reasons.push("best candidate recommends 'avoid' (no clean boundary to extend)");
  }
  if (band === 'high') {
    reasons.push(`clean seam to extend: ${best.path} (score ${best.total_score}, ${best.recommended_action})`);
  }
  return { band, target_seam: best.path, total_score: best.total_score, reasons };
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

if (require.main === module) {
  const fs = require('fs');
  const { scoreSeams } = require('../skills/seam-finder/scripts/score_seams.js');
  const args = process.argv.slice(2);
  const graphPath = argValue(args, '--graph') || 'specs/brownfield/code-graph.json';
  const goal = argValue(args, '--goal') || '';
  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  } catch (e) {
    process.stderr.write(`seam-confidence: cannot read ${graphPath}: ${e.message}\n`);
    process.exit(2);
  }
  const candidates = scoreSeams(graph, goal, {});
  process.stdout.write(`${JSON.stringify(seamConfidence(candidates), null, 2)}\n`);
}

module.exports = { seamConfidence, THRESHOLD };
