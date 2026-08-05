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
const MILESTONE = /^\s*-\s*\*\*(M\d+[^*]*)\*\*\s*(.*)$/;
// A number, a percentage, a duration, or a named standard makes an NFR checkable.
const MEASURABLE = /\d|\b(WCAG|SOC ?2|ISO ?\d+|GDPR|HIPAA|PCI|AES|TLS)\b/i;
const OBSERVABLE_DONE = /done when:\s*(.+)$/i;
const VAGUE_DONE = /^(it works|works correctly|is done|complete|finished)\.?$/i;

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

function addRequirement(requirements, seen, errors, id, text) {
  if (seen.has(id)) errors.push(`duplicate requirement id ${id} — ids collapse in the grounding spine`);
  seen.add(id);
  requirements.push({ id, text: String(text || '').trim() });
}

// Markdown heading ("## 5. EPIC 1 / FR-1.1") or a bold pseudo-heading
// ("**FR-1.1 Connector ingest**"). The audited PRD uses the latter throughout;
// both are ordinary markdown conventions and only the id is load-bearing.
const HEADING_REQ = /^##+\s*.*?\b(FR-[\w.]+|NFR-[\w.]+)\s*$/i;
const BOLD_REQ = /^\*\*(FR-[\w.]+|NFR-[\w.]+)\b[^*]*\*\*/i;

function collectFromHeadings(text, requirements, seen, errors) {
  const lines = String(text).split('\n');
  lines.forEach((line, i) => {
    const match = line.match(HEADING_REQ) || line.match(BOLD_REQ);
    if (!match) return;
    const body = [];
    for (const next of lines.slice(i + 1)) {
      if (/^#+\s/.test(next) || HEADING_REQ.test(next) || BOLD_REQ.test(next)) break;
      body.push(next);
    }
    addRequirement(requirements, seen, errors, match[1], body.join(' '));
  });
}

function collectRequirements(text, errors) {
  const requirements = [];
  const seen = new Set();
  for (const body of [sectionBody(text, 'Functional Requirements'), sectionBody(text, 'Non-Functional Requirements')]) {
    for (const line of body.split('\n')) {
      const match = line.match(REQ_ID);
      if (match) addRequirement(requirements, seen, errors, match[1], match[2]);
    }
  }
  collectFromHeadings(text, requirements, seen, errors);
  return requirements;
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

function checkMilestones(text, warnings) {
  for (const line of sectionBody(text, 'Milestones').split('\n')) {
    const match = line.match(MILESTONE);
    if (!match) continue;
    const [, name, rest] = match;
    const done = rest.match(OBSERVABLE_DONE);
    const id = name.trim().split(/\s|—/)[0];
    if (!done) {
      warnings.push(`milestone ${id} has no "Done when:" — it cannot gate a deploy`);
    } else if (VAGUE_DONE.test(done[1].trim())) {
      warnings.push(`milestone ${id} done-when is not observable: "${done[1].trim()}"`);
    }
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
