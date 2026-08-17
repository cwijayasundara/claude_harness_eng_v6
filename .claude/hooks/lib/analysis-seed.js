'use strict';

// Lean analysis seed — deterministic, no paraphrase of FR text.
//
// Lean /brd --prd no longer writes brd-analysis.json. This pack is the
// replacement at product grain: domain terms inferred from the adopted spine
// plus optional glossary / naming-cluster evidence, plus the PRD's own
// questions, risks, and safeguards copied verbatim.
//
// Status is evidence, not invention:
//   existing — term appears in naming-clusters.md (brownfield evidence)
//   glossary — term is a CONTEXT.md heading (defined, not necessarily coded)
//   unknown  — recurring in the spine, no code/glossary hit

const STOP = new Set([
  'this', 'that', 'with', 'from', 'when', 'then', 'given', 'must', 'will',
  'each', 'every', 'their', 'into', 'onto', 'only', 'also', 'have', 'been',
  'were', 'does', 'than', 'them', 'they', 'your', 'http', 'https', 'json',
  'true', 'false', 'null', 'where', 'what', 'which', 'while', 'after',
  'before', 'under', 'over', 'between', 'through', 'using', 'used', 'make',
  'made', 'able', 'such', 'same', 'other', 'shall', 'should',
]);

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function parseGlossaryTerms(markdown) {
  const lines = String(markdown == null ? '' : markdown).split(/\r?\n/);
  const terms = [];
  let inTerms = false;
  for (const line of lines) {
    if (/^##\s+Terms\s*$/i.test(line)) { inTerms = true; continue; }
    if (inTerms && /^##\s+/.test(line)) break;
    if (inTerms) {
      const m = line.match(/^###\s+(.+?)\s*$/);
      if (m) terms.push(m[1].trim());
    }
  }
  return terms;
}

// naming-clusters.md lines: `- **Account** — 3 symbol(s): ...`
function parseClusterTerms(markdown) {
  const terms = [];
  for (const line of String(markdown == null ? '' : markdown).split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+\*\*([^*]+)\*\*/);
    if (m) terms.push(m[1].trim());
  }
  return terms;
}

function contentWords(text) {
  return String(text || '').toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || [];
}

function frequentTerms(requirements, minDocs = 2) {
  const docFreq = new Map();
  for (const req of asArray(requirements)) {
    const unique = new Set(
      contentWords(req.text || req.label || '').filter((w) => !STOP.has(w)),
    );
    for (const w of unique) docFreq.set(w, (docFreq.get(w) || 0) + 1);
  }
  return [...docFreq.entries()]
    .filter(([, n]) => n >= minDocs)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word, count]) => ({ word, count }));
}

function titleCase(word) {
  return String(word).replace(/(^|[-_])([a-z])/g, (_, sep, c) => (sep === '-' ? '-' : '') + c.toUpperCase());
}

function lookupStatus(name, { clusterSet, glossarySet }) {
  const key = String(name).toLowerCase();
  if (clusterSet.has(key)) return 'existing';
  if (glossarySet.has(key)) return 'glossary';
  return 'unknown';
}

function evidenceFor(status, name, { clusterTerms, glossaryTerms }) {
  if (status === 'existing') {
    const hit = clusterTerms.find((t) => t.toLowerCase() === name.toLowerCase());
    return hit ? `naming-clusters.md:${hit}` : 'naming-clusters.md';
  }
  if (status === 'glossary') {
    const hit = glossaryTerms.find((t) => t.toLowerCase() === name.toLowerCase());
    return hit ? `CONTEXT.md:${hit}` : 'CONTEXT.md';
  }
  return 'requirement-frequency';
}

function isRiskClarification(c) {
  return /\brisk\b/i.test(`${(c && c.question) || ''} ${(c && c.answer) || ''}`);
}

function risksFromClarifications(clarifications) {
  return asArray(clarifications)
    .filter(isRiskClarification)
    .map((c) => ({
      id: c.id || null,
      text: [c.question, c.answer].filter(Boolean).join(' → '),
      source: 'clarification',
    }));
}

function buildAnalysisSeed({
  requirements = [],
  questions = [],
  risks = [],
  clarifications = [],
  safeguards = [],
  glossaryMarkdown = '',
  clustersMarkdown = '',
} = {}) {
  const glossaryTerms = parseGlossaryTerms(glossaryMarkdown);
  const clusterTerms = parseClusterTerms(clustersMarkdown);
  const glossarySet = new Set(glossaryTerms.map((t) => t.toLowerCase()));
  const clusterSet = new Set(clusterTerms.map((t) => t.toLowerCase()));
  const sets = { clusterSet, glossarySet, clusterTerms, glossaryTerms };

  const concepts = new Map();

  function addConcept(name, extraEvidence) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    const status = lookupStatus(trimmed, sets);
    const evidence = extraEvidence || evidenceFor(status, trimmed, sets);
    if (!concepts.has(key)) {
      concepts.set(key, { name: titleCase(trimmed), status, evidence });
      return;
    }
    const prev = concepts.get(key);
    const rank = { existing: 0, glossary: 1, unknown: 2 };
    if (rank[status] < rank[prev.status]) {
      concepts.set(key, { name: prev.name, status, evidence });
    }
  }

  for (const term of clusterTerms) addConcept(term);
  for (const term of glossaryTerms) addConcept(term);
  for (const { word } of frequentTerms(requirements)) addConcept(word);

  const reqTexts = asArray(requirements).map((r) => String(r.text || r.label || '').toLowerCase());
  const mentioned = [...concepts.values()].filter((c) => {
    const needle = c.name.toLowerCase();
    return reqTexts.some((t) => t.includes(needle));
  });

  // Prefer terms that actually appear in the spine; keep unused glossary/cluster
  // hits only when the spine is too thin to produce frequency terms.
  const domain_concepts = (mentioned.length ? mentioned : [...concepts.values()])
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    version: 1,
    kind: 'lean-analysis-seed',
    domain_concepts,
    open_questions: asArray(questions).map((q) => ({
      id: q.id || null,
      text: q.text || q.question || '',
    })),
    risks: [
      ...asArray(risks).map((r) => ({
        id: r.id || null,
        text: r.text || r.risk || '',
        source: r.source || 'prd',
      })),
      ...risksFromClarifications(clarifications),
    ],
    safeguards: asArray(safeguards).map((s) => ({
      id: s.id || null,
      kind: s.kind || null,
      text: s.text || '',
    })),
  };
}

module.exports = {
  parseGlossaryTerms,
  parseClusterTerms,
  frequentTerms,
  isRiskClarification,
  risksFromClarifications,
  buildAnalysisSeed,
};
