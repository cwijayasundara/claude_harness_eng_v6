#!/usr/bin/env node

'use strict';

// Deterministic, hash-cached concept pages per directory cluster.
// No LLM required — structural prose from graph + wiki + optional .harness/wiki.json steering.
// Regenerates only when member content hashes change.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function loadSteering(projectDir) {
  const candidates = [
    path.join(projectDir, '.harness', 'wiki.json'),
    path.join(projectDir, 'project-manifest.json'),
  ];
  for (const c of candidates) {
    const j = readJson(c);
    if (!j) continue;
    if (c.endsWith('wiki.json')) return j;
    if (j.wiki_steering) return j.wiki_steering;
  }
  return { repo_notes: [], max_concept_pages: 20, priority_paths: [] };
}

function clusterIdForPath(p) {
  const parts = String(p || '').split('/').filter(Boolean);
  if (parts.length === 0) return 'root';
  if (parts[0] === 'src' || parts[0] === 'lib' || parts[0] === 'app' || parts[0] === 'packages') {
    return parts.slice(0, Math.min(3, parts.length)).join('/');
  }
  return parts.slice(0, 2).join('/');
}

function fileHash(projectDir, rel) {
  const abs = path.join(projectDir, rel);
  try {
    const buf = fs.readFileSync(abs);
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  } catch (_) {
    return null;
  }
}

function buildClusters(graph, steering) {
  const by = new Map();
  for (const f of graph.files || []) {
    const id = clusterIdForPath(f.path);
    if (!by.has(id)) by.set(id, { id, paths: [], symbols: [], fan_in_hint: 0 });
    const c = by.get(id);
    c.paths.push(f.path);
    for (const s of f.symbols || []) {
      if (s.name) c.symbols.push(s.name);
    }
  }
  // fan-in from hubs if present
  for (const h of (graph.metrics && graph.metrics.hubs) || []) {
    const p = (h.id || '').includes(':') ? h.id.split(':').slice(1).join(':') : (h.path || h.id);
    const id = clusterIdForPath(p);
    if (by.has(id)) by.get(id).fan_in_hint = Math.max(by.get(id).fan_in_hint, h.fan_in || 0);
  }

  let list = [...by.values()];
  const priority = new Set(steering.priority_paths || []);
  list.sort((a, b) => {
    const ap = [...priority].some((pref) => a.id.startsWith(pref) || a.paths.some((p) => p.startsWith(pref))) ? 1 : 0;
    const bp = [...priority].some((pref) => b.id.startsWith(pref) || b.paths.some((p) => p.startsWith(pref))) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    if (b.fan_in_hint !== a.fan_in_hint) return b.fan_in_hint - a.fan_in_hint;
    return b.paths.length - a.paths.length || a.id.localeCompare(b.id);
  });

  const maxPages = steering.max_concept_pages || 20;
  return list.slice(0, maxPages);
}

function renderConceptPage(cluster, hashes, steering, graph) {
  const notes = (steering.repo_notes || []).map((n) => n.content || n).filter(Boolean);
  const symbols = [...new Set(cluster.symbols)].slice(0, 24);
  const lines = [
    `# Concept: ${cluster.id}`,
    '',
    `> Deterministic concept page (hash-cached). Not LLM prose.`,
    '',
    '## Summary',
    '',
    `Cluster \`${cluster.id}\` groups **${cluster.paths.length}** file(s)`
      + (cluster.fan_in_hint ? ` (hub fan-in hint ${cluster.fan_in_hint})` : '')
      + '.',
    '',
    '## Files',
    '',
    ...cluster.paths.slice(0, 40).map((p) => `- \`${p}\` (hash ${hashes[p] || 'n/a'})`),
    '',
    '## Symbols',
    '',
    symbols.length ? symbols.map((s) => `- \`${s}\``).join('\n') : '_No symbols indexed._',
    '',
  ];
  if (notes.length) {
    lines.push('## Repo notes (steering)', '', ...notes.map((n) => `- ${n}`), '');
  }
  // Entry edges into cluster
  const pathSet = new Set(cluster.paths);
  const inbound = [];
  for (const e of graph.edges || []) {
    const from = String(e.source || e.from || '');
    const to = String(e.target || e.to || '');
    const toPath = to.includes(':') ? to.split(':').slice(1).join(':') : to;
    const fromPath = from.includes(':') ? from.split(':').slice(1).join(':') : from;
    if (pathSet.has(toPath) && !pathSet.has(fromPath)) {
      inbound.push(`${fromPath} → ${toPath} (${e.kind || e.type || 'edge'})`);
    }
  }
  if (inbound.length) {
    lines.push('## Inbound edges (sample)', '', ...inbound.slice(0, 15).map((x) => `- ${x}`), '');
  }
  lines.push(
    '## Citations',
    '',
    'Source of truth: `specs/brownfield/code-graph.json`. Prefer `/context` or `nav-query pack` for task-scoped reads.',
    '',
  );
  return lines.join('\n');
}

