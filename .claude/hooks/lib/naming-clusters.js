'use strict';

// Deterministic evidence for brownfield's Step 6 domain glossary: clusters
// recurring root nouns across symbol names so the LLM confirms candidate
// domain terms into CONTEXT.md instead of inventing them from an open-ended
// source read. Mirrors modularity-pack.js's split: this module extracts
// evidence, the brownfield skill's LLM pass judges it against the source.

const ROLE_SUFFIX_RE = /(Controller|Service|Repository|Repo|Handler|Manager|Provider|Factory|Client|Adapter|Dto|DTO|Model|Entity|Schema|Serializer|Validator|Resolver|Middleware)$/;

function stripRoleSuffix(symbol) {
  return String(symbol).replace(ROLE_SUFFIX_RE, '');
}

function isCandidateRoot(root) {
  return typeof root === 'string' && root.length > 1 && /^[A-Z][a-zA-Z0-9]*$/.test(root);
}

// Returns [{ term, count, evidence: [{ symbol, path }] }], sorted by count desc.
function clusterNamingEvidence(graph, { minCount = 2 } = {}) {
  const nodes = Array.isArray(graph && graph.nodes) ? graph.nodes : [];
  const clusters = new Map();
  for (const node of nodes) {
    const symbols = Array.isArray(node.symbols) ? node.symbols : [];
    for (const symbol of symbols) {
      const root = stripRoleSuffix(symbol);
      if (!isCandidateRoot(root)) continue;
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push({ symbol, path: node.path || node.id });
    }
  }
  return [...clusters.entries()]
    .map(([term, evidence]) => ({ term, count: evidence.length, evidence }))
    .filter((c) => c.count >= minCount)
    .sort((a, b) => b.count - a.count);
}

function renderCandidates(clusters) {
  if (!clusters.length) return 'No recurring domain-term clusters found (each root noun appears in fewer than 2 symbols).';
  const lines = ['Candidate domain terms (root noun appears across multiple symbols):', ''];
  for (const c of clusters) {
    const examples = c.evidence.slice(0, 5).map((e) => `\`${e.symbol}\` (${e.path})`).join(', ');
    lines.push(`- **${c.term}** — ${c.count} symbol(s): ${examples}`);
  }
  return lines.join('\n');
}

module.exports = { stripRoleSuffix, isCandidateRoot, clusterNamingEvidence, renderCandidates };
