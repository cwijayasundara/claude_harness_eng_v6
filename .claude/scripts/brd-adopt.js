#!/usr/bin/env node

'use strict';

// PRD adoption — the deterministic half of `/brd --prd` (R2).
//
// Measured on a real run: /brd turned 149 PRD requirements into 88 BRD ones,
// and the grounding gate then proved the mapping lossless both ways (149/149,
// 0 net-new, 0 dropped). That is a formal proof that the re-expression added no
// requirement content — BR-1 was a paraphrase of FRD-1 — at a cost of 258 KB of
// frontier output and the standing risk that a paraphrase quietly shifts meaning.
//
// Adoption removes the paraphrase step. The PRD's own ids become the spine, so
// grounding is an identity: there is nothing to prove because nothing was
// transformed. What /brd genuinely contributes is untouched and still runs —
// the ten-slot taxonomy floor, the analysis pack, the clarification log.
//
// Usage:
//   node .claude/scripts/brd-adopt.js [--root DIR] [--source PATH] [--dry-run]

const fs = require('fs');
const path = require('path');

const SOURCE_REL = path.join('specs', 'brd', 'frd-requirements.json');
const OUT_REQUIREMENTS = path.join('specs', 'brd', 'brd-requirements.json');
const OUT_SAFEGUARDS = path.join('specs', 'brd', 'brd-safeguards.json');
const OUT_ACCEPTANCE = path.join('specs', 'brd', 'brd-acceptance.json');
const SOURCE_PRD = path.join('specs', 'brd', 'source-frd.md');
const { parseMilestones } = require('../hooks/lib/prd-milestones.js');

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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function loadSource(sourcePath) {
  try {
    return JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  } catch (err) {
    process.stderr.write(`brd-adopt: cannot read ${sourcePath}: ${err.message}\n`);
    return process.exit(2);
  }
}

// Every source id, with how it was classified. This is what the Step 4.4
// grounding gate must read: brd-requirements.json holds only the requirements,
// so checking the source spine against it reports every classified entry as
// `dropped` — 52 of 149 on a real spine, a HARD BLOCK whose documented remedy
// ("add a BR entry covering it") would reinstate what classification removed.
function adoptionManifest(adopted, safeguards, acceptance) {
  const rows = [];
  const add = (entries, kind) => {
    for (const e of entries) rows.push({ id: e.id, kind, traces: [e.id], text: e.text });
  };
  add(adopted.requirements, 'requirement');
  add(adopted.context, 'context');
  add(adopted.open_questions, 'open_question');
  add(adopted.risks, 'risk');
  add(acceptance, 'acceptance');
  for (const s of safeguards) rows.push({ id: s.traces[0], kind: 'safeguard', traces: s.traces, text: s.text });
  return rows;
}

function writeOutputs(dir, adopted, safeguards, acceptance, milestones) {
  const at = (rel) => path.join(dir, path.basename(rel));
  writeJson(at(OUT_REQUIREMENTS), adopted.requirements);
  writeJson(at(OUT_SAFEGUARDS), safeguards);
  writeJson(at(OUT_ACCEPTANCE), acceptance);
  writeJson(at('brd-context.json'), adopted.context);
  writeJson(at('brd-open-questions.json'), adopted.open_questions);
  writeJson(at('brd-risks.json'), adopted.risks);
  writeJson(at('brd-adoption.json'), adoptionManifest(adopted, safeguards, acceptance));
  // R4: the PRD milestone plan, so /spec proposes scope from the document
  // rather than the human re-deriving it from memory each time.
  writeJson(at('brd-milestones.json'), milestones);
}

function main(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const root = arg('--root', process.cwd());
  // Delta mode writes to specs/brd/sprint-N/. --root cannot express that: it
  // prefixes specs/brd/ again, landing the files two levels deep where Step D2's
  // trace-check never looks.
  // resolve, not join: an absolute --out-dir must be honoured rather than
  // silently reparented under root.
  const outDir = path.resolve(root, arg('--out-dir', path.dirname(OUT_REQUIREMENTS)));
  const sourcePath = arg('--source', path.join(root, SOURCE_REL));
  const source = loadSource(sourcePath);

  let adopted;
  try {
    adopted = adoptRequirements(source);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return process.exit(2);
  }
  const safeguards = adoptSafeguards(source);
  const acceptance = adoptAcceptance(source);
  for (const w of adopted.warnings) process.stderr.write(`  WARN  ${w}\n`);

  let prd = null;
  // The PRD that goes with THIS spine — its sibling, not the flat one. Delta
  // mode adopts specs/brd/sprint-N/frd-requirements.json, and reading the flat
  // source-frd.md there gave sprint N the previous sprint's milestone plan.
  try {
    prd = fs.readFileSync(path.join(path.dirname(sourcePath), path.basename(SOURCE_PRD)), 'utf8');
  } catch (_) { /* interview mode, or no PRD beside the spine */ }
  const milestones = parseMilestones(prd);
  if (!argv.includes('--dry-run')) writeOutputs(outDir, adopted, safeguards, acceptance, milestones);
  return process.stdout.write(
    `brd-adopt: ${adopted.requirements.length} requirements adopted verbatim, `
    + `${acceptance.length} acceptance criteria, ${safeguards.length} forbidden actions, `
    + `${adopted.context.length} context, ${adopted.open_questions.length} open question(s), ${adopted.risks.length} risk(s), `
    + `${adopted.warnings.length} warning(s).\n`
    + 'Taxonomy slots are unassigned — the ten-slot floor still has to be satisfied.\n',
  );
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { adoptRequirements, adoptSafeguards, adoptAcceptance, SOURCE_REL };
