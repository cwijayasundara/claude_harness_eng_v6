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

// A PRD's "Out of Scope" section is a deny-list, not a backlog. Its entries
// become Forbidden Actions, which the gate and any autonomous merge enforce —
// they must never enter the requirement set as things to build.
const OUT_OF_SCOPE = /out[\s-]*of[\s-]*scope|non[\s-]*goals?/i;

function isOutOfScope(entry) {
  return OUT_OF_SCOPE.test(String(entry.section || ''));
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

  for (const entry of source) {
    if (!entry || !entry.id) {
      warnings.push(`source requirement with no id cannot be traced: ${JSON.stringify(entry).slice(0, 80)}`);
      continue;
    }
    if (seen.has(entry.id)) throw new Error(`brd-adopt: duplicate source requirement id ${entry.id}`);
    seen.add(entry.id);
    if (acceptanceTarget(entry) || isOutOfScope(entry)) continue;
    requirements.push(adoptOne(entry));
  }
  linkAcceptance(requirements, source, warnings);
  return { requirements, warnings };
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
  const byPrdId = new Map();
  for (const r of requirements) {
    const prdId = prdIdentifier(r.section);
    if (prdId && !byPrdId.has(prdId)) byPrdId.set(prdId, r);
    byPrdId.set(r.id, r); // also accept a spine that already uses PRD ids
  }
  for (const entry of adoptAcceptance(source)) {
    const target = byPrdId.get(entry.requirement);
    if (!target) {
      warnings.push(`acceptance ${entry.id} names requirement ${entry.requirement}, which is not in the spine`);
      continue;
    }
    target.acceptance.push(entry.id);
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

function main(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const root = arg('--root', process.cwd());
  const source = loadSource(arg('--source', path.join(root, SOURCE_REL)));

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

  if (!argv.includes('--dry-run')) {
    writeJson(path.join(root, OUT_REQUIREMENTS), adopted.requirements);
    writeJson(path.join(root, OUT_SAFEGUARDS), safeguards);
    writeJson(path.join(root, OUT_ACCEPTANCE), acceptance);
  }
  return process.stdout.write(
    `brd-adopt: ${adopted.requirements.length} requirements adopted verbatim, `
    + `${acceptance.length} acceptance criteria, ${safeguards.length} forbidden actions, `
    + `${adopted.warnings.length} warning(s).\n`
    + 'Taxonomy slots are unassigned — the ten-slot floor still has to be satisfied.\n',
  );
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { adoptRequirements, adoptSafeguards, adoptAcceptance, SOURCE_REL };
