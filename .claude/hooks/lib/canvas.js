'use strict';

// Pure logic for the SPDD REASONS Canvas (gap G4). The Canvas is /design's
// narrative spine — Requirements, Entities, Approach, Structure, Operations,
// Norms, Safeguards — plus a machine-readable `Governs` list of the source paths
// it designs. The Governs list is what makes Canvas<->code drift deterministic:
// a governed path that no longer exists means the design references vanished
// code (the drift monitor surfaces it; see lib/drift + drift-report).

const REQUIRED_SECTIONS = [
  'Requirements', 'Entities', 'Approach', 'Structure', 'Operations', 'Norms', 'Safeguards', 'Governs',
];

function sectionTitles(md) {
  const titles = [];
  for (const line of String(md).split('\n')) {
    const m = line.match(/^##\s+([A-Za-z][\w /&()-]*?)\s*$/);
    if (m) titles.push(m[1].trim());
  }
  return titles;
}

// A required section is satisfied by an exact heading or one that starts with it
// (so "Entities (domain model)" still counts as Entities).
function missingSections(md) {
  const titles = sectionTitles(md);
  return REQUIRED_SECTIONS.filter((req) => !titles.some((t) => t === req || t.startsWith(req)));
}

function sectionBody(md, title) {
  const lines = String(md).split('\n');
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${title}\\b`).test(l));
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n');
}

// Pull repo-relative paths from the `## Governs` bullet list (backtick-optional).
function extractGoverns(md) {
  return sectionBody(md, 'Governs')
    .split('\n')
    .map((l) => l.match(/^\s*[-*]\s+`?([^`\s][^`]*?)`?\s*$/))
    .filter(Boolean)
    .map((m) => m[1].trim());
}

// Concrete governed paths (not globs) that no longer exist on disk. `exists` is
// injected so this stays pure and testable.
function canvasMissingPaths(governs, exists) {
  return (governs || []).filter((p) => !p.includes('*') && !exists(p));
}

// --- safeguard coverage (D9) --------------------------------------------------
//
// /brd records invariants, prohibitions, limits and norms as SG-n entries. The
// Canvas has Safeguards and Norms sections, but they were authored from the
// architecture with nothing tying them back — so a business invariant could
// quietly fail to reach the design contract. This closes that link by id.
//
// `norm` belongs in Norms; invariant/prohibition/limit belong in Safeguards.
// A citation in the other section still counts (the constraint did reach the
// design) but is reported as misplaced — that is an editorial issue, not a
// missing constraint, and conflating the two would train people to ignore it.

const SG_SECTIONS = ['Safeguards', 'Norms'];

function expectedSection(kind) {
  return kind === 'norm' ? 'Norms' : 'Safeguards';
}

// SG id -> the set of Canvas sections citing it. Only Safeguards and Norms are
// read: a mention in Approach or Requirements is prose, not a design commitment.
function citedIds(md) {
  const cited = new Map();
  for (const section of SG_SECTIONS) {
    for (const m of sectionBody(md, section).matchAll(/\bSG-\d+\b/g)) {
      if (!cited.has(m[0])) cited.set(m[0], new Set());
      cited.get(m[0]).add(section);
    }
  }
  return cited;
}

function classifyCoverage(spine, cited) {
  const uncovered = [];
  const misplaced = [];
  for (const sg of spine) {
    const sections = cited.get(sg.id);
    if (!sections) {
      uncovered.push({ id: sg.id, kind: sg.kind, text: sg.text || '' });
    } else if (!sections.has(expectedSection(sg.kind))) {
      misplaced.push({
        id: sg.id,
        note: `a ${sg.kind} belongs under ## ${expectedSection(sg.kind)}, but it is cited under `
          + `## ${[...sections].sort().join(', ')}`,
      });
    }
  }
  return { uncovered, misplaced };
}

function checkSafeguardCoverage(md, safeguards) {
  const spine = (Array.isArray(safeguards) ? safeguards : []).slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cited = citedIds(md);
  const { uncovered, misplaced } = classifyCoverage(spine, cited);
  const known = new Set(spine.map((s) => s.id));
  const cited_unknown = [...cited.keys()].filter((id) => !known.has(id)).sort();

  const verdict = {
    pass: uncovered.length === 0 && cited_unknown.length === 0,
    required_total: spine.length,
    covered: spine.length - uncovered.length,
    uncovered,
    misplaced,
    cited_unknown,
  };
  // A Canvas checked against no safeguards proves nothing about the design.
  if (spine.length === 0) return { ...verdict, pass: false, reason: 'empty_spine' };
  return verdict;
}

// Structure check used by the validate-canvas gate (sections present + a
// non-empty Governs list, which drift detection depends on).
function validateCanvas(md) {
  const missing = missingSections(md);
  const governs = extractGoverns(md);
  const errors = [];
  if (missing.length) errors.push(`missing REASONS sections: ${missing.join(', ')}`);
  if (governs.length === 0) errors.push('Governs lists no source paths (Canvas<->code drift detection needs them)');
  return { errors, governs };
}

module.exports = {
  REQUIRED_SECTIONS, sectionTitles, missingSections, sectionBody,
  extractGoverns, canvasMissingPaths, validateCanvas,
  checkSafeguardCoverage, SG_SECTIONS,
};
