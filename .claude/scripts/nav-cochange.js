#!/usr/bin/env node

'use strict';

// Deterministic co-change edges from git history. Files that frequently commit
// together get a cochange score used by context-pack ranking / expansion.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT_REL = path.join('specs', 'brownfield', 'co-change.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function isSourcePath(p) {
  if (!p || p.includes('node_modules') || p.startsWith('.')) return false;
  return /\.(py|js|jsx|ts|tsx|go|java|cs|rb|rs|php|kt|swift|vue|svelte)$/i.test(p)
    || /^(src|lib|app|backend|frontend|server|packages|services)\//.test(p);
}

function pairKey(a, b) {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

function buildCochange({
  projectDir = process.cwd(),
  months = 6,
  maxCommits = 400,
  minCount = 2,
  topPerFile = 12,
} = {}) {
  let log = '';
  try {
    // Name-only log: blank line separates commits
    log = execFileSync(
      'git',
      ['log', `--since=${months} months ago`, '-n', String(maxCommits), '--name-only', '--pretty=format:---'],
      { cwd: projectDir, encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024 },
    );
  } catch (err) {
    return {
      ok: false,
      reason: 'git_unavailable',
      message: err.message,
      path: path.join(projectDir, OUT_REL),
    };
  }

  const pairCount = new Map();
  const fileCount = new Map();
  let commits = 0;

  for (const block of log.split(/^---$/m)) {
    const files = [...new Set(
      block.split('\n').map((l) => l.trim()).filter((l) => l && isSourcePath(l)),
    )];
    if (files.length < 2 || files.length > 40) continue;
    commits += 1;
    for (const f of files) fileCount.set(f, (fileCount.get(f) || 0) + 1);
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const k = pairKey(files[i], files[j]);
        pairCount.set(k, (pairCount.get(k) || 0) + 1);
      }
    }
  }

  const neighbors = new Map(); // path -> [{path, count}]
  for (const [k, count] of pairCount) {
    if (count < minCount) continue;
    const [a, b] = k.split('\0');
    if (!neighbors.has(a)) neighbors.set(a, []);
    if (!neighbors.has(b)) neighbors.set(b, []);
    neighbors.get(a).push({ path: b, count });
    neighbors.get(b).push({ path: a, count });
  }
  for (const [f, list] of neighbors) {
    list.sort((x, y) => y.count - x.count || x.path.localeCompare(y.path));
    neighbors.set(f, list.slice(0, topPerFile));
  }

  const edges = [];
  for (const [k, count] of pairCount) {
    if (count < minCount) continue;
    const [a, b] = k.split('\0');
    edges.push({ source: a, target: b, kind: 'cochange', count });
  }
  edges.sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  const out = {
    schema_version: 1,
    built_at: new Date().toISOString(),
    months,
    commits_scanned: commits,
    file_count: fileCount.size,
    edge_count: edges.length,
    neighbors: Object.fromEntries(neighbors),
    // keep top edges only for size
    edges: edges.slice(0, 5000),
    hotspots: [...fileCount.entries()]
      .map(([p, c]) => ({ path: p, commits: c }))
      .sort((a, b) => b.commits - a.commits)
      .slice(0, 50),
  };

  const outPath = path.join(projectDir, OUT_REL);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  return { ok: true, path: outPath, edge_count: edges.length, commits };
}

function loadCochange(projectDir) {
  return readJson(path.join(projectDir, OUT_REL));
}

function cochangeNeighbors(projectDir, filePath, { minCount = 2, limit = 8 } = {}) {
  const data = loadCochange(projectDir);
  if (!data || !data.neighbors) return [];
  const list = data.neighbors[filePath] || [];
  return list.filter((n) => n.count >= minCount).slice(0, limit);
}

module.exports = {
  buildCochange,
  loadCochange,
  cochangeNeighbors,
  OUT_REL,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const projectDir = rootIdx === -1 ? process.cwd() : args[rootIdx + 1];
  const monthsIdx = args.indexOf('--months');
  const months = monthsIdx === -1 ? 6 : parseInt(args[monthsIdx + 1], 10) || 6;
  const result = buildCochange({ projectDir, months });
  if (!result.ok) {
    process.stderr.write(`nav-cochange: ${result.reason}\n`);
    process.exit(0);
  }
  process.stdout.write(`nav-cochange: ${result.edge_count} edges from ${result.commits} commits → ${result.path}\n`);
}
