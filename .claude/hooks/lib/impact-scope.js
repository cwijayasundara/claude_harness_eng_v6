'use strict';

// Deterministic primitives for impact-scope.js (gap G16, pass 2a). Reused by
// .claude/scripts/impact-scope.js (CLI/orchestration) — kept separate so the
// mechanical pieces are unit-testable in isolation, the split
// hooks/lib/regression-gate.js (G15) already uses.
//
// Pipeline: changed files -> reverse-dependency (blast-radius) closure over
// code-graph.json's imports/calls edges -> owning story-group(s)
// (verification-matrix.json primary, component-map.md + features.json
// fallback) -> e2e spec(s) + sprint-contract.
//
// Blast-radius files resolving to no owner are common (shared utilities,
// infra) and are NOT individually noted — only explicitly changed files get
// a "no owning story-group resolved" note, to keep signal high.

const fs = require('fs');
const path = require('path');

function readJsonSafe(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } }
function readTextSafe(file) { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return null; } }

// ---------------------------------------------------------------------------
// git plumbing (dependency-injected exec — the pattern ownership-check.js
// uses for stagedFiles, so this is unit-testable without a real repo)
// ---------------------------------------------------------------------------

function resolveDefaultBranch(exec) {
  try {
    const ref = exec('git', ['symbolic-ref', 'refs/remotes/origin/HEAD']).trim();
    const m = ref.match(/^refs\/remotes\/(.+)$/);
    if (m) return m[1];
  } catch (_) { /* fall through to verify candidates */ }
  for (const candidate of ['origin/main', 'origin/master']) {
    try { exec('git', ['rev-parse', '--verify', candidate]); return candidate; } catch (_) { /* try next */ }
  }
  return null;
}

function resolveBaseRef(exec, explicitBaseRef) {
  if (explicitBaseRef) return explicitBaseRef;
  const branch = resolveDefaultBranch(exec);
  return branch ? exec('git', ['merge-base', 'HEAD', branch]).trim() : null;
}

