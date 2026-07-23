'use strict';

// Coupling-fail ratchet (gap G18). Unstable-hub data has existed since gap G2
// (drift.js's unstableHubIds, embedded in code-graph.json's metrics.hubs) but
// only ever surfaced on the drift cadence (npm run drift) or in the on-demand
// coupling-report.md — never fed back to the agent as a commit-time
// self-correction signal. This makes the unstable-hub COUNT a monotonic
// ratchet, the same shape as the import-cycle ratchet (gap G8,
// hooks/lib/cycle-gate.js): the count may not rise above baseline. Reuses
// drift.js's threshold logic and cycle-gate.js's ratchet decision so each has
// one source of truth, rather than reimplementing either.
// Known limitation (documented in docs/sensor-arbitration.md's G18 section):
// this is count-based, not set-based — a same-commit swap (one hub fixed,
// a different hub newly crosses the threshold) nets to an unchanged count
// and passes without naming the new hub.
// Gap G26: reads via drift.js's hubsForStabilityCheck, which prefers the
// uncapped metrics.unstable_hubs field when present so a hub ranked 26th+ by
// fan-in in the top-25-truncated metrics.hubs list is still caught by this
// ratchet, falling back to the prior capped-hubs behavior when absent.

// drift.js ships in the brownfield pack; a core install omits it. The coupling ratchet
// reads unstable hubs from the code-graph, which only exists once brownfield has run —
// so a core install has nothing to rank and a guarded load degrades to "no unstable hubs"
// (the empty, non-blocking result) instead of crashing at require.
let driftLib = null;
try { driftLib = require('./drift'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; /* else: brownfield pack absent */ }
const { gateDecision } = require('./cycle-gate');

function unstableHubKeys(graph) {
  return driftLib ? driftLib.hubsForStabilityCheck(graph) : [];
}

module.exports = { unstableHubKeys, gateDecision };
