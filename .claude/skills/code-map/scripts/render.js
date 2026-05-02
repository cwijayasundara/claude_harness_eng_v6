'use strict';

const path = require('path');

const SAFE_ID_RE = /[^A-Za-z0-9_]/g;

function safeMermaidId(raw) {
  return raw.replace(SAFE_ID_RE, '_') || 'n';
}

function renderMermaid(graph, maxNodes = 80) {
  let nodes = graph.nodes;
  const edges = graph.edges;

  const fanIn = new Map();
  for (const e of edges) {
    if (e.target.startsWith('ext:') || e.target.startsWith('sym:')) continue;
    fanIn.set(e.target, (fanIn.get(e.target) || 0) + 1);
  }

  let keepIds;
  if (nodes.length > maxNodes) {
    const ranked = [...nodes].sort((a, b) =>
      (fanIn.get(b.id) || 0) - (fanIn.get(a.id) || 0)
    ).slice(0, maxNodes);
    keepIds = new Set(ranked.map((n) => n.id));
    nodes = nodes.filter((n) => keepIds.has(n.id));
  } else {
    keepIds = new Set(nodes.map((n) => n.id));
  }

  const lines = ['# Dependency Graph', '', '```mermaid', 'flowchart LR'];
  for (const n of nodes) {
    lines.push(`    ${safeMermaidId(n.id)}["${path.basename(n.path)}"]`);
  }

  const seen = new Set();
  for (const e of edges) {
    if (!keepIds.has(e.source) || !keepIds.has(e.target)) continue;
    const key = `${e.source}|${e.target}|${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`    ${safeMermaidId(e.source)} -->|${e.kind}| ${safeMermaidId(e.target)}`);
  }
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

function renderCouplingReport(graph) {
  const m = graph.metrics;
  const lines = ['# Coupling Report', ''];
  lines.push(`- Files: **${m.files}**`);
  lines.push(`- Internal edges: **${m.edges}**`);
  lines.push(`- External imports: **${m.external_imports}**`);
  lines.push(`- Cycles: **${m.cycles.length}**`);
  lines.push('');

  lines.push('## Top hubs (by fan-in)');
  lines.push('');
  lines.push('| File | Fan-in | Fan-out | Instability |');
  lines.push('|---|---:|---:|---:|');
  for (const h of m.hubs.slice(0, 10)) {
    const p = h.id.split(':').slice(1).join(':');
    lines.push(`| \`${p}\` | ${h.fan_in} | ${h.fan_out} | ${h.instability} |`);
  }
  lines.push('');

  if (m.cycles.length) {
    lines.push('## Cycles');
    lines.push('');
    m.cycles.forEach((cycle, i) => {
      const paths = cycle.map((c) => c.split(':').slice(1).join(':'));
      lines.push(`${i + 1}. ` + paths.map((p) => `\`${p}\``).join(' ↔ '));
    });
    lines.push('');
  }

  const unstable = m.hubs.filter((h) => h.fan_in >= 5 && h.instability >= 0.8);
  if (unstable.length) {
    lines.push('## Unstable hubs (fan_in ≥ 5, instability ≥ 0.8)');
    lines.push('');
    for (const h of unstable) {
      const p = h.id.split(':').slice(1).join(':');
      lines.push(`- \`${p}\` (fan_in=${h.fan_in}, fan_out=${h.fan_out})`);
    }
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

module.exports = { renderMermaid, renderCouplingReport };
