'use strict';

// Read-only accessors over the state files the harness already writes. No file
// here is ever mutated. Shared by pipeline-snapshot.js and pipeline-status.js.

const fs = require('fs');
const path = require('path');
const { gatherSpend, computeBudget, defaultBudget, costSummary } = require('./budget-state');

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return '';
  }
}

function readMarker(stateDir, name) {
  const value = readText(path.join(stateDir, name)).trim();
  return value || null;
}

function readJsonl(file) {
  return readText(file)
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function readRunReceipts(projectDir) {
  const runsDir = path.join(projectDir, '.claude', 'runs');
  try {
    return fs.readdirSync(runsDir)
      .filter((name) => name.endsWith('.jsonl'))
      .sort()
      .flatMap((name) => readJsonl(path.join(runsDir, name)));
  } catch (_) {
    return [];
  }
}

function findProjectDir(startDir) {
  let cur = startDir;
  while (true) {
    if (fs.existsSync(path.join(cur, '.claude'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function parseList(raw) {
  if (!raw) return [];
  const inner = raw.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!inner || inner.toLowerCase() === 'none') return [];
  return inner.split(',').map((s) => s.trim()).filter(Boolean);
}

function pct(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

// The progress file is append-only with one block per session; only the latest
// matters. Read from the last "=== Session" marker up to the next "=== " block
// (e.g. a "=== Build Result ===" trailer) so trailer keys never leak in.
function parseLatestSession(text) {
  const map = {};
  const idx = text.lastIndexOf('=== Session');
  if (idx === -1) return map;
  let block = text.slice(idx);
  const nextSep = block.indexOf('\n=== ');
  if (nextSep !== -1) block = block.slice(0, nextSep);
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (m) map[m[1]] = m[2].trim();
  }
  return map;
}

function readProgress(projectDir) {
  return parseLatestSession(readText(path.join(projectDir, 'claude-progress.txt')));
}

function tallyFeatures(arr) {
  const byGroup = {};
  let passing = 0;
  for (const f of arr) {
    const g = f.group || 'ungrouped';
    byGroup[g] = byGroup[g] || { p: 0, t: 0 };
    byGroup[g].t += 1;
    if (f.passes) { byGroup[g].p += 1; passing += 1; }
  }
  const fmt = {};
  for (const [g, c] of Object.entries(byGroup)) fmt[g] = `${c.p}/${c.t}`;
  return { passing, total: arr.length, by_group: fmt };
}

function readFeatures(projectDir) {
  let arr;
  try {
    arr = JSON.parse(readText(path.join(projectDir, 'features.json')));
  } catch (_) {
    arr = null;
  }
  return Array.isArray(arr) ? tallyFeatures(arr) : { passing: 0, total: 0, by_group: {} };
}

function countGroupsFromGraph(projectDir) {
  const text = readText(path.join(projectDir, 'specs', 'stories', 'dependency-graph.md'));
  const names = new Set();
  for (const m of text.matchAll(/\*\*Group ([A-Za-z0-9]+)\*\*/g)) names.add(m[1]);
  for (const m of text.matchAll(/Group ([A-Za-z0-9]+):/g)) names.add(m[1]);
  return names.size;
}

// Plan-confidence artifact written by plan-confidence.js at the end of planning.
// Absent (no planning run yet, or older project) → null, so callers omit it.
function readPlanConfidence(projectDir) {
  let obj;
  try {
    obj = JSON.parse(readText(path.join(projectDir, 'specs', 'plan-confidence.json')));
  } catch (_) {
    return null;
  }
  if (!obj || typeof obj.band !== 'string') return null;
  return {
    band: obj.band,
    score: typeof obj.score === 'number' ? obj.score : null,
    threshold: typeof obj.threshold === 'number' ? obj.threshold : null,
    drivers: Array.isArray(obj.drivers) ? obj.drivers : [],
  };
}

// Live per-run budget, or null when no run is being metered (no budget-start
// marker) or the budget is disabled. Wall-clock needs an origin, so absence of
// the marker means "not metering" → /status omits the line (backward compatible).
function readManifestExec(projectDir) {
  let manifest = {};
  try {
    manifest = JSON.parse(readText(path.join(projectDir, 'project-manifest.json')));
  } catch (_) {
    manifest = {};
  }
  return (manifest && manifest.execution) || {};
}

function readBudget(projectDir, nowMs) {
  const started = parseInt(readMarker(path.join(projectDir, '.claude', 'state'), 'budget-start') || '', 10);
  if (!Number.isFinite(started)) return null;
  const exec = readManifestExec(projectDir);
  const tier = exec.model_tier || 'balanced';
  const config = exec.budget || defaultBudget(tier);
  const spent = gatherSpend(readRunReceipts(projectDir), started, nowMs || Date.now(), tier);
  return computeBudget(spent, config);
}

// Cost visibility for /status. Shown when metering (budget-start) exists, even
// if budget caps are off — operators still need the model-mix line.
function readCostSummary(projectDir, nowMs) {
  const started = parseInt(readMarker(path.join(projectDir, '.claude', 'state'), 'budget-start') || '', 10);
  if (!Number.isFinite(started)) return null;
  const exec = readManifestExec(projectDir);
  const tier = exec.model_tier || 'balanced';
  return costSummary(readRunReceipts(projectDir), started, nowMs || Date.now(), tier);
}

function readNavigation(projectDir) {
  let obj;
  try {
    obj = JSON.parse(readText(path.join(projectDir, '.claude', 'state', 'navigation-status.json')));
  } catch (_) {
    return null;
  }
  if (!obj || typeof obj.status !== 'string') return null;
  return {
    status: obj.status,
    graph: obj.graph || 'unknown',
    wiki: obj.wiki || 'unknown',
    source_files: Number.isFinite(obj.source_files) ? obj.source_files : 0,
    indexed_files: Number.isFinite(obj.indexed_files) ? obj.indexed_files : 0,
    dirty_files: Number.isFinite(obj.dirty_files) ? obj.dirty_files : 0,
    estimated_context_query_tokens: Number.isFinite(obj.estimated_context_query_tokens)
      ? obj.estimated_context_query_tokens : null,
    estimated_tokens_saved_per_orientation: Number.isFinite(obj.estimated_tokens_saved_per_orientation)
      ? obj.estimated_tokens_saved_per_orientation : null,
    last_refresh: obj.last_refresh || null,
  };
}

function tallyContextCacheEntries(dir, files) {
  let entries = 0;
  let estimatedRaw = 0;
  let estimatedPack = 0;
  let estimatedSaved = 0;
  const byKind = {};
  for (const file of files) {
    let obj;
    try {
      obj = JSON.parse(readText(path.join(dir, file)));
    } catch (_) {
      continue;
    }
    entries += 1;
    const kind = obj.kind || 'unknown';
    byKind[kind] = (byKind[kind] || 0) + 1;
    if (Number.isFinite(obj.estimated_raw_tokens)) estimatedRaw += obj.estimated_raw_tokens;
    if (Number.isFinite(obj.estimated_pack_tokens)) estimatedPack += obj.estimated_pack_tokens;
    if (Number.isFinite(obj.estimated_saved_tokens)) estimatedSaved += obj.estimated_saved_tokens;
  }
  return { entries, byKind, estimatedRaw, estimatedPack, estimatedSaved };
}

function readContextCache(projectDir) {
  const dir = path.join(projectDir, '.claude', 'state', 'context-cache');
  let files;
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  } catch (_) {
    return null;
  }
  const { entries, byKind, estimatedRaw, estimatedPack, estimatedSaved } = tallyContextCacheEntries(dir, files);
  if (!entries) return null;
  return {
    entries,
    by_kind: byKind,
    estimated_raw_tokens: estimatedRaw,
    estimated_pack_tokens: estimatedPack,
    estimated_saved_tokens: estimatedSaved,
  };
}

function readTokenAdvisor(projectDir) {
  const records = readJsonl(path.join(projectDir, '.claude', 'state', 'token-advisor.jsonl'));
  if (!records.length) return null;
  const byKind = {};
  for (const r of records) {
    const kind = r.kind || 'unknown';
    byKind[kind] = (byKind[kind] || 0) + 1;
  }
  return {
    warnings: records.length,
    by_kind: byKind,
    latest: records[records.length - 1],
  };
}

function readNavTelemetry(projectDir) {
  try {
    const { readNavTelemetrySummary } = require('./nav-telemetry');
    return readNavTelemetrySummary(projectDir);
  } catch (_) {
    try {
      return JSON.parse(readText(path.join(projectDir, '.claude', 'state', 'nav-telemetry-summary.json')));
    } catch (__) {
      return null;
    }
  }
}

// Latest iteration-log entry → coverage/baseline, blocked groups, attempt count,
// and whether the group exhausted its retries (FAIL attempt N of N).
function parseIterationLog(stateDir) {
  const blocks = readText(path.join(stateDir, 'iteration-log.md')).split(/^## Group /m).slice(1);
  const empty = { coverage: null, baseline: null, blockedGroups: [], attempt: 0, max: 3, failedOut: false };
  if (blocks.length === 0) return empty;
  const blockedGroups = blocks
    .filter((b) => /Status:\*\*\s*BLOCKED/.test(b))
    .map((b) => b.split(/[\s—\n]/)[0].trim())
    .filter(Boolean);
  const last = blocks[blocks.length - 1];
  const cov = last.match(/Coverage:\*\*\s*(\d+)%\s*\(baseline:\s*(\d+)%\)/);
  const fail = last.match(/FAIL \(attempt (\d+) of (\d+)\)/);
  return {
    coverage: cov ? parseInt(cov[1], 10) : null,
    baseline: cov ? parseInt(cov[2], 10) : null,
    blockedGroups,
    attempt: fail ? parseInt(fail[1], 10) : 0,
    max: fail ? parseInt(fail[2], 10) : 3,
    failedOut: fail ? fail[1] === fail[2] : false,
  };
}

module.exports = {
  readText,
  readMarker,
  readRunReceipts,
  findProjectDir,
  parseList,
  pct,
  readProgress,
  readFeatures,
  countGroupsFromGraph,
  readPlanConfidence,
  readBudget,
  readCostSummary,
  readNavigation,
  readContextCache,
  readTokenAdvisor,
  readNavTelemetry,
  parseIterationLog,
};
