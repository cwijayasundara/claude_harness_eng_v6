'use strict';

// Subtractive ratchet on the harness's OWN control count (harness-simplification
// P0). The harness ratchets product-code quality (coverage/cycles/coupling/
// length/perf) one way — better — but never had a counter-force on the growth of
// its own guides+sensors. A detailed 2026-06-10 cut-to-half proposal partially
// executed and was then overwhelmed by accretion (27->45 skills, 22->69 hooks in
// five weeks). This makes the registered-control COUNT a monotonic ratchet with
// the same decision shape as cycle-gate.js: the count may only stay flat or drop,
// unless each newly-added control carries a written net_add_justification.
// Pure logic here; IO (manifest read, baseline read/write) in
// scripts/control-budget-gate.js.

// Ids that count against the budget: every guide + sensor that is a REAL control
// today. `planned` entries are aspirational gap-trackers, not yet friction, so
// they are excluded until they go active/partial.
function controlIds(manifest) {
  const guides = Array.isArray(manifest && manifest.guides) ? manifest.guides : [];
  const sensors = Array.isArray(manifest && manifest.sensors) ? manifest.sensors : [];
  const ids = [...guides, ...sensors]
    .filter((e) => e && e.id && (e.status || 'active') !== 'planned')
    .map((e) => e.id);
  return [...new Set(ids)].sort();
}

// A control is "justified" for net growth if its manifest entry carries a
// non-empty net_add_justification string — a written reason living next to the
// control forever, not a throwaway commit message.
function justifiedIds(manifest) {
  const all = [
    ...(Array.isArray(manifest && manifest.guides) ? manifest.guides : []),
    ...(Array.isArray(manifest && manifest.sensors) ? manifest.sensors : []),
  ];
  return all
    .filter((e) => e && e.id && typeof e.net_add_justification === 'string' && e.net_add_justification.trim())
    .map((e) => e.id);
}

/**
 * Decide whether the current control set is within budget.
 * @param currentIds sorted string[] of today's control ids (controlIds()).
 * @param baseline   {count, ids} committed baseline, or undefined on first run.
 * @param justified  string[] of ids carrying a net_add_justification.
 *
 * Rules (encoding "replace one OR justify the net-add"):
 *  - no baseline           -> establish, never block.
 *  - count <= baseline     -> pass; ratchet the baseline to the current set
 *                             (removals lower the bar; a flat-count swap is a
 *                             frictionless replacement).
 *  - count  > baseline     -> net growth; every id new since baseline must be
 *                             justified, else BLOCK and name the unjustified ones.
 *                             The baseline is NOT advanced on a block.
 */
function budgetDecision(currentIds, baseline, justified) {
  const ids = [...currentIds].sort();
  const count = ids.length;
  const current = { count, ids };
  const justifiedSet = new Set(justified || []);

  const hasBaseline = baseline && Number.isFinite(baseline.count) && Array.isArray(baseline.ids);
  if (!hasBaseline) {
    return { count, baseline: count, blocked: false, baselineRun: true, added: [], unjustified: [], newBaseline: current };
  }

  const baselineSet = new Set(baseline.ids);
  const added = ids.filter((id) => !baselineSet.has(id));

  if (count <= baseline.count) {
    return { count, baseline: baseline.count, blocked: false, baselineRun: false, added, unjustified: [], newBaseline: current };
  }

  const unjustified = added.filter((id) => !justifiedSet.has(id));
  const blocked = unjustified.length > 0;
  return {
    count,
    baseline: baseline.count,
    blocked,
    baselineRun: false,
    added,
    unjustified,
    newBaseline: blocked ? { count: baseline.count, ids: [...baseline.ids].sort() } : current,
  };
}

module.exports = { controlIds, justifiedIds, budgetDecision };
