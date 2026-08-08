#!/usr/bin/env node

'use strict';

// PRD shape gate (R3).
//
// docs/prd-format.md has always defined the entry artifact and nothing has ever
// checked one, while --autonomous and --auto both require a PRD to run at all.
//
// Since R2 this matters more, not less: brd-adopt.js carries FR/NFR text
// verbatim into the grounding spine, so the PRD *is* the requirement baseline
// rather than a draft something else re-expresses. A requirement with no id can
// be silently dropped; a requirement with no observable postcondition gives the
// evaluator no oracle, and a check with no oracle passes by default.
//
// Blocks on structure. Warns on judgement (a vague NFR, an unobservable
// milestone) — a PRD is a human document, and a hard block on prose quality
// would be more annoying than useful.
//
// Usage:
//   node .claude/scripts/validate-prd.js <path-to-prd.md> [--json]

const fs = require('fs');

// Heading variants a real PRD legitimately uses. brd-adopt.js already treats
// Non-goals as Out of Scope; disagreeing here would block a document the
// adopter is happy to consume.
const OUT_OF_SCOPE_HEADING = /^##+\s*\d*\.?\s*(Out of Scope|Non-?goals?)/im;
// `\?{3,}` cannot sit inside a \b…\b group — `?` is not a word character, so
// the boundary never matches and "???" slipped through.
const PLACEHOLDER = /\b(TBD|TODO|FIXME|XXX)\b|(\?{3,})/;
const REQ_ID = /^\s*-\s*\*\*(FR-[\w.]+|NFR-[\w.]+)\*\*\s*(.*)$/;
const ACCEPTANCE_ID = /^\s*-\s*\*\*(FR-[\w.]+)\*\*\s*(?:→|->)\s*(.+)$/;
// Milestones are named M1.. or P0.. depending on the document; the real PRD
// uses P0-P6, so an M-only pattern matched none of them and the check was silent.
// A number, a percentage, a duration, or a named standard makes an NFR checkable.
const MEASURABLE = /\d|\b(WCAG|SOC ?2|ISO ?\d+|GDPR|HIPAA|PCI|AES|TLS)\b/i;
// Milestone shapes are shared with brd-adopt so the two cannot disagree.
const { parseMilestones, milestonesUnparsed } = require('../hooks/lib/prd-milestones.js');

// Line-scan rather than a regex with a lookahead: the obvious `(?=^##\s|\Z)`
// silently matches a literal "Z" in JavaScript, so the LAST section of a
// document came back empty. A PRD that ends with its Acceptance section would
// then have had every requirement reported as missing a postcondition — a
// confident, wrong block.
function sectionBody(text, label) {
  // Any heading level: a real PRD nests its deny-list under "### Non-goals for
  // v1" as readily as "## 5. Out of Scope".
  const heading = new RegExp(`^#{2,}\\s*\\d*\\.?\\s*${label}`, 'i');
  const lines = String(text).split('\n');
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return '';
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    body.push(line);
  }
  return body.join('\n');
}

// First sighting declares; a later one is a RESTATEMENT, not a redeclaration.
// A PRD legitimately repeats its ids in a traceability matrix, a deferral note
// or a milestone mapping — treating those as duplicates hard-blocked the
// document, and punished exactly the traceability table the harness advocates.
// `declaring` marks the call sites where a repeat really is a duplicate.
function addRequirement(requirements, seen, errors, id, text, declaring = false) {
  if (seen.has(id)) {
    if (declaring) {
      errors.push(`duplicate requirement id ${id} — ids collapse in the grounding spine`);
    }
    return;
  }
  seen.add(id);
  requirements.push({ id, text: String(text || '').trim() });
}

// Markdown heading ("## 5. EPIC 1 / FR-1.1") or a bold pseudo-heading
// ("**FR-1.1 Connector ingest**"). The audited PRD uses the latter throughout;
// both are ordinary markdown conventions and only the id is load-bearing.
const HEADING_REQ = /^##+\s*.*?\b(FR-[\w.]+|NFR-[\w.]+)\s*$/i;
const BOLD_REQ = /^\*\*(FR-[\w.]+|NFR-[\w.]+)\b[^*]*\*\*/i;

