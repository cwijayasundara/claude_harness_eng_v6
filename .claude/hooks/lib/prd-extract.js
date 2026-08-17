'use strict';

// Deterministic PRD → frd-requirements.json spine.
//
// Section labels are load-bearing: brd-adopt.js routes by them, not by
// content. A postcondition labelled anything other than "<id> AC" is adopted
// as a REQUIREMENT. Keep this table in lockstep with brd-extract/SKILL.md.

const AC_LINE = /^-\s+\*\*((?:FR|NFR)-[\w.]+)\*\*\s+(?:→|->)\s+(.*)$/;
const REQ_LINE = /^-\s+\*\*((?:FR|NFR)-[\w.]+)\*\*\s+(.*)$/;
const BULLET = /^-\s+(.+)$/;
const LIST_SECTIONS = /Out of Scope|Non-?goals?|Risks|Open Questions|Milestones/i;
const ACCEPTANCE = /Acceptance/i;

/**
 * @param {string} markdown
 * @returns {Array<{id:string,text:string,section:string}>}
 */
function extractSpine(markdown) {
  const out = [];
  let section = null;

  const push = (text, sec) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    out.push({ id: `FRD-${out.length + 1}`, text: trimmed, section: sec });
  };

  for (const line of String(markdown || '').split('\n')) {
    const heading = line.match(/^#{2,}\s+(.*)$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    if (!section) continue;

    const ac = line.match(AC_LINE);
    if (ac && ACCEPTANCE.test(section)) {
      push(ac[2], `${section} / ${ac[1]} AC`);
      continue;
    }
    const req = line.match(REQ_LINE);
    if (req && !ACCEPTANCE.test(section)) {
      push(req[2], `${section} / ${req[1]}`);
      continue;
    }
    const bullet = line.match(BULLET);
    if (bullet && LIST_SECTIONS.test(section)) push(bullet[1], section);
  }
  return out;
}

function counts(spine) {
  const n = (re) => spine.filter((e) => re.test(e.section || '')).length;
  return {
    entries: spine.length,
    requirements: n(/\/\s*(?:FR|NFR)-/),
    acceptance: n(/\sAC\s*$/),
    forbidden: n(/Out of Scope|Non-?goals?/i),
    open_questions: n(/Open Questions/i),
    risks: n(/Risks/i),
    milestones: n(/Milestones/i),
  };
}

module.exports = { extractSpine, counts };
