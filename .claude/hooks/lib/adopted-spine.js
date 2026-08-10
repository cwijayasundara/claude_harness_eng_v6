'use strict';

// Has the adopted requirement spine survived the render?
//
// In `--prd` / `--frd` mode `brd-adopt.js` writes brd-requirements.json
// deterministically, carrying the source text verbatim with its own ids, and
// `brd-render` is told in plain words to fill `taxonomy` and leave `id` and
// `text` alone. Its own SKILL admits what happens if it does not: "neither hard
// gate can catch it" — an adopted spine passes the grounding gate as an
// identity, and a re-keyed spine that still carries `traces` passes it as
// coverage. The only difference is that one was proved lossless.
//
// A live run re-keyed all 24 requirements from the spine ids (FRD-n) to the PRD
// labels (FR-n). Nothing noticed, and two runs of the same pipeline ended up
// emitting brd-requirements.json in two different id spaces — which is what
// left a downstream milestone gate with no way to join them.
//
// The oracle is the adopter itself, re-derived from the immutable source, so
// this check cannot drift from what adoption actually produces.

const OWNED = ['text', 'label'];

function asRows(value) {
  return Array.isArray(value) ? value : [];
}

function fieldErrors(want, got) {
  const errors = [];
  for (const field of OWNED) {
    if ((got[field] || null) === (want[field] || null)) continue;
    errors.push(field === 'text'
      ? `${want.id} text was changed — the source document is the immutable baseline`
      : `${want.id} label changed: ${want.label} -> ${got.label}`);
  }
  return errors;
}

/**
 * Differences between the adopted spine and what is on disk.
 *
 * `taxonomy` and `acceptance` are deliberately not compared — filling them is
 * the renderer's job, and the ten-slot floor gates them separately.
 *
 * @param {Array} expected freshly adopted requirements
 * @param {Array} actual the on-disk brd-requirements.json
 * @returns {string[]} one message per difference; empty means intact
 */
function spineDiff(expected, actual) {
  const errors = [];
  const byId = new Map(asRows(actual).filter((r) => r && r.id).map((r) => [r.id, r]));
  for (const want of asRows(expected)) {
    const got = byId.get(want.id);
    byId.delete(want.id);
    if (!got) {
      errors.push(`${want.id} is missing — an adopted requirement may not be dropped`);
      continue;
    }
    errors.push(...fieldErrors(want, got));
  }
  for (const id of byId.keys()) {
    errors.push(`${id} is not in the adopted spine — a requirement was invented, or the spine was re-keyed`);
  }
  return errors;
}

const REMEDY = 'In --prd/--frd mode the renderer fills `taxonomy` only. Restore id/text/label\n'
  + 'from the source, or fix the source document and re-adopt.\n';

/**
 * Compare the on-disk spine against a fresh adoption and report.
 *
 * @param {string} file path to brd-requirements.json
 * @param {Array} expected freshly adopted requirements
 * @param {{out: Function, err: Function}} [io]
 * @returns {number} 0 intact, 1 modified, 2 nothing to verify
 */
function verifyAdoptedSpine(file, expected, io = {}) {
  const out = io.out || ((s) => process.stdout.write(s));
  const err = io.err || ((s) => process.stderr.write(s));
  let actual;
  try {
    actual = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  } catch (_) {
    // A missing spine must not read as a clean bill of health.
    err(`brd-adopt --verify: cannot read ${file} — nothing to verify\n`);
    return 2;
  }
  const errors = spineDiff(expected, actual);
  if (errors.length === 0) {
    out(`brd-adopt --verify: OK — ${asRows(expected).length} adopted requirements intact.\n`);
    return 0;
  }
  err('brd-adopt --verify: BLOCKED — the adopted spine was modified.\n');
  for (const e of errors) err(`  - ${e}\n`);
  err(`\n${REMEDY}`);
  return 1;
}

module.exports = { spineDiff, verifyAdoptedSpine, REMEDY };
