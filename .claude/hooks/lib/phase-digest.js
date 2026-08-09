'use strict';

// Compact upstream digests for the planning phases.
//
// Why. `/spec` Step 1 used to say "read specs/brd/brd-requirements.json" — 33 KB
// of requirement text into the main session, followed by brd.md at 26 KB. Those
// blobs then rode in context for every remaining turn of the phase. On a metered
// run the front half billed $118.60 with only $12.00 of generated output; the
// rest was context re-carried turn after turn.
//
// The shaping session does not need requirement prose. It needs to know how many
// there are, which ones have no observable criterion, what the deny-list says,
// what the PRD's own milestone order was, and what is still unresolved. The
// renderer fork reads the full files — that is what forks are for.
//
// Rule this encodes: **ids, counts and open items in the main session; text in
// the fork.** Anything here that starts quoting requirement bodies has
// reintroduced the cost it exists to remove.

const fs = require('fs');
const path = require('path');

/** Parse a JSON artifact, or null when absent/unreadable. */
function readJson(root, rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch (_) {
    return null;
  }
}

/** The array an artifact carries, whatever wrapper key it uses. */
function rows(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  return [];
}

/** First and last id, for a range line that stands in for the whole list. */
function idRange(list) {
  if (!list.length) return null;
  const ids = list.map((r) => r && r.id).filter(Boolean);
  return ids.length ? { first: ids[0], last: ids[ids.length - 1], n: ids.length } : null;
}

/** Tally of a repeated scalar/array field, highest count first. */
function tally(list, field) {
  const counts = {};
  for (const row of list) {
    const raw = row && row[field];
    for (const v of (Array.isArray(raw) ? raw : [raw])) {
      if (v === undefined || v === null || v === '') continue;
      counts[v] = (counts[v] || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

/** One line of an item whose text is itself the decision input. */
function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// The gap that a real run shipped past: brd.md claimed 107/107 acceptance
// coverage when only 26 requirements traced to an explicit criterion. Coverage
// is the digest's headline for /spec because it is the phase's actual work-list.
function acceptanceCoverage(requirements, acceptance) {
  const gated = new Set();
  for (const a of acceptance) {
    for (const r of rows(a.requirements || a.requirement, null).concat(
      typeof a.requirement === 'string' ? [a.requirement] : [],
    )) if (r) gated.add(r);
  }
  for (const r of requirements) {
    if (Array.isArray(r.acceptance) && r.acceptance.length) gated.add(r.id);
  }
  const uncovered = requirements.filter((r) => !gated.has(r.id));
  return { criteria: acceptance.length, gated: requirements.length - uncovered.length, uncovered: uncovered.length };
}

/** What `/spec` needs from `/brd` — ids, counts, deny-list, open items. */
function specInputs(root) {
  const requirements = rows(readJson(root, 'specs/brd/brd-requirements.json'), 'requirements');
  const acceptance = rows(readJson(root, 'specs/brd/brd-acceptance.json'), 'acceptance');
  const confidence = readJson(root, 'specs/plan-confidence.json');
  return {
    source: 'specs/brd/',
    full_text_for_the_renderer: ['brd-requirements.json', 'brd-acceptance.json', 'brd.md'],
    requirements: idRange(requirements),
    taxonomy: tally(requirements, 'taxonomy'),
    acceptance: acceptanceCoverage(requirements, acceptance),
    forbidden: rows(readJson(root, 'specs/brd/brd-safeguards.json'), 'safeguards')
      .map((s) => ({ id: s.id, text: clip(s.text, 110) })),
    milestones: rows(readJson(root, 'specs/brd/brd-milestones.json'), 'milestones')
      .map((m) => ({ id: m.id, done_when: clip(m.done_when, 90) })),
    open_questions: rows(readJson(root, 'specs/brd/brd-open-questions.json'), 'questions')
      .map((q) => ({ id: q.id, text: clip(q.text, 110) })),
    clarifications: idRange(rows(readJson(root, 'specs/brd/clarification-log.json'), 'clarifications')),
    risks: rows(readJson(root, 'specs/brd/brd-risks.json'), 'risks')
      .filter((r) => /\bHigh\b/.test(r.text || '')).map((r) => ({ id: r.id, text: clip(r.text, 90) })),
    confidence: confidence ? (confidence.band || confidence.confidence || null) : null,
  };
}

/** What `/design` needs from `/spec` — shape of the graph, not the story bodies. */
function designInputs(root) {
  const stories = rows(readJson(root, 'specs/stories/stories.json'), 'stories');
  const clusters = readJson(root, 'specs/stories/story-clusters.json') || {};
  const edges = rows(readJson(root, 'specs/stories/dependency-edges.json'), 'edges');
  return {
    source: 'specs/stories/',
    full_text_for_the_renderer: ['stories.json', 'E*-S*.md', 'acceptance-criteria.json'],
    stories: { total: stories.length, by_epic: tally(stories, 'epic'), by_layer: tally(stories, 'layer') },
    needs_breakdown: stories.filter((s) => s.readiness === 'needs_breakdown' || s.needs_breakdown)
      .map((s) => s.id),
    clusters: {
      count: clusters.cluster_count ?? rows(clusters, 'clusters').length,
      unresolved_contracts: rows(clusters, 'unresolved_contracts').length,
      warnings: rows(clusters, 'warnings').map((w) => clip(typeof w === 'string' ? w : w.message, 100)),
    },
    dependency_edges: edges.length,
    features: rows(readJson(root, 'features.json'), 'features').length,
  };
}

/** What `/test` needs — coverage obligations, not the design prose. */
function testInputs(root) {
  const criteria = rows(readJson(root, 'specs/stories/acceptance-criteria.json'), 'acceptance_criteria');
  const stories = rows(readJson(root, 'specs/stories/stories.json'), 'stories');
  return {
    source: 'specs/stories/ + specs/design/',
    full_text_for_the_renderer: ['acceptance-criteria.json', 'specs/design/api-contracts.md', '*.schema.json'],
    acceptance_criteria: criteria.length,
    stories: stories.length,
    schemas: (() => {
      try {
        return fs.readdirSync(path.join(root, 'specs/design')).filter((f) => f.endsWith('.schema.json'));
      } catch (_) { return []; }
    })(),
  };
}

const SOURCES = { spec: specInputs, design: designInputs, test: testInputs };

/** Digest of the upstream inputs for `phase`, or null for an unknown phase. */
function digestFor(phase, root) {
  const build = SOURCES[phase];
  return build ? build(root) : null;
}

module.exports = { digestFor, PHASES: Object.keys(SOURCES), readJson, rows, clip, tally, idRange };
