'use strict';

// Deterministic grounding for the reuse-or-justify loop (design spec C3).
// Ranks which existing seam a new story could EXTEND, decides whether to fire
// the reuse dialogue (confidence-gated), and flags touched constitution
// invariants + intra-batch story clusters. Non-gate: informs, never blocks.
// Reuses scoreSeams (structural + goal-term seam ranking); never reinvents it.

const { scoreSeams } = require('../../skills/seam-finder/scripts/score_seams');
const { parseInvariants } = require('./constitution-invariants');

const TOP_N = 5;
const BAND_HIGH = 0.7;
const BAND_MED = 0.5; // matches seam-confidence.js's seam cutoff

const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'from', 'and', 'or', 'for', 'in', 'on', 'add', 'new', 'change', 'update', 'via']);
function terms(s) {
  return [...new Set(String(s || '').toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) || [])].filter((t) => !STOP.has(t));
}

function bandFor(score) {
  if (score >= BAND_HIGH) return 'high';
  if (score >= BAND_MED) return 'medium';
  return 'low';
}

function touchedInvariants(goal, invariantsText) {
  const gt = new Set(terms(goal));
  return parseInvariants(invariantsText || '')
    .filter((inv) => terms(inv).some((t) => gt.has(t)));
}

function intraBatchClusters(batch) {
  const items = (batch || [])
    .filter((s) => s && s.id)
    .map((s) => ({ id: s.id, t: new Set(terms(s.goal || s.text)) }));
  const clusters = [];
  const seen = new Set();
  for (let i = 0; i < items.length; i++) {
    if (seen.has(items[i].id)) continue;
    const group = [items[i].id];
    for (let j = i + 1; j < items.length; j++) {
      const shared = [...items[i].t].filter((t) => items[j].t.has(t));
      if (shared.length >= 2) { group.push(items[j].id); seen.add(items[j].id); }
    }
    if (group.length > 1) { seen.add(items[i].id); clusters.push({ stories: group }); }
  }
  return clusters;
}

// Rank by total_score first (it already encodes goal-relevance + structural
// signal); reuse-shaped action (extend/wrap/introduce-adapter) is only a
// tiebreak. recommendAction's per-node classification is informational
// metadata, not a ranking key on its own — a used leaf service can be
// labeled 'split' while scoring highest, and a disconnected orphan can be
// labeled 'wrap' while scoring lowest.
const REUSE_ACTIONS = new Set(['extend', 'wrap', 'introduce-adapter']);
function rankCandidates(ranked) {
  return ranked
    .slice()
    .sort((a, b) => (b.total_score - a.total_score)
      || (REUSE_ACTIONS.has(b.recommended_action) - REUSE_ACTIONS.has(a.recommended_action)))
    .slice(0, TOP_N);
}

// band/target are derived from the best GOAL-RELEVANT candidate only:
// total_score is funnel-dominated (the busiest structural hub scores high
// regardless of goal), so gating on candidates[0] fires the reuse dialogue
// for goals with zero semantic connection to the graph. A candidate only
// counts once it actually matched a goal term.
function selectTarget(candidates, reasons) {
  const relevant = candidates.filter((c) => (c.matched_terms && c.matched_terms.length) || (c.goal_relevance || 0) > 0);
  const target = relevant[0] || null;
  if (!candidates.length) reasons.push('no seam candidates for this goal');
  else if (!target) reasons.push('no goal-relevant seam — candidates matched no goal terms');
  return target;
}

function scoutReuse({ graph, goal, invariantsText, batch } = {}) {
  const reasons = [];
  let ranked = [];
  try {
    ranked = scoreSeams(graph || { nodes: [], edges: [], metrics: {} }, goal || '', {}) || [];
  } catch (e) {
    reasons.push(`seam scoring unavailable: ${e.message}`);
  }
  const candidates = rankCandidates(ranked);
  const target = selectTarget(candidates, reasons);
  const band = target ? bandFor(target.total_score) : 'low';
  const touched = touchedInvariants(goal, invariantsText);
  const intra = intraBatchClusters(batch);
  return {
    fire: band !== 'low' || touched.length > 0 || intra.length > 0,
    band,
    target_seam: target ? target.path : null,
    target_action: target ? target.recommended_action : null,
    candidates,
    touched_invariants: touched,
    intra_batch: intra,
    reasons,
  };
}

module.exports = { scoutReuse, touchedInvariants, intraBatchClusters, terms };
