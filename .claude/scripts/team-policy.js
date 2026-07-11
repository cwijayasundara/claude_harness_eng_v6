'use strict';

// Solo-vs-team policy for multi-story groups (token cost control).
// Deterministic heuristic: avoid multi-agent boundary tax when ownership spans
// are tiny and stories do not share Produces/Consumes edges.
//
// Pure: takes already-parsed story/ownership facts, returns a decision.

function storyFileCount(story) {
  if (!story || typeof story !== 'object') return Infinity;
  if (Array.isArray(story.files)) return story.files.length;
  if (Array.isArray(story.owned_files)) return story.owned_files.length;
  if (Number.isFinite(story.file_count)) return story.file_count;
  // Unknown ownership → treat as large (prefer team when multi-story).
  return Infinity;
}

function totalOwnedFiles(stories) {
  const set = new Set();
  for (const s of stories || []) {
    const files = s.files || s.owned_files || [];
    if (Array.isArray(files)) {
      for (const f of files) set.add(f);
    }
  }
  return set.size;
}

function hasCrossStoryDeps(stories) {
  for (const s of stories || []) {
    if (s.cross_story_deps === true) return true;
    if ((s.produces && s.produces.length) || (s.consumes && s.consumes.length)) return true;
  }
  return false;
}

/**
 * @param {object} input
 * @param {Array<object>} input.stories
 * @param {object} [input.opts]
 * @param {boolean} [input.opts.force_teams]
 * @param {boolean} [input.opts.force_solo]
 * @param {number} [input.opts.max_files_per_story] default 2
 * @param {number} [input.opts.max_files_group] default 4
 * @returns {{ mode: 'solo'|'solo_sequential'|'team', reason: string, teammates: number, boundary_tax_risk: 'low'|'high' }}
 */
function decideTeamMode({ stories, opts } = {}) {
  const list = Array.isArray(stories) ? stories : [];
  const o = opts || {};
  const maxPerStory = Number.isFinite(o.max_files_per_story) ? o.max_files_per_story : 2;
  const maxGroup = Number.isFinite(o.max_files_group) ? o.max_files_group : 4;

  if (o.force_solo) {
    return {
      mode: list.length <= 1 ? 'solo' : 'solo_sequential',
      reason: 'execution.force_solo',
      teammates: 0,
      boundary_tax_risk: 'low',
    };
  }
  if (o.force_teams && list.length >= 2) {
    return {
      mode: 'team',
      reason: 'execution.force_teams',
      teammates: list.length,
      boundary_tax_risk: 'high',
    };
  }

  if (list.length <= 1) {
    return {
      mode: 'solo',
      reason: 'single_story',
      teammates: 0,
      boundary_tax_risk: 'low',
    };
  }

  const tiny = list.every((s) => storyFileCount(s) <= maxPerStory);
  const groupTiny = totalOwnedFiles(list) <= maxGroup;
  const noCross = !hasCrossStoryDeps(list);

  if (tiny && groupTiny && noCross) {
    return {
      mode: 'solo_sequential',
      reason: 'tiny_ownership_no_cross_deps',
      teammates: 0,
      boundary_tax_risk: 'low',
    };
  }

  return {
    mode: 'team',
    reason: !tiny || !groupTiny ? 'ownership_span' : 'cross_story_deps',
    teammates: list.length,
    boundary_tax_risk: 'high',
  };
}

module.exports = {
  decideTeamMode,
  storyFileCount,
  totalOwnedFiles,
  hasCrossStoryDeps,
};
