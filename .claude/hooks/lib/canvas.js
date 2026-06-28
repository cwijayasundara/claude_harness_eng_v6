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
};
