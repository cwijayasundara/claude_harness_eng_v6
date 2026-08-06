'use strict';

// The PRD's milestone plan, made machine-readable (R4, link 1).
//
// /prd produces a Milestones section and /spec never read it, so the milestone
// scope decision — which epics get decomposed to story depth now and which stay
// at epic granularity — was re-derived by hand from memory each time. That
// decision is the biggest single control on how much the pipeline generates: a
// real run expanded 16 epics to story depth against a plan-confidence of 0.
//
// Shared with validate-prd.js so the two cannot disagree about what a milestone
// is. Pure: takes markdown, returns a plan.

// A milestone is declared by a bullet or a table row, never by prose. Ids are
// M1.. or P0.. depending on the document; the audited PRD uses P0-P6.
const MILESTONE = /^\s*(?:-|\|)\s*\**([MP]\d+[^*|]*)\**\s*[|]?(.*)$/;
const REQUIREMENT_REF = /\b((?:FR|NFR)-[\w.]*\d[\w.]*)\b/g;
const OBSERVABLE_DONE = /done when:\s*(.+)$/i;
const VAGUE_DONE = /^(it works|works correctly|is done|complete|finished)\.?$/i;
const MILESTONES_HEADING = /^#{2,}\s*\d*\.?\s*Milestones/im;

// "Done when: …" when labelled; otherwise the last table cell, which is where a
// table-shaped plan puts its exit criteria.
function doneWhen(rest) {
  const labelled = rest.match(OBSERVABLE_DONE);
  if (labelled) return labelled[1].trim();
  const cells = rest.split('|').map((c) => c.trim()).filter(Boolean);
  return cells.length ? cells[cells.length - 1] : '';
}

/**
 * @param {string} text PRD markdown
 * @returns {Array<{id, name, requirements: string[], done_when: string, observable: boolean}>}
 *   in document order — this is the build sequence, not a set.
 */
function parseMilestones(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const match = line.match(MILESTONE);
    if (!match) continue;
    const [, rawName, rest] = match;
    const name = rawName.trim();
    const done = doneWhen(rest);
    out.push({
      id: name.split(/\s|—/)[0],
      name,
      // Requirement ids named anywhere on the row — the whole row, since a table
      // puts them in a scope cell and a bullet in the parenthetical.
      requirements: [...new Set(`${name} ${rest}`.match(REQUIREMENT_REF) || [])],
      done_when: done,
      observable: Boolean(done) && !VAGUE_DONE.test(done),
    });
  }
  return out;
}

/** True when the document promises milestones but none parsed — a silent skip. */
function milestonesUnparsed(text, plan) {
  return plan.length === 0 && MILESTONES_HEADING.test(String(text || ''));
}

module.exports = { parseMilestones, milestonesUnparsed, MILESTONE, VAGUE_DONE, OBSERVABLE_DONE };
