'use strict';

// Per-topology harness templates (gap G10). Resolves a scaffold profile to a
// named topology and the coherent preset of manifest knobs it implies, so
// /scaffold applies topology-aware defaults (Ashby's-Law variety reduction)
// instead of one uniform manifest. Drop-in extensible: add a TOPOLOGIES entry
// and a resolveTopology clause. The manifest stays per-project overridable.
//
// Knobs preset per topology (existing manifest fields only):
//   - model_tier / ceremony  (execution posture)
//   - verification_mode       (how /evaluate reaches the app; undefined -> docker default)
//   - observability_enabled   (gates the observability guide + runtime-SLO sensor)
//   - architecture            (undefined -> layers.js defaults apply; {enabled:false} -> off)

const SERVER = {
  lite: false, model_tier: 'balanced', ceremony: 'full',
  verification_mode: undefined, observability_enabled: true, architecture: undefined,
};

const TOPOLOGIES = {
  'web-app': {
    ...SERVER,
    summary: 'layered architecture · observability · docker verify · full ceremony · balanced model tier',
  },
  'api-service': {
    ...SERVER,
    summary: 'layered architecture · observability · docker verify · full ceremony · balanced model tier (no UI)',
  },
  'cli-or-library': {
    lite: true, model_tier: 'cost', ceremony: 'trimmed',
    verification_mode: 'B', observability_enabled: false, architecture: { enabled: false },
    summary: 'no layer enforcement · no observability · local verify · trimmed ceremony · cost model tier',
  },
};

// `lite` is computed by scaffold-render's isLiteShaped and passed in, so the
// lite path and the cli-or-library topology can never diverge.
function resolveTopology(profile, lite) {
  if (lite) return 'cli-or-library';
  const stack = profile.stack || {};
  if (stack.frontend) return 'web-app';
  return 'api-service';
}

function topologyPreset(id) {
  if (!Object.prototype.hasOwnProperty.call(TOPOLOGIES, id)) {
    throw new Error(`Unknown topology: ${id}`);
  }
  return TOPOLOGIES[id];
}

module.exports = { TOPOLOGIES, resolveTopology, topologyPreset };
