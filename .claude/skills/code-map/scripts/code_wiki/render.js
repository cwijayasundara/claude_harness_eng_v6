'use strict';

// Render a navigable wiki from the model — deterministic, instant, always-current.
// WIKI.md (overview + index) links to bounded, cluster-shaped pages; every symbol
// with a known position carries a file:line citation so claims link to source.
// Graph strings (ids, symbol names, signatures, cycles) originate from scanned
// source and are untrusted — escape them so they cannot inject markdown headings
// or Mermaid directives into artifacts that downstream agents read.

const path = require('path');

const MAX_NODES = 80;   // per page
const MAX_EDGES = 80;   // per cluster diagram
const MAX_SYMBOLS = 60; // per module

// Neutralize markdown structure: newlines (forged headings) and backticks (code-span breakout).
function escMd(s) {
  return String(s).replace(/[\r\n]+/g, ' ').replace(/`/g, "'");
}

// Table cells additionally must not contain an unescaped pipe.
function escCell(s) {
  return escMd(s).replace(/\|/g, '\\|');
}

// Mermaid labels must not contain quotes, brackets, braces, pipes, angle brackets, or newlines.
function escMer(s) {
  return String(s).replace(/[\r\n]+/g, ' ').replace(/["[\]{}|<>]/g, '').slice(0, 80);
}

function safeId(raw) {
  return 'n_' + String(raw).replace(/[^A-Za-z0-9]/g, '_');
}

function pageName(key, index) {
  const base = String(key).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${String(index + 1).padStart(2, '0')}-${base || 'root'}.md`;
}

function symbolLines(node) {
  if (!node.symbols.length) return ['  _(no extracted symbols)_'];
  return node.symbols.slice(0, MAX_SYMBOLS).map((s) => {
    const cite = s.line != null ? ` → ${escMd(node.id)}:${s.line}` : ` → ${escMd(node.id)}`;
    const sig = s.signature ? ` — \`${escMd(s.signature)}\`` : '';
    return `  - \`${escMd(s.name)}\` (${escMd(s.kind || 'symbol')})${cite}${sig}`;
  });
}

// Mermaid of edges whose both ends are inside this (already node-capped) cluster set.
function clusterMermaid(model, idSet) {
  const lines = ['```mermaid', 'flowchart LR'];
  for (const id of idSet) lines.push(`  ${safeId(id)}["${escMer(path.basename(String(id)))}"]`);
  let shown = 0; let total = 0;
  for (const e of model.edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
    total++;
    if (shown < MAX_EDGES) { lines.push(`  ${safeId(e.from)} -->|${escMer(e.type)}| ${safeId(e.to)}`); shown++; }
  }
  if (total > shown) lines.push(`  %% +${total - shown} more edge(s)`);
  lines.push('```');
  return total || idSet.size > 1 ? lines.join('\n') : '_(single module, no internal edges)_';
}

function moduleSection(model, id) {
  const n = model.byId.get(id);
  return [`## \`${escMd(id)}\``, '', `- fan-in: ${model.fanIn.get(id) || 0}, fan-out: ${model.fanOut.get(id) || 0}`, '', '### Symbols', ...symbolLines(n), ''];
}

function clusterPage(model, clusterIds, title) {
  const shownIds = clusterIds.slice(0, MAX_NODES);
  const idSet = new Set(shownIds);
  const out = [`# ${title}`, '', `${clusterIds.length} module(s).`, '', '## Dependencies', '', clusterMermaid(model, idSet), ''];
  for (const id of shownIds) out.push(...moduleSection(model, id));
  if (clusterIds.length > shownIds.length) out.push(`_+ ${clusterIds.length - shownIds.length} more module(s) not shown (page capped at ${MAX_NODES})._`, '');
  return out.join('\n');
}

function hubsTable(model) {
  if (!model.hubs.length) return '_(no hubs)_';
  return ['| Module | fan-in | fan-out |', '|---|---|---|', ...model.hubs.map((h) => `| \`${escCell(h.id)}\` | ${h.fanIn} | ${h.fanOut} |`)].join('\n');
}

function listSection(title, items, fmt) {
  if (!items.length) return `### ${title}\n\n_(none)_`;
  return `### ${title}\n\n` + items.slice(0, 25).map(fmt).join('\n');
}

function depLabel(d) {
  return typeof d === 'string' ? d : (d.name || d.id || d.module || JSON.stringify(d));
}

function overviewPage(model, pages, extras = {}) {
  const idx = pages.map((p) => `- [${p.title}](pages/${p.name}) — ${p.ids.length} module(s)`).join('\n');
  const conceptBlock = extras.conceptIndex
    ? ['## Concept pages', '', extras.conceptIndex, '']
    : [];
  return [
    '# Codebase Wiki', '',
    '> Deterministic, always-current map rendered from `code-graph.json`. No LLM — re-rendered on graph change.', '',
    `- Producer: \`${escMd(model.producer)}\`  ·  Language: \`${escMd(model.language || 'mixed')}\``,
    `- Modules: ${model.nodes.length}  ·  Edges: ${model.edges.length}  ·  Clusters: ${model.clusters.length}`, '',
    '## Hubs (most-depended-on)', '', hubsTable(model), '',
    listSection('Entry points (no inbound deps)', model.entrypoints, (id) => `- \`${escMd(id)}\``), '',
    listSection('Cycles', model.cycles, (c) => `- ${(Array.isArray(c) ? c : [c]).map(escMd).join(' → ')}`), '',
    listSection('External dependencies', model.externalDeps, (d) => `- \`${escMd(depLabel(d))}\``), '',
    ...conceptBlock,
    '## Pages', '', idx || '_(none)_', '',
    '## Agent navigation', '',
    '- Context pack: `node .claude/scripts/nav-query.js pack --budget 1600 "<question>"`',
    '- Refresh secondary indexes: `node .claude/scripts/nav-query.js refresh`',
    '',
  ].join('\n');
}

function loadConceptIndexMd(wikiOutDir) {
  // Prefer concepts/INDEX.md if present beside the wiki out dir
  try {
    const fs = require('fs');
    const idx = path.join(wikiOutDir || '', 'concepts', 'INDEX.md');
    if (fs.existsSync(idx)) {
      const text = fs.readFileSync(idx, 'utf8');
      const links = [...text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)]
        .slice(0, 30)
        .map((m) => `- [${m[1]}](concepts/${path.basename(m[2])})`);
      if (links.length) return links.join('\n') + '\n\n_(Hash-cached concept pages from `nav-concepts.js`.)_';
      return 'See [concepts/INDEX.md](concepts/INDEX.md).';
    }
  } catch (_) { /* optional */ }
  return null;
}

function renderWiki(model, { maxPages = 20, outDir = null } = {}) {
  const capped = model.clusters.slice(0, maxPages);
  const pages = capped.map((c, i) => ({ name: pageName(c.key, i), ids: c.ids, title: `\`${escMd(c.key)}/\` — ${c.ids.length} module(s)` }));
  const overflow = model.clusters.length - capped.length;
  const conceptIndex = loadConceptIndexMd(outDir);
  const index = overviewPage(model, pages, { conceptIndex })
    + (overflow > 0 ? `\n_+ ${overflow} smaller cluster(s) not paged (raise --max-pages)._\n` : '');
  return {
    index: { name: 'WIKI.md', md: index },
    pages: pages.map((p) => ({ name: p.name, md: clusterPage(model, p.ids, p.title) })),
  };
}

module.exports = { renderWiki, overviewPage, clusterPage, clusterMermaid, safeId, escMd, escMer };
