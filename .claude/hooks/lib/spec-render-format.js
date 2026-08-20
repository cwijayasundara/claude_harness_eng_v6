'use strict';

function asArray(v) { return Array.isArray(v) ? v : []; }

function renderStoryMd(story, cluster, acs, safeguards) {
  const deps = JSON.stringify(asArray(story.depends_on));
  const invest = story.invest || {};
  const letter = (k) => (invest[k] === false ? '✗' : '✓');
  const startable = cluster && cluster.independently_startable ? 'yes' : 'no';
  const acLines = acs.map((ac) =>
    `- **${ac.id}** — *Given* ${ac.given}, *when* ${ac.when}, *then* ${ac.then}.`);
  const reqLines = acs.map((ac) =>
    `- **${ac.id}** — Given ${ac.given}, when ${ac.when}, then ${ac.then}`);
  // What this list says is what the generator is handed at implement time.
  // Rendering `safeguards.slice(0, 3)` made every story claim the project's
  // first three deny-list entries whatever it did, so a story could be built
  // without the entry that actually bounded it. Cite what /spec scoped to this
  // story; unscoped means the whole deny-list still applies, not an arbitrary
  // three of it.
  const scoped = asArray(story.safeguards);
  const cite = (list) => list.map((s) => `- ${s.id || s}`).join('\n');
  const sg = scoped.length ? cite(scoped)
    : (asArray(safeguards).length ? cite(asArray(safeguards))
      : '- none — the BRD lists no forbidden action for this project');
  return `# ${story.id} — ${story.title}

## Metadata
- Epic: ${story.epic}
- Layer: ${story.layer || 'API'}
- Group: ${story.group || 'A'}
- Cluster: ${cluster ? cluster.id : 'C1'} (independently startable: ${startable})
- Depends On: ${deps}
- INVEST: independent ${letter('independent')} · negotiable ${letter('negotiable')} · valuable ${letter('valuable')} · estimable ${letter('estimable')} · small ${letter('small')} · testable ${letter('testable')}
- Readiness: ${story.readiness || 'ready'}
- Breakdown Reason: ${story.breakdown_reason || 'null'}
- Story Points: ${story.story_points == null ? 'null' : story.story_points}
- Estimation Confidence: ${story.estimation_confidence || 'medium'}

## User Story
${story.user_story || `As a user, I want ${story.title} so that the milestone advances.`}

## Business Value
${story.business_value || story.title}

## Description
${story.description || story.title}

## Scope
**In:** ${asArray(story.scope_in).join('; ') || story.title}
**Out:** ${asArray(story.scope_out).join('; ') || 'must not expand deferred milestone scope'}

## Acceptance Criteria
${acLines.join('\n')}

## Generation Contract
### Requirements
${reqLines.join('\n')}
### Entities
- ${story.title} — unknown
### Operations
- pending
### Safeguards
${sg}
`;
}

function renderEpics(stories, decisions) {
  const byEpic = new Map();
  for (const s of stories) {
    if (!byEpic.has(s.epic)) byEpic.set(s.epic, []);
    byEpic.get(s.epic).push(s.id);
  }
  const ms = (decisions && decisions.milestone) || {};
  const rows = [...byEpic.entries()].map(([id, ids]) =>
    `| ${id} | ${ids.join(', ')} | ${ids.length} |`);
  const deferred = asArray(ms.deferred_epics).map((id) => `| ${id} | deferred |`).join('\n');
  return `# Epic Index

Scope: **${ms.name || 'current milestone'}**. Expanded: ${(ms.epics || []).join(', ') || 'see stories'}.

| Epic | Stories | Count |
|---|---|---|
${rows.join('\n')}

## Deferred
${deferred || '_none_'}
`;
}

function renderGraphMd(groups, stories, clusters) {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const tables = groups.map((g) => {
    const rows = g.stories.map((id) => {
      const s = byId.get(id);
      const deps = asArray(s.depends_on).map((d) => (typeof d === 'string' ? d : `${d.story} (${d.kind})`)).join(', ') || '—';
      return `| ${id} | ${s.title} | ${s.layer || ''} | ${s.story_points || ''} | ${deps} |`;
    });
    return `## Group ${g.id}\n\n| Story | Title | Layer | Points | Dependencies |\n|---|---|---|---|---|\n${rows.join('\n')}\n`;
  });
  const clusterNote = clusters && clusters.clusters
    ? clusters.clusters.map((c) => `- ${c.id}: ${c.stories.join(', ')} (${c.story_points} pts)`).join('\n')
    : '';
  return `# Dependency Graph\n\n${tables.join('\n')}\n## Ownership Clusters\n\n${clusterNote}\n`;
}

module.exports = { renderStoryMd, renderEpics, renderGraphMd };
