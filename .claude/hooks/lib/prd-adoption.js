'use strict';

// PRD adoption — the pure classification and adoption core.
//
// Extracted from brd-adopt.js, which is now the CLI around it: load the spine,
// write the outputs, report. This half decides what each source entry IS
// (requirement, safeguard, acceptance criterion, narrative) and produces the
// adopted records; it touches no filesystem and no argv.

const path = require('path');

// A PRD's "Out of Scope" section is a deny-list, not a backlog. Its entries
// become Forbidden Actions, which the gate and any autonomous merge enforce —
// they must never enter the requirement set as things to build.
const OUT_OF_SCOPE = /out[\s-]*of[\s-]*scope|non[\s-]*goals?/i;

function isOutOfScope(entry) {
  return OUT_OF_SCOPE.test(String(entry.section || ''));
}

// A PRD's narrative sections are extracted into the same spine as its
// requirements, and adopting them as requirements turns prose into work: on a
// real 149-entry spine, 36 of 133 "requirements" were Assumptions, Problem,
// Goals, Users, Scope, Milestones, Risks and Open questions — including
// "Open question — how much front-end?", which would then need a story, a
// taxonomy slot and test coverage.
//
// Classified, never dropped: the caller gets context / open_questions / risks
// back so nothing vanishes silently.
const OPEN_QUESTIONS = /open[\s-]*questions?/i;
const RISKS = /^\s*[\d.]*\s*risks?\b/i;
const NARRATIVE = /^\s*[\d.]*\s*(assumptions?|problem|goals?|users?|scope|milestones?|context|background|glossary|overview|summary)\s*$/i;

function sectionKind(entry) {
  const section = String(entry.section || '').replace(/^\s*[\d.]+\s*/, '').trim();
  if (OUT_OF_SCOPE.test(entry.section || '')) return 'safeguard';
  if (OPEN_QUESTIONS.test(section)) return 'open_question';
  if (RISKS.test(section)) return 'risk';
  if (NARRATIVE.test(section)) return 'context';
  return 'requirement';
}

// A PRD carries a requirement's postcondition in a sibling section suffixed
// " AC" (e.g. "5. EPIC 1 / FR-1.1 AC"). Those are acceptance criteria, not
// requirements: adopted as requirements they inflate the spine, and each one
// then demands a story of its own downstream.
const AC_SECTION = /\/\s*([A-Za-z0-9._-]+)\s+AC\s*$/;

function acceptanceTarget(entry) {
  const match = String(entry.section || '').match(AC_SECTION);
  return match ? match[1] : null;
}

// The PRD's own identifier for a requirement, taken from the trailing segment
// of its section ("5. EPIC 1 / FR-1.1" -> "FR-1.1"). Null when the section is
// a plain heading rather than a per-requirement one.
const PRD_ID_SECTION = /\/\s*([A-Za-z][A-Za-z0-9._-]*\d[A-Za-z0-9._-]*)\s*$/;

function prdIdentifier(section) {
  const match = String(section || '').match(PRD_ID_SECTION);
  return match ? match[1] : null;
}

// One source entry -> an adopted requirement. Verbatim by design.
function adoptOne(entry) {
  return {
    id: entry.id,
    text: entry.text,
    // The PRD's own identifier, written down rather than left in prose.
    // brd-milestones.json#requirements and brd-acceptance.json#requirement both
    // key on it, while `id` is the extractor's spine id — two id spaces that had
    // no machine-readable join, so every consumer needing one re-parsed
    // `section`. A live /spec run instead hand-built a mapping file and passed a
    // hard gate against it. Null when the section is a plain heading: inventing
    // a label would be worse than none, because downstream would then join on
    // something nobody wrote.
    label: prdIdentifier(entry.section),
    traces: [entry.id],
    // Slot classification is a judgement; the ten-slot floor still forces it.
    // Guessing a plausible default would satisfy that gate without anyone
    // having decided anything.
    taxonomy: null,
    acceptance: [],
    section: entry.section || null,
  };
}

