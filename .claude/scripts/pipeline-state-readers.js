'use strict';

// Read-only accessors over the state files the harness already writes. No file
// here is ever mutated. Shared by pipeline-snapshot.js and pipeline-status.js.

const fs = require('fs');
const path = require('path');

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

function readPendingReviews(stateDir) {
  return readText(path.join(stateDir, 'pending-reviews.jsonl'))
    .split('\n')
    .filter((l) => l.trim())
    .length;
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
  readPendingReviews,
  parseIterationLog,
};
