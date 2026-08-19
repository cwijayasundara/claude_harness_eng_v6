'use strict';

// Code → story-bundle Structure/Operations. Refactors only.
// If acceptance criteria drifted, fail closed — update the story then bundle-write.

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function sameSet(a, b) {
  const left = new Set(a || []);
  const right = new Set(b || []);
  if (left.size !== right.size) return false;
  for (const x of left) if (!right.has(x)) return false;
  return true;
}

function acIdsFromMarkdown(md) {
  return unique(String(md || '').match(/\bE\d+-S\d+-AC\d+\b/g));
}

function planStorySync({ bundle, storyMarkdown, mapFiles = [], changedFiles = [] } = {}) {
  if (!bundle || !bundle.story_id) {
    return { story_id: null, behavior: false, added_files: [], errors: ['missing bundle'] };
  }
  const storyAcs = acIdsFromMarkdown(storyMarkdown);
  const bundleAcs = (bundle.requirements && bundle.requirements.ac_ids) || [];
  const behavior = storyAcs.length > 0 && bundleAcs.length > 0 && !sameSet(storyAcs, bundleAcs);
  const owned = new Set((bundle.structure && bundle.structure.owned_files) || []);
  const mapped = unique(mapFiles);
  const added = mapped.filter((f) => !owned.has(f));
  const errors = behavior
    ? [`${bundle.story_id}: acceptance criteria changed — update the story, then bundle-write; do not story-sync`]
    : [];
  return {
    story_id: bundle.story_id,
    behavior,
    added_files: added,
    changed_owned: unique(changedFiles).filter((f) => owned.has(f) || mapped.includes(f)),
    errors,
  };
}

function applyStorySync(bundle, plan, now) {
  if (!bundle || !plan || plan.behavior) return bundle;
  const added = plan.added_files || [];
  const owned = unique([
    ...((bundle.structure && bundle.structure.owned_files) || []),
    ...added,
  ]);
  const files = unique([
    ...((bundle.operations && bundle.operations.files) || []),
    ...added,
  ]);
  const extra = added.map((f) => `- synced: \`${f}\``);
  const prev = (bundle.operations && bundle.operations.text) || '';
  return {
    ...bundle,
    structure: { ...(bundle.structure || {}), owned_files: owned },
    operations: {
      ...(bundle.operations || {}),
      pending: false,
      files,
      text: [prev, ...extra].filter(Boolean).join('\n'),
    },
    provenance: { ...(bundle.provenance || {}), synced_at: now },
  };
}

function planProjectSync({ stories = [], changedFiles = [] } = {}) {
  const plans = stories.map((s) => planStorySync({
    bundle: s.bundle,
    storyMarkdown: s.markdown,
    mapFiles: s.mapFiles,
    changedFiles,
  }));
  const errors = plans.flatMap((p) => p.errors);
  return {
    pass: errors.length === 0,
    errors,
    plans,
    added: unique(plans.flatMap((p) => p.added_files)),
  };
}

module.exports = {
  acIdsFromMarkdown,
  planStorySync,
  applyStorySync,
  planProjectSync,
};