function buildConceptPages({ projectDir = process.cwd(), force = false } = {}) {
  const graphPath = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  const graph = readJson(graphPath);
  if (!graph || ((graph.files || []).length === 0 && (graph.nodes || []).length === 0)) {
    return { ok: false, reason: 'missing_or_empty_graph' };
  }
  const steering = loadSteering(projectDir);
  const clusters = buildClusters(graph, steering);
  const outDir = path.join(projectDir, 'specs', 'brownfield', 'wiki', 'concepts');
  fs.mkdirSync(outDir, { recursive: true });

  let written = 0;
  let skipped = 0;
  const index = [];

  for (const cluster of clusters) {
    const hashes = {};
    for (const p of cluster.paths) {
      const h = fileHash(projectDir, p);
      if (h) hashes[p] = h;
    }
    const sidecarPath = path.join(outDir, `${cluster.id.replace(/\//g, '__')}.meta.json`);
    const pageName = `${cluster.id.replace(/\//g, '__')}.md`;
    const pagePath = path.join(outDir, pageName);
    const prev = readJson(sidecarPath);
    const hashKey = Object.keys(hashes).sort().map((k) => `${k}:${hashes[k]}`).join('|');
    const contentHash = crypto.createHash('sha256').update(hashKey).digest('hex').slice(0, 16);

    if (!force && prev && prev.content_hash === contentHash && fs.existsSync(pagePath)) {
      skipped += 1;
      index.push({ id: cluster.id, page: `concepts/${pageName}`, stale: false });
      continue;
    }

    const md = renderConceptPage(cluster, hashes, steering, graph);
    fs.writeFileSync(pagePath, md);
    fs.writeFileSync(sidecarPath, `${JSON.stringify({
      cluster_id: cluster.id,
      member_paths: cluster.paths,
      content_hashes: hashes,
      content_hash: contentHash,
      generated_at: new Date().toISOString(),
      stale: false,
    }, null, 2)}\n`);
    written += 1;
    index.push({ id: cluster.id, page: `concepts/${pageName}`, stale: false });
  }

  // Index file
  const idxPath = path.join(outDir, 'INDEX.md');
  const notes = (steering.repo_notes || []).map((n) => n.content || n).filter(Boolean);
  fs.writeFileSync(idxPath, [
    '# Concept pages',
    '',
    'Hash-cached, deterministic cluster summaries. Regenerated when member file hashes change.',
    '',
    notes.length ? `## Repo notes\n\n${notes.map((n) => `- ${n}`).join('\n')}\n` : '',
    '## Pages',
    '',
    ...index.map((i) => `- [${i.id}](${path.basename(i.page)})`),
    '',
  ].join('\n'));

  return { ok: true, written, skipped, pages: index.length, outDir };
}

module.exports = { buildConceptPages, loadSteering, clusterIdForPath };

if (require.main === module) {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const projectDir = rootIdx === -1 ? process.cwd() : args[rootIdx + 1];
  const force = args.includes('--force');
  const result = buildConceptPages({ projectDir, force });
  if (!result.ok) {
    process.stderr.write(`nav-concepts: ${result.reason}\n`);
    process.exit(0);
  }
  process.stdout.write(`nav-concepts: wrote ${result.written}, skipped ${result.skipped}, total ${result.pages} → ${result.outDir}\n`);
}
