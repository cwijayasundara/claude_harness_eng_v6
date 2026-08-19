'use strict';

// Story bundle — the join of story + design + tests that /implement and /auto
// execute against. Pure: callers pass already-read objects. IO lives in
// bundle-write.js / bundle-check.js.

const {
  extractContract,
  parseEntities,
  operationsArePending,
  operationsHaveFile,
  validateGenerationContract,
} = require('./generation-contract');

const STORY_FILE = /^E\d+-S\d+\.md$/;
const STORY_ID = /\bE\d+-S\d+\b/;
const AC_ID = /\bE\d+-S\d+-AC\d+\b/g;
const FILE_PATH = /(?:`([^`]+\/[^`]+)`|(?:^|\s)([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+))/g;
const SG_ID = /\bSG-\d+\b/g;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function headingBody(md, pattern) {
  const lines = String(md || '').split('\n');
  const start = lines.findIndex((l) => pattern.test(l));
  if (start === -1) return '';
  const level = (lines[start].match(/^#+/) || ['#'])[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^(#+)\s+/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n');
}

function metaField(md, name) {
  const re = new RegExp(`^[-*]\\s*${name}:\\s*(.+)$`, 'im');
  const m = String(md || '').match(re);
  return m ? m[1].trim() : '';
}

function sprintFromPath(rel) {
  const m = String(rel || '').match(/(?:^|\/)sprint-(\d+)(?:\/|$)/);
  return m ? Number(m[1]) : 1;
}

function parseStoryOwnership(text) {
  const owned = new Map();
  const fileRe = /`([^`\n]+)`/g;
  for (const line of String(text || '').split('\n')) {
    const stories = line.match(new RegExp(STORY_ID.source, 'g'));
    if (!stories) continue;
    const paths = [];
    let m;
    const re = new RegExp(fileRe.source, 'g');
    while ((m = re.exec(line)) !== null) {
      const token = m[1].trim().replace(/\\/g, '/').replace(/^\.\//, '');
      if (token && token.includes('/') && !token.startsWith('/')) paths.push(token);
    }
    for (const story of new Set(stories)) {
      owned.set(story, (owned.get(story) || []).concat(paths));
    }
  }
  return owned;
}

function listStoryFiles(entries) {
  const byId = new Map();
  for (const rel of asArray(entries)) {
    const base = String(rel).replace(/\\/g, '/').split('/').pop() || '';
    if (!STORY_FILE.test(base)) continue;
    const id = base.replace(/\.md$/, '');
    const prev = byId.get(id);
    if (!prev || sprintFromPath(rel) >= sprintFromPath(prev)) byId.set(id, rel);
  }
  return [...byId.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([id, path]) => ({ id, path }));
}

function parseParents(md) {
  const raw = metaField(md, 'Depends On');
  if (!raw || /^none$/i.test(raw)) return [];
  return unique(raw.match(new RegExp(STORY_ID.source, 'g')) || []);
}

function parseScopeOut(md) {
  const scope = headingBody(md, /^##\s+Scope\b/i);
  const out = [];
  const outBlock = headingBody(scope ? `## Scope\n${scope}` : md, /^\*\*Out:\*\*|^###\s+Out\b|^[-*]\s*\*\*Out\*\*/i);
  const source = outBlock || scope || '';
  for (const line of source.split('\n')) {
    const m = line.match(/^\*\*Out:\*\*\s*(.+)$/i) || line.match(/^[-*]\s+(.+)$/);
    if (m && !/^\*\*In:\*\*/i.test(m[1])) out.push(m[1].trim());
  }
  return unique(out);
}

function extractAcIds(text) {
  return unique(String(text || '').match(AC_ID) || []);
}

function extractFiles(text) {
  const files = [];
  const src = String(text || '');
  let m;
  const re = new RegExp(FILE_PATH.source, 'g');
  while ((m = re.exec(src)) !== null) {
    files.push((m[1] || m[2] || '').replace(/\\/g, '/'));
  }
  return unique(files);
}

function storyTitle(md, fallback) {
  const h = String(md || '').match(/^#\s+(.+)$/m);
  if (!h) return fallback;
  return h[1].replace(/^E\d+-S\d+\s+[—–-]\s*/, '').trim() || fallback;
}

function findTrace(traces, storyId) {
  return asArray(traces).find((row) => row && row.id === storyId) || { id: storyId, traces: [], acs: [] };
}

function matrixRowsFor(matrix, storyId) {
  const rows = asArray(matrix && matrix.requirements);
  return rows.filter((row) => row && (row.story_id === storyId || String(row.ac_id || '').startsWith(`${storyId}-`)));
}

function testCasesFor(testTraces, acIds) {
  const acs = new Set(acIds);
  return asArray(testTraces).filter((tc) => asArray(tc && tc.traces).some((id) => acs.has(id)));
}

function brAcceptanceFor(acceptance, brdIds, testCases) {
  const wanted = new Set(brdIds);
  const fromSpine = asArray(acceptance)
    .filter((row) => row && (wanted.has(row.requirement) || wanted.has(row.id)))
    .map((row) => row.id);
  const fromTests = testCases.flatMap((tc) => asArray(tc.traces))
    .filter((id) => asArray(acceptance).some((row) => row && row.id === id));
  return unique([...fromSpine, ...fromTests]);
}

function pickAmendment(amendments, storyId, sprint) {
  const files = asArray(amendments);
  const storyHit = files.find((f) => f.includes(`story-${storyId}`));
  if (storyHit) return storyHit;
  const sprintHit = files.find((f) => f.includes(`sprint-${sprint}`));
  return sprintHit || null;
}

function trackerKeyFor(map, storyId) {
  if (!map || typeof map !== 'object') return null;
  const story = map.stories && map.stories[storyId];
  return (story && (story.tracker_key || story.trackerKey)) || null;
}

function buildBundle({
  storyId,
  storyPath,
  markdown,
  storyTraces = [],
  matrix = null,
  testTraces = [],
  ownedFiles = [],
  brdAcceptance = [],
  amendments = [],
  trackerMap = null,
  sprint: sprintOverride,
} = {}) {
  const md = String(markdown || '');
  const contract = extractContract(md);
  const trace = findTrace(storyTraces, storyId);
  const acIds = unique([...extractAcIds(contract.requirements), ...asArray(trace.acs)]);
  const rows = matrixRowsFor(matrix, storyId);
  const cases = testCasesFor(testTraces, acIds);
  const sprint = sprintOverride != null ? sprintOverride : sprintFromPath(storyPath);
  const brdIds = unique(asArray(trace.traces));
  const entities = parseEntities(contract.entities).map((e) => ({
    name: e.name,
    status: e.status,
  }));

  return {
    version: 1,
    story_id: storyId,
    sprint,
    title: storyTitle(md, storyId),
    readiness: (metaField(md, 'Readiness') || 'ready').toLowerCase(),
    requirements: {
      ac_ids: acIds,
      brd_ids: brdIds,
      br_acceptance_ids: brAcceptanceFor(brdAcceptance, brdIds, cases),
      scope_out: parseScopeOut(md),
    },
    entities,
    approach: {
      program_design: 'specs/design/program-design.md',
      canvas: 'specs/design/reasons-canvas.md',
      amendment: pickAmendment(amendments, storyId, sprint),
    },
    structure: {
      owned_files: unique(ownedFiles),
      layer: metaField(md, 'Layer') || null,
    },
    operations: {
      pending: operationsArePending(contract.operations),
      files: extractFiles(contract.operations),
      text: String(contract.operations || '').trim(),
    },
    safeguards: {
      ids: unique(String(contract.safeguards || '').match(SG_ID) || []),
      none: /^none\b/im.test(String(contract.safeguards || '')),
    },
    tests: {
      matrix_ids: unique(rows.map((r) => r.id)),
      case_ids: unique(cases.map((c) => c.id)),
      layers: unique(rows.flatMap((r) => asArray(r.required_layers))),
    },
    provenance: {
      story_path: storyPath,
      parents: parseParents(md),
      tracker_key: trackerKeyFor(trackerMap, storyId),
    },
  };
}

function checkTestBrdTraces(testTraces, brdAcceptance) {
  const ids = new Set(asArray(brdAcceptance).map((row) => row && row.id).filter(Boolean));
  if (!ids.size) return { pass: true, errors: [] };
  const errors = [];
  for (const tc of asArray(testTraces)) {
    const traces = asArray(tc && tc.traces);
    const hasStoryAc = traces.some((id) => /\bE\d+-S\d+-AC\d+\b/.test(id));
    if (!hasStoryAc) continue;
    if (!traces.some((id) => ids.has(id))) {
      errors.push(`${tc.id || 'TC'} traces a story AC but no brd-acceptance id`);
    }
  }
  return { pass: errors.length === 0, errors };
}

function checkBundle(bundle, {
  mode = 'skeleton',
  markdown = '',
  safeguards = [],
  matrixPresent = false,
  mapPresent = false,
} = {}) {
  const errors = [];
  if (!bundle || !bundle.story_id) {
    errors.push('missing bundle');
    return { pass: false, errors };
  }
  const req = bundle.requirements || {};
  if (!asArray(req.ac_ids).length) errors.push('bundle has no AC ids');

  const contract = validateGenerationContract(markdown, { mode, safeguards });
  errors.push(...contract.errors);

  if (mode === 'implementable') {
    if (matrixPresent && !asArray(bundle.tests && bundle.tests.matrix_ids).length) {
      errors.push('implementable bundle has no verification-matrix rows');
    }
    if (!matrixPresent) errors.push('verification-matrix.json is required before implementation');
    const owned = asArray(bundle.structure && bundle.structure.owned_files);
    const opFiles = asArray(bundle.operations && bundle.operations.files);
    if (mapPresent && !owned.length && !opFiles.length) {
      errors.push('implementable bundle has no owned files or Operations paths');
    }
    if (!mapPresent && !opFiles.length) {
      errors.push('component-map.md is required before implementation');
    }
    if (asArray(req.brd_ids).length && asArray(req.br_acceptance_ids).length === 0) {
      // Only a hard miss when a BRD acceptance spine was supplied (caller sets
      // brAcceptanceRequired). Soft here so skeleton write still emits.
    }
  }

  return { pass: errors.length === 0, errors };
}

function checkProject(project, { mode = 'skeleton' } = {}) {
  const stories = asArray(project && project.stories);
  const ready = stories.filter((s) => s.readiness !== 'needs_breakdown');
  if (!ready.length) {
    return { pass: true, dormant: true, errors: [], checked: 0 };
  }

  const errors = [];
  const acceptance = asArray(project.brdAcceptance);
  const acceptancePresent = acceptance.length > 0;
  const testTraces = asArray(project.testTraces);

  if (mode === 'implementable' && acceptancePresent && testTraces.length) {
    const traces = checkTestBrdTraces(testTraces, acceptance);
    errors.push(...traces.errors);
  }

  for (const story of ready) {
    if (!story.bundle) {
      errors.push(`${story.id}: missing specs/bundles/${story.id}.json`);
      continue;
    }
    const result = checkBundle(story.bundle, {
      mode,
      markdown: story.markdown || '',
      safeguards: project.safeguards || [],
      matrixPresent: Boolean(project.matrixPresent),
      mapPresent: Boolean(project.mapPresent),
    });
    if (mode === 'implementable' && acceptancePresent) {
      const req = story.bundle.requirements || {};
      if (asArray(req.brd_ids).length && !asArray(req.br_acceptance_ids).length) {
        result.errors.push('story traces a BR id but bundle has no brd-acceptance id');
        result.pass = false;
      }
    }
    for (const err of result.errors) errors.push(`${story.id}: ${err}`);
  }

  return { pass: errors.length === 0, dormant: false, errors, checked: ready.length };
}

module.exports = {
  listStoryFiles,
  parseStoryOwnership,
  sprintFromPath,
  buildBundle,
  checkBundle,
  checkProject,
  checkTestBrdTraces,
  matrixRowsFor,
  operationsHaveFile,
};
