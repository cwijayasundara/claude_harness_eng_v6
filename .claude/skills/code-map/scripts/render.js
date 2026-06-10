'use strict';

const path = require('path');

const SAFE_ID_RE = /[^A-Za-z0-9_]/g;

function safeMermaidId(raw) {
  return raw.replace(SAFE_ID_RE, '_') || 'n';
}

function computeFanIn(edges) {
  const fanIn = new Map();
  for (const e of edges) {
    if (e.target.startsWith('ext:') || e.target.startsWith('sym:')) continue;
    fanIn.set(e.target, (fanIn.get(e.target) || 0) + 1);
  }
  return fanIn;
}

function selectNodes(graph, maxNodes) {
  if (graph.nodes.length <= maxNodes) {
    return { nodes: graph.nodes, keepIds: new Set(graph.nodes.map((n) => n.id)) };
  }
  const fanIn = computeFanIn(graph.edges);
  const ranked = [...graph.nodes].sort((a, b) =>
    (fanIn.get(b.id) || 0) - (fanIn.get(a.id) || 0)
  ).slice(0, maxNodes);
  const keepIds = new Set(ranked.map((n) => n.id));
  return { nodes: graph.nodes.filter((n) => keepIds.has(n.id)), keepIds };
}

function edgeLines(edges, keepIds) {
  const lines = [];
  const seen = new Set();
  for (const e of edges) {
    if (!keepIds.has(e.source) || !keepIds.has(e.target)) continue;
    const key = `${e.source}|${e.target}|${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`    ${safeMermaidId(e.source)} -->|${e.kind}| ${safeMermaidId(e.target)}`);
  }
  return lines;
}

function renderMermaid(graph, maxNodes = 80) {
  const { nodes, keepIds } = selectNodes(graph, maxNodes);
  const lines = ['# Dependency Graph', '', '```mermaid', 'flowchart LR'];
  for (const n of nodes) {
    lines.push(`    ${safeMermaidId(n.id)}["${path.basename(n.path)}"]`);
  }
  lines.push(...edgeLines(graph.edges, keepIds));
  lines.push('```');
  if (graph.nodes.length > maxNodes) {
    lines.push('');
    lines.push(
      `_Graph rendered with top ${maxNodes} hubs by fan-in. ` +
      `Full graph: \`code-graph.json\` (${graph.nodes.length} nodes, ` +
      `${graph.metrics.edges} internal edges)._`
    );
  }
  return lines.join('\n') + '\n';
}

function hubsSection(m) {
  const lines = [
    '## Top hubs (by fan-in)', '',
    '| File | Fan-in | Fan-out | Instability |',
    '|---|---:|---:|---:|',
  ];
  for (const h of m.hubs.slice(0, 10)) {
    const p = h.id.split(':').slice(1).join(':');
    lines.push(`| \`${p}\` | ${h.fan_in} | ${h.fan_out} | ${h.instability} |`);
  }
  lines.push('');
  return lines;
}

function cyclesSection(m) {
  if (!m.cycles.length) return [];
  const lines = ['## Cycles', ''];
  m.cycles.forEach((cycle, i) => {
    const paths = cycle.map((c) => c.split(':').slice(1).join(':'));
    lines.push(`${i + 1}. ` + paths.map((p) => `\`${p}\``).join(' ↔ '));
  });
  lines.push('');
  return lines;
}

function unstableSection(m) {
  const unstable = m.hubs.filter((h) => h.fan_in >= 5 && h.instability >= 0.8);
  if (!unstable.length) return [];
  const lines = ['## Unstable hubs (fan_in ≥ 5, instability ≥ 0.8)', ''];
  for (const h of unstable) {
    const p = h.id.split(':').slice(1).join(':');
    lines.push(`- \`${p}\` (fan_in=${h.fan_in}, fan_out=${h.fan_out})`);
  }
  lines.push('');
  return lines;
}

function findOrphans(graph) {
  const inbound = new Set();
  for (const e of graph.edges) {
    if (e.target.startsWith('ext:') || e.target.startsWith('sym:')) continue;
    if (e.import_kind === 'type') continue;
    inbound.add(e.target);
  }
  return graph.nodes.filter((n) => !inbound.has(n.id)).map((n) => n.path).sort();
}

function orphansSection(graph) {
  const orphans = findOrphans(graph);
  if (!orphans.length) return [];
  const lines = [
    '## Dead-code candidates (no inbound edges)', '',
    '_Verify dynamic references (`getattr`, registries, entry points) before deleting._', '',
  ];
  for (const p of orphans.slice(0, 20)) lines.push(`- \`${p}\``);
  if (orphans.length > 20) lines.push(`- … ${orphans.length - 20} more`);
  lines.push('');
  return lines;
}

function renderCouplingReport(graph) {
  const m = graph.metrics;
  const lines = ['# Coupling Report', ''];
  lines.push(`- Files: **${m.files}**`);
  lines.push(`- Internal edges: **${m.edges}**`);
  lines.push(`- External imports: **${m.external_imports}**`);
  lines.push(`- Cycles: **${m.cycles.length}**`);
  lines.push('');
  lines.push(...hubsSection(m));
  lines.push(...cyclesSection(m));
  lines.push(...unstableSection(m));
  lines.push(...orphansSection(graph));
  return lines.join('\n') + '\n';
}

module.exports = { renderMermaid, renderCouplingReport };