/**
 * Adopt PRD requirements as the BRD spine, verbatim.
 * @param {Array<{id:string,text:string,section:string}>} source
 * @returns {{requirements: Array, warnings: string[]}}
 */
function adoptRequirements(source) {
  if (!Array.isArray(source) || source.length === 0) {
    throw new Error('brd-adopt: the source requirement spine is empty — nothing to adopt');
  }
  const warnings = [];
  const seen = new Set();
  const requirements = [];
  const context = [];
  const openQuestions = [];
  const risks = [];
  const bucket = { context, open_question: openQuestions, risk: risks };

  for (const entry of source) {
    if (!entry || !entry.id) {
      warnings.push(`source requirement with no id cannot be traced: ${JSON.stringify(entry).slice(0, 80)}`);
      continue;
    }
    if (seen.has(entry.id)) throw new Error(`brd-adopt: duplicate source requirement id ${entry.id}`);
    seen.add(entry.id);
    if (acceptanceTarget(entry)) continue;

    const kind = sectionKind(entry);
    if (kind === 'requirement') requirements.push(adoptOne(entry));
    else if (kind !== 'safeguard') bucket[kind].push({ id: entry.id, text: entry.text, section: entry.section });
  }
  linkAcceptance(requirements, source, warnings);
  return {
    requirements, warnings, context, open_questions: openQuestions, risks,
  };
}

/** Acceptance-criterion entries, linked to the requirement their section names. */
function adoptAcceptance(source) {
  return (source || [])
    .filter((entry) => entry && entry.id && acceptanceTarget(entry))
    .map((entry) => ({
      id: entry.id,
      requirement: acceptanceTarget(entry),
      text: entry.text,
    }));
}

// Attach acceptance ids to their requirement. An entry naming a requirement the
// spine does not contain is an untraceable postcondition — report it rather
// than dropping it silently.
function linkAcceptance(requirements, source, warnings) {
  // Keyed by the PRD identifier carried in the section ("… / FR-1.1"), not by
  // the entry id. On a real spine the ids are extractor-assigned (FRD-n) and
  // the PRD identifier appears only in the section, so keying by id matched
  // nothing and warned on every criterion.
  // ALL entries sharing the PRD id, not just the first. The extractor splits one
  // PRD requirement across several spine entries (FR-0.1 had four); attaching
  // its acceptance criterion to only the first leaves the rest oracle-less,
  // manufacturing downstream the exact defect validate-prd.js exists to block.
  const byPrdId = new Map();
  const push = (key, req) => {
    if (!key) return;
    if (!byPrdId.has(key)) byPrdId.set(key, []);
    byPrdId.get(key).push(req);
  };
  for (const r of requirements) {
    push(prdIdentifier(r.section), r);
    push(r.id, r); // also accept a spine that already uses PRD ids
  }
  for (const entry of adoptAcceptance(source)) {
    const targets = byPrdId.get(entry.requirement);
    if (!targets || targets.length === 0) {
      warnings.push(`acceptance ${entry.id} names requirement ${entry.requirement}, which is not in the spine`);
      continue;
    }
    for (const target of targets) {
      if (!target.acceptance.includes(entry.id)) target.acceptance.push(entry.id);
    }
  }
}

/** Out-of-scope entries, as Forbidden Actions. */
function adoptSafeguards(source) {
  return (source || [])
    .filter((entry) => entry && entry.id && isOutOfScope(entry))
    .map((entry, i) => ({
      id: `SG-${i + 1}`,
      kind: 'forbidden_action',
      text: entry.text,
      traces: [entry.id],
    }));
}

module.exports = {
  adoptRequirements, adoptSafeguards, adoptAcceptance,
  sectionKind, acceptanceTarget, prdIdentifier, isOutOfScope,
};
