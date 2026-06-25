'use strict';

// Builds a one-issue tracker-map for a single brownfield story. The shape is
// exactly what publish-to-linear.js already consumes (it iterates
// trackerMap.groups and reads title / body_file / labels / stories), so the
// publisher needs no changes — `--granularity single` is just a one-entry map.
// `acBody` is declared but intentionally not written here: the caller writes the
// acceptance criteria to `body_file` (group-<storyId>.md); this helper only
// names that path so the map and the body file stay in agreement.
function buildSingleStoryMap({ storyId, title, acBody = '', labels = [], provider = 'linear', config = {} }) {
  if (!storyId) throw new Error('storyId required');
  if (!title) throw new Error('title required');
  const bodyFile = `.claude/state/tracker-runs/group-${storyId}.md`;
  const allLabels = Array.from(new Set(['agent-ready', ...labels]));
  return {
    provider,
    granularity: 'single',
    status: 'pending',
    groups: {
      [storyId]: {
        title,
        body_file: bodyFile,
        labels: allLabels,
        stories: [storyId],
        depends_on_groups: [],
        tracker_key: null
      }
    },
    stories: {
      [storyId]: { group: storyId, tracker_key: null }
    },
    config_snapshot: config
  };
}

module.exports = { buildSingleStoryMap };
