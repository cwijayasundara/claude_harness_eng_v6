'use strict';

// Pure logic for the inferential modularity review (gap G6). The sensors article
// found that handing an LLM raw coupling data makes it flag intentional patterns
// (factories, shared schemas) as "god modules" and waste tokens free-scanning.
// So we GROUND the review: build an evidence pack from the deterministic
// code-graph — hubs (pre-classified legitimate vs suspicious), cycles, and
// duplication candidates — that the modularity-reviewer agent judges against the
// source. Everything here is pure and testable; the judgment is the agent's.

// Names that are legitimately high-fan-in by design — not god modules.
const LEGIT_RE = /(^|[/_.-])(factory|factories|schema|schemas|type|types|registry|index|barrel|config|constants?|interface|interfaces|model|models|dto|dtos|enum|enums|util|utils|helper|helpers|common|shared)([/_.\- ]|$)/i;

function isLikelyLegitHub(pathOrId) {
  return LEGIT_RE.test(String(pathOrId));
}

function pathIndex(graph) {
  return new Map((graph.nodes || []).map((n) => [n.id, n.path || n.id]));
}

// Modules many things depend on. fan_in >= 5; flagged unstable when also highly
// efferent (instability >= 0.8), and pre-classified likelyLegit by name.
function hubEvidence(graph) {
  const byId = pathIndex(graph);
  const hubs = (graph.metrics && graph.metrics.hubs) || [];
  return hubs.filter((h) => h.fan_in >= 5).map((h) => ({
    id: h.id,
    path: byId.get(h.id) || h.id,
    fan_in: h.fan_in,
    fan_out: h.fan_out,
    instability: h.instability,
    unstable: h.fan_in >= 5 && h.instability >= 0.8,
    likelyLegit: isLikelyLegitHub(byId.get(h.id) || h.id),
  }));
}

function cycleList(graph) {
  return ((graph.metrics && graph.metrics.cycles) || []).map((c) => [...c].sort());
}

function outNeighbors(graph) {
  const m = new Map();
  for (const e of graph.edges || []) {
    const t = String(e.target);
    if (t.startsWith('ext:') || t.startsWith('sym:')) continue;
    if (!m.has(e.source)) m.set(e.source, new Set());
    m.get(e.source).add(e.target);
  }
  return m;
}

// Files importing an identical (>=2) set of internal modules — a heuristic for
// near-duplicate implementations (e.g. several endpoints doing the same thing).
// The agent confirms or dismisses; this only narrows where to look.
function duplicationCandidates(graph) {
  const byId = pathIndex(graph);
  const groups = new Map();
  for (const [src, targets] of outNeighbors(graph)) {
    if (targets.size < 2) continue;
    const key = [...targets].sort().join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(byId.get(src) || src);
  }
  return [...groups.values()].filter((g) => g.length >= 2).map((g) => g.sort());
}

function buildPack(graph) {
  return {
    hubs: hubEvidence(graph),
    cycles: cycleList(graph),
    duplicationCandidates: duplicationCandidates(graph),
  };
}

function hubLine(h) {
  const tag = h.likelyLegit ? 'likely-legitimate (name suggests factory/schema/util)' : 'review for misplaced responsibility';
  return `- \`${h.path}\` — fan-in ${h.fan_in}, instability ${h.instability}${h.unstable ? ' (unstable)' : ''} — ${tag}`;
}

function renderBrief(pack) {
  const lines = ['# Modularity review pack', '',
    'Deterministic evidence from the code-graph. Judge each against the source; ',
    'do not flag a `likely-legitimate` hub as a god module without a concrete reason.', '',
    `## Hubs (${pack.hubs.length})`, ...pack.hubs.map(hubLine), '',
    `## Import cycles (${pack.cycles.length})`, ...pack.cycles.map((c) => `- ${c.join(' -> ')}`), '',
    `## Duplication candidates (${pack.duplicationCandidates.length})`,
    ...pack.duplicationCandidates.map((g) => `- same imports: ${g.map((p) => `\`${p}\``).join(', ')}`), ''];
  return lines.join('\n');
}

module.exports = {
  isLikelyLegitHub, hubEvidence, cycleList, duplicationCandidates, buildPack, renderBrief,
};