function gitChangedFiles(exec, baseRef) {
  return exec('git', ['diff', '--name-only', baseRef]).split('\n').map((l) => l.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Blast radius: reverse-dependency closure over imports/calls edges
// ---------------------------------------------------------------------------

const BLAST_KINDS = new Set(['imports', 'calls']);

function buildReverseIndex(graph) {
  const idByPath = new Map();
  const pathById = new Map();
  for (const node of graph.nodes || []) {
    if (node.path) { idByPath.set(node.path, node.id); pathById.set(node.id, node.path); }
  }
  const reverseAdj = new Map(); // dependency id -> [dependent ids] (who depends ON this)
  for (const edge of graph.edges || []) {
    if (!BLAST_KINDS.has(edge.kind)) continue;
    if (!reverseAdj.has(edge.target)) reverseAdj.set(edge.target, []);
    reverseAdj.get(edge.target).push(edge.source);
  }
  return { idByPath, pathById, reverseAdj };
}

function traverseBlastRadius(startId, reverseAdj, pathById, changedSet) {
  const visited = new Set([startId]);
  const queue = [startId];
  const found = [];
  while (queue.length) {
    const cur = queue.shift();
    for (const dependent of reverseAdj.get(cur) || []) {
      if (visited.has(dependent)) continue;
      visited.add(dependent);
      const p = pathById.get(dependent);
      if (p && !changedSet.has(p)) found.push(p);
      queue.push(dependent);
    }
  }
  return found;
}

// null graph -> loud note, empty blast radius (changed files still stand
// alone — G15's full merge-time gate remains the backstop for anything this
// misses).
function computeBlastRadius(graph, changedFiles) {
  if (!graph) {
    return {
      blastRadiusFiles: [],
      notes: ['no code-graph available — blast-radius analysis skipped (only the explicitly changed files are considered, not their dependents)'],
    };
  }
  const { idByPath, pathById, reverseAdj } = buildReverseIndex(graph);
  const changedSet = new Set(changedFiles);
  const notes = [];
  const result = new Set();
  for (const file of changedFiles) {
    const id = idByPath.get(file);
    if (!id) { notes.push(`changed file not found in code-graph: ${file}`); continue; }
    for (const p of traverseBlastRadius(id, reverseAdj, pathById, changedSet)) result.add(p);
  }
  return { blastRadiusFiles: [...result].sort(), notes };
}

// ---------------------------------------------------------------------------
// component-map.md fallback: story -> files (tolerant backtick parsing, per
// table row, in the spirit of ownership-check.js's flat parser)
// ---------------------------------------------------------------------------

const STORY_ID_RE = /^[A-Za-z0-9]+-[A-Za-z0-9]+$/;

function parseComponentMapStoryFiles(text) {
  const map = new Map();
  for (const line of String(text).split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length && cells[0] === '') cells.shift();
    if (cells.length && cells[cells.length - 1] === '') cells.pop();
    const storyCell = cells[0];
    if (!storyCell || !STORY_ID_RE.test(storyCell)) continue;
    const filesCell = cells.slice(1).join('|');
    const files = [...filesCell.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
    if (!files.length) continue;
    if (!map.has(storyCell)) map.set(storyCell, new Set());
    for (const f of files) map.get(storyCell).add(f);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Group resolution: verification-matrix.json primary, component-map.md +
// features.json fallback. quiet=true suppresses notes (blast-radius files).
// ---------------------------------------------------------------------------

function buildMatrixFileGroups(matrix) {
  const map = new Map();
  if (!matrix || !Array.isArray(matrix.requirements)) return map;
  for (const req of matrix.requirements) {
    for (const p of req.implementation_paths || []) {
      if (!map.has(p)) map.set(p, new Set());
      map.get(p).add(req.group);
    }
  }
  return map;
}

function buildFileToStories(mapText) {
  const fileToStories = new Map();
  if (!mapText) return fileToStories;
  for (const [story, fset] of parseComponentMapStoryFiles(mapText)) {
    for (const f of fset) {
      if (!fileToStories.has(f)) fileToStories.set(f, new Set());
      fileToStories.get(f).add(story);
    }
  }
  return fileToStories;
}

function buildStoryToGroup(features) {
  const map = new Map();
  for (const feat of features) { if (feat && feat.story) map.set(feat.story, feat.group); }
  return map;
}

function groupsForFile(file, matrixFileGroups, fileToStories, storyToGroup) {
  const groups = new Set();
  if (matrixFileGroups.has(file)) for (const g of matrixFileGroups.get(file)) groups.add(g);
  if (groups.size === 0 && fileToStories.has(file)) {
    for (const story of fileToStories.get(file)) {
      const g = storyToGroup.get(story);
      if (g) groups.add(g);
    }
  }
  return groups;
}

function resolveGroupsForFiles(root, files, opts) {
  const quiet = !!opts.quiet;
  const notes = [];
  const matrix = readJsonSafe(path.join(root, opts.matrixPath));
  const mapText = readTextSafe(path.join(root, opts.componentMapPath));
  if (!matrix && !mapText && !quiet) {
    notes.push(`no ${opts.matrixPath} and no ${opts.componentMapPath} — cannot resolve owning story-groups for changed/impacted files`);
  }

  const matrixFileGroups = buildMatrixFileGroups(matrix);
  const fileToStories = buildFileToStories(mapText);
  const features = readJsonSafe(path.join(root, opts.featuresPath || 'features.json')) || [];
  const storyToGroup = buildStoryToGroup(features);

  const fileGroups = new Map();
  const impacted = new Set();
  for (const file of files) {
    const groups = groupsForFile(file, matrixFileGroups, fileToStories, storyToGroup);
    if (groups.size === 0) { if (!quiet) notes.push(`no owning story-group resolved for ${file}`); }
    else for (const g of groups) impacted.add(g);
    fileGroups.set(file, groups);
  }
  return { fileGroups, impactedGroups: [...impacted].sort(), notes };
}

// ---------------------------------------------------------------------------
// Spec + contract resolution for a set of impacted groups
// ---------------------------------------------------------------------------

function resolveGroupSpecsAndContract(root, group, requirements, opts) {
  const notes = [];
  const storyIds = [...new Set(
    requirements.filter((r) => r.group === group).map((r) => r.story_id).filter(Boolean)
  )];
  const specs = [];
  for (const storyId of storyIds) {
    const specRel = path.join(opts.e2eDir, `${storyId}.spec.ts`);
    if (fs.existsSync(path.join(root, specRel))) specs.push(specRel);
    else notes.push(`no e2e spec found for story "${storyId}"`);
  }
  const contractRel = path.join(opts.contractsDir, `${group}.json`);
  const contract = fs.existsSync(path.join(root, contractRel)) ? contractRel : null;
  if (!contract) notes.push(`no sprint-contract found for group "${group}"`);
  return { storyIds, specs, contract, notes };
}

function resolveSpecsAndContracts(root, groups, opts) {
  const matrix = readJsonSafe(path.join(root, opts.matrixPath));
  const requirements = (matrix && Array.isArray(matrix.requirements)) ? matrix.requirements : [];
  const specs = [];
  const contracts = [];
  const perGroup = [];
  const notes = [];
  for (const group of groups) {
    const res = resolveGroupSpecsAndContract(root, group, requirements, opts);
    specs.push(...res.specs);
    if (res.contract) contracts.push(res.contract);
    notes.push(...res.notes);
    perGroup.push({ group, storyIds: res.storyIds, specs: res.specs, contract: res.contract });
  }
  return { specs, contracts, perGroup, notes };
}

// ---------------------------------------------------------------------------
// Full pipeline composition
// ---------------------------------------------------------------------------

// excludeGroups keeps the current, still-in-flight group out of scope — the
// same role --exclude-group plays in G15's discoverPriorContracts.
function resolveAllImpactedGroups(root, changedFiles, blastRadiusFiles, opts) {
  const groupOpts = { matrixPath: opts.matrixPath, componentMapPath: opts.componentMapPath };
  const changedRes = resolveGroupsForFiles(root, changedFiles, groupOpts);
  const blastRes = blastRadiusFiles.length
    ? resolveGroupsForFiles(root, blastRadiusFiles, { ...groupOpts, quiet: true })
    : { impactedGroups: [] };
  const excluded = new Set(opts.excludeGroups || []);
  const impactedGroups = [...new Set([...changedRes.impactedGroups, ...blastRes.impactedGroups])]
    .filter((g) => !excluded.has(g))
    .sort();
  return { impactedGroups, notes: changedRes.notes };
}

function computeImpactScope(opts) {
  const notes = [];
  const graph = readJsonSafe(path.join(opts.root, opts.graphPath));
  if (!graph) notes.push(`no ${opts.graphPath} — blast-radius analysis skipped (code-graph not found; only the explicitly changed files are considered, not their dependents)`);

  const blast = computeBlastRadius(graph, opts.changedFiles);
  notes.push(...blast.notes);

  const { impactedGroups, notes: groupNotes } = resolveAllImpactedGroups(opts.root, opts.changedFiles, blast.blastRadiusFiles, opts);
  notes.push(...groupNotes);

  const specsRes = resolveSpecsAndContracts(opts.root, impactedGroups, {
    matrixPath: opts.matrixPath, e2eDir: opts.e2eDir, contractsDir: opts.contractsDir,
  });
  notes.push(...specsRes.notes);

  return {
    changedFiles: opts.changedFiles,
    blastRadiusFiles: blast.blastRadiusFiles,
    impactedGroups,
    specs: specsRes.specs,
    contracts: specsRes.contracts,
    notes,
  };
}

module.exports = {
  resolveDefaultBranch,
  resolveBaseRef,
  gitChangedFiles,
  computeBlastRadius,
  parseComponentMapStoryFiles,
  resolveGroupsForFiles,
  resolveSpecsAndContracts,
  computeImpactScope,
};