// A heading or bold pseudo-heading is unambiguously a DECLARATION — nobody
// restates a requirement by writing its heading again. A restatement uses a
// table row or a prose bullet. So a repeat here is a real duplicate, and
// without this the two forms the audited PRD uses throughout could declare the
// same id twice and be silently collapsed.
function collectFromHeadings(text, requirements, seen, errors) {
  const lines = String(text).split('\n');
  const declared = new Set();
  lines.forEach((line, i) => {
    const match = line.match(HEADING_REQ) || line.match(BOLD_REQ);
    if (!match) return;
    if (declared.has(match[1])) {
      errors.push(`duplicate requirement id ${match[1]} — ids collapse in the grounding spine`);
    }
    declared.add(match[1]);
    const body = [];
    for (const next of lines.slice(i + 1)) {
      if (/^#+\s/.test(next) || HEADING_REQ.test(next) || BOLD_REQ.test(next)) break;
      body.push(next);
    }
    addRequirement(requirements, seen, errors, match[1], body.join(' '));
  });
}

// A markdown table row: "| **NFR-1** | Ranking completes in 20 min |".
const TABLE_REQ = /^\s*\|\s*\**(FR-[\w.]+|NFR-[\w.]+)\**\s*\|(.*)$/i;

// Scan the WHOLE document rather than only named sections. A real PRD puts its
// NFRs in a table under "6. Non-functional" and some FRs as bullets under a
// topic heading; restricting the scan to "Functional Requirements" /
// "Non-Functional Requirements" found neither, so the NFR and milestone checks
// had nothing to check and reported nothing.
// Bullets inside an explicit requirements section are declarations, so two
// sightings there really are a duplicate id. Everywhere else a repeat is a
// restatement — a traceability matrix, a deferral note, a milestone mapping —
// and erroring on those hard-blocked documents for doing the right thing.
function reportDeclaredDuplicates(text, errors) {
  const declared = new Set();
  for (const label of ['Functional Requirements', 'Non-Functional Requirements']) {
    for (const line of sectionBody(text, label).split('\n')) {
      const match = line.match(REQ_ID);
      if (!match) continue;
      if (declared.has(match[1])) {
        errors.push(`duplicate requirement id ${match[1]} — ids collapse in the grounding spine`);
      }
      declared.add(match[1]);
    }
  }
}

function collectRequirements(text, errors) {
  const requirements = [];
  const seen = new Set();
  reportDeclaredDuplicates(text, errors);
  // Declarations first, whatever their position: a traceability row can precede
  // the requirement it references, and first-sighting-wins then kept the row cell
  // as the requirement text, losing the real body and its inline AC line.
  collectFromHeadings(text, requirements, seen, errors);
  for (const line of String(text).split('\n')) {
    // An acceptance entry ("- **FR-1** → …") reuses the requirement's id by
    // design. Scanning the whole document made those look like a second
    // declaration of the same requirement and every id came back duplicated.
    if (ACCEPTANCE_ID.test(line)) continue;
    const bullet = line.match(REQ_ID);
    if (bullet) {
      addRequirement(requirements, seen, errors, bullet[1], bullet[2]);
      continue;
    }
    const row = line.match(TABLE_REQ);
    // Skip the id-less separator/header rows a table always carries.
    if (row) addRequirement(requirements, seen, errors, row[1], row[2].replace(/\|/g, ' '));
  }
  return requirements;
}

// A heading is a promise that requirements follow. One that parses to zero ids
// is the silent-nothing-to-check failure: every downstream test passes because
// it was handed an empty set.
function checkSectionsParsed(text, requirements, errors) {
  const kinds = [
    { label: 'Non-functional', prefix: 'NFR-' },
    { label: 'Functional Requirements', prefix: 'FR-' },
  ];
  for (const { label, prefix } of kinds) {
    const heading = new RegExp(`^#{2,}\\s*\\d*\\.?\\s*${label}`, 'im');
    if (!heading.test(text)) continue;
    if (!requirements.some((r) => r.id.startsWith(prefix))) {
      errors.push(`a "${label}" section exists but parses to zero ${prefix}ids — nothing downstream can check it`);
    }
  }
}

function checkAcceptance(text, requirements, errors) {
  const covered = new Set();
  for (const line of sectionBody(text, 'Acceptance').split('\n')) {
    const match = line.match(ACCEPTANCE_ID);
    if (!match) continue;
    const [, id] = match;
    if (!requirements.some((r) => r.id === id)) {
      errors.push(`acceptance names ${id}, which is not a requirement in this PRD`);
    }
    covered.add(id);
  }
  // An inline acceptance line in the requirement's own body is the other real
  // shape. It is usually emphasised and often blockquoted — "> **AC:** Given …"
  // — so the marker is not preceded by whitespace and must not be anchored on it.
  for (const req of requirements) {
    if (/\bAC:\**\s*\S/i.test(req.text)) covered.add(req.id);
  }
  for (const req of requirements.filter((r) => r.id.startsWith('FR-'))) {
    if (!covered.has(req.id)) {
      errors.push(`${req.id} has no acceptance postcondition — the evaluator would have no oracle for it`);
    }
  }
}

function checkNfrs(requirements, warnings) {
  for (const req of requirements.filter((r) => r.id.startsWith('NFR-'))) {
    if (!MEASURABLE.test(req.text)) {
      warnings.push(`${req.id} has no number or named standard — "${req.text}" cannot be verified`);
    }
  }
}

// Shares the parser with brd-adopt via hooks/lib/prd-milestones.js, so the two
// cannot disagree about what a milestone is.
function checkMilestones(text, warnings) {
  const plan = parseMilestones(text);
  for (const m of plan) {
    if (!m.done_when) {
      warnings.push(`milestone ${m.id} has no "Done when:" — it cannot gate a deploy`);
    } else if (!m.observable) {
      warnings.push(`milestone ${m.id} done-when is not observable: "${m.done_when}"`);
    }
  }
  // A milestone naming no requirements still sequences the build, but /spec
  // cannot derive scope from it — the human has to map epics by hand.
  const unmapped = plan.filter((m) => m.requirements.length === 0).map((m) => m.id);
  if (plan.length && unmapped.length === plan.length) {
    warnings.push(`no milestone names any requirement (${unmapped.join(', ')}) — `
      + '/spec cannot propose scope from the plan and will have to ask');
  }
  if (milestonesUnparsed(text, plan)) {
    warnings.push('a Milestones section exists but no milestone ids parsed — none were checked');
  }
}

/**
 * @param {string} text the PRD markdown
 * @returns {{ok: boolean, errors: string[], warnings: string[], requirements: Array}}
 */
function validatePrd(text) {
  const errors = [];
  const warnings = [];
  const source = String(text || '');

  if (!OUT_OF_SCOPE_HEADING.test(source)) {
    errors.push("missing required section: Out of Scope (or Non-goals)");
  }
  const placeholder = source.match(PLACEHOLDER);
  if (placeholder) {
    errors.push(`placeholder text "${placeholder[1] || placeholder[2]}" — it becomes a requirement nobody wrote`);
  }

  const requirements = collectRequirements(source, errors);
  if (!requirements.some((r) => r.id.startsWith('FR-'))) {
    errors.push('no functional requirements found — an empty PRD cannot ground anything');
  }
  checkAcceptance(source, requirements, errors);
  checkSectionsParsed(source, requirements, errors);
  checkNfrs(requirements, warnings);
  checkMilestones(source, warnings);

  const outOfScope = ['Out of Scope', 'Non-goals', 'Nongoals', 'Non goals']
    .flatMap((label) => sectionBody(source, label).split('\n'))
    .filter((line) => /^\s*-\s+\S/.test(line));
  if (outOfScope.length === 0) {
    errors.push('Out of Scope is empty — silence is read as permitted by the autonomous gate');
  }

  return { ok: errors.length === 0, errors, warnings, requirements };
}

function main(argv) {
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) {
    process.stderr.write('usage: validate-prd.js <path-to-prd.md> [--json]\n');
    return process.exit(2);
  }
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    process.stderr.write(`validate-prd: cannot read ${file}: ${err.message}\n`);
    return process.exit(2);
  }
  const result = validatePrd(text);
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return process.exit(result.ok ? 0 : 1);
  }
  for (const w of result.warnings) process.stderr.write(`  WARN  ${w}\n`);
  if (!result.ok) {
    process.stderr.write(`validate-prd: BLOCKED (${file})\n`);
    for (const e of result.errors) process.stderr.write(`  - ${e}\n`);
    process.stderr.write('\nSee docs/prd-format.md, or run /prd to author one.\n');
    return process.exit(1);
  }
  return process.stdout.write(
    `validate-prd: OK — ${result.requirements.length} requirements, ${result.warnings.length} warning(s).\n`,
  );
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { validatePrd };
