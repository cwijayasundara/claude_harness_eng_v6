'use strict';

// Requirement-taxonomy floor for the BRD.
//
// The grounding gate proves the BRD invented and dropped nothing relative to its
// source. It cannot prove the source asked the right questions: if the FRD is
// silent on retention, authz, or failure modes, the BRD is silent too and every
// existing check still passes. "Comprehensive" then degrades to "all sections
// are non-empty", which is a formatting property, not a coverage one.
//
// This gate asserts a fixed ten-slot floor. Every slot needs either a
// requirement tagged with it, or a recorded, substantive reason it does not
// apply. Silence is never a pass — but neither is a box-ticking "N/A", so
// placeholder justifications are rejected and the reason lands in a committed
// artifact where a reviewer can challenge it.

const fs = require('fs');
const path = require('path');

const SLOTS = [
  'functional',
  'data_lifecycle',
  'integration',
  'performance',
  'security_authz',
  'privacy_retention',
  'observability',
  'operability_failure',
  'ux_accessibility',
  'constraints',
];

// A justification must say something. These are the shapes that say nothing.
const PLACEHOLDERS = /^(n\/?a|none|nil|no|not applicable|tbd|todo|-+|unknown)$/i;
const MIN_REASON_CHARS = 25;

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function isSubstantive(reason) {
  const text = String(reason == null ? '' : reason).trim();
  return text.length >= MIN_REASON_CHARS && !PLACEHOLDERS.test(text);
}

function collectInvalid(requirements, coverage) {
  const known = new Set(SLOTS);
  const invalid = [];
  for (const req of requirements) {
    for (const slot of asArray(req.taxonomy)) {
      if (!known.has(slot)) invalid.push({ id: req.id, slot });
    }
  }
  for (const entry of coverage) {
    if (!known.has(entry.slot)) invalid.push({ id: 'taxonomy-coverage.json', slot: entry.slot });
  }
  return invalid;
}

function describeSlot(slot, requirements, coverage) {
  const requirement_ids = requirements
    .filter((r) => asArray(r.taxonomy).includes(slot))
    .map((r) => r.id);
  const entry = coverage.find((c) => c.slot === slot);
  const reason = entry && isSubstantive(entry.na_reason) ? String(entry.na_reason).trim() : '';
  return {
    slot,
    requirement_ids,
    na_reason: reason,
    covered: requirement_ids.length > 0 || reason.length > 0,
    excuse_offered: Boolean(entry),
  };
}

function checkTaxonomy(requirements, coverage) {
  const reqs = asArray(requirements);
  if (reqs.length === 0) {
    throw new Error('brd-taxonomy: no requirements to check — the BRD spine is empty');
  }
  const cov = asArray(coverage);
  const slots = SLOTS.map((slot) => describeSlot(slot, reqs, cov));
  const invalid_slots = collectInvalid(reqs, cov);
  const untagged = reqs.filter((r) => asArray(r.taxonomy).length === 0).map((r) => r.id);
  const uncovered = slots.filter((s) => !s.covered && !s.excuse_offered).map((s) => s.slot);
  const unjustified = slots.filter((s) => !s.covered && s.excuse_offered).map((s) => s.slot);

  const warnings = slots
    .filter((s) => s.requirement_ids.length > 0 && s.na_reason.length > 0)
    .map((s) => `slot ${s.slot} is contradictory: ${s.requirement_ids.length} requirement(s) cover it, `
      + 'yet taxonomy-coverage.json also excuses it. Drop the excuse or retag the requirement(s).');

  return {
    pass: uncovered.length === 0 && unjustified.length === 0
      && invalid_slots.length === 0 && untagged.length === 0,
    slots,
    uncovered,
    unjustified,
    invalid_slots,
    untagged,
    warnings,
  };
}

// --- CLI ----------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (key && key.startsWith('--')) args[key.slice(2)] = argv[i + 1];
  }
  return args;
}

function readJson(file, optional) {
  if (!file || !fs.existsSync(file)) {
    if (optional) return [];
    throw new Error(file ? `cannot read ${file}: not found` : 'missing required path');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function printVerdict(v) {
  const covered = v.slots.filter((s) => s.covered).length;
  process.stdout.write(
    `brd-taxonomy: ${v.pass ? 'PASS' : 'FAIL'} — ${covered}/${v.slots.length} slots covered\n`,
  );
  for (const slot of v.uncovered) {
    process.stdout.write(
      `  UNCOVERED    ${slot} — no requirement carries this tag and no reason is recorded. `
      + 'Add a requirement, or record why it does not apply in taxonomy-coverage.json.\n',
    );
  }
  for (const slot of v.unjustified) {
    process.stdout.write(
      `  UNJUSTIFIED  ${slot} — an excuse was offered but says nothing. Give the actual reason `
      + `(>= ${MIN_REASON_CHARS} chars, not "N/A").\n`,
    );
  }
  for (const bad of v.invalid_slots) {
    process.stdout.write(`  UNKNOWN SLOT ${bad.slot} on ${bad.id} — expected one of: ${SLOTS.join(', ')}\n`);
  }
  for (const id of v.untagged) {
    process.stdout.write(`  UNTAGGED     ${id} — every requirement needs at least one taxonomy tag\n`);
  }
  for (const w of v.warnings) process.stdout.write(`  WARN  ${w}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let verdict;
  try {
    verdict = checkTaxonomy(
      readJson(args.requirements || 'specs/brd/brd-requirements.json', false),
      readJson(args.coverage || 'specs/brd/taxonomy-coverage.json', true),
    );
  } catch (err) {
    process.stderr.write(`brd-taxonomy: ${err.message}\n`);
    return process.exit(2);
  }
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(verdict, null, 2)}\n`);
  }
  printVerdict(verdict);
  return process.exit(verdict.pass ? 0 : 1);
}

module.exports = { checkTaxonomy, SLOTS, MIN_REASON_CHARS };

if (require.main === module) main();
