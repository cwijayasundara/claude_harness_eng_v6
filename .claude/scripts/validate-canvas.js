#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/validate-canvas.js [reasons-canvas.md]
// Deterministic structure gate for the SPDD REASONS Canvas (gap G4): the seven
// REASONS sections must be present and the `Governs` list must name at least one
// source path (Canvas<->code drift detection depends on it). Run in /design's
// Step 1.9 alongside the grounding gate. Exit 0 = valid, 1 = invalid, 2 = IO.
//
// D9: when specs/brd/brd-safeguards.json exists, also proves every SG-n reached
// the design contract. Structure alone cannot catch a Safeguards section that is
// present, well-formed, and silently missing a business invariant.

const fs = require('fs');
const path = require('path');
const { validateCanvas, checkSafeguardCoverage } = require('../hooks/lib/canvas');

const DEFAULT = path.join(process.cwd(), 'specs', 'design', 'reasons-canvas.md');
const SAFEGUARDS = path.join(process.cwd(), 'specs', 'brd', 'brd-safeguards.json');

function reportSafeguards(md, safeguardsPath) {
  if (!fs.existsSync(safeguardsPath)) {
    process.stdout.write('reasons-canvas: safeguard coverage SKIPPED (no specs/brd/brd-safeguards.json)\n');
    return 0;
  }
  let spine;
  try {
    spine = JSON.parse(fs.readFileSync(safeguardsPath, 'utf8'));
  } catch (err) {
    process.stderr.write(`validate-canvas: cannot read ${safeguardsPath}: ${err.message}\n`);
    return 2;
  }
  const v = checkSafeguardCoverage(md, spine);
  process.stdout.write(
    `reasons-canvas safeguards: ${v.pass ? 'PASS' : 'FAIL'} — ${v.covered}/${v.required_total} cited`
    + `${v.reason ? ` (${v.reason})` : ''}\n`,
  );
  for (const u of v.uncovered) {
    process.stderr.write(`  UNCOVERED  ${u.id} (${u.kind}): ${u.text}\n`);
  }
  for (const c of v.cited_unknown) {
    process.stderr.write(`  UNKNOWN    ${c} cited in the Canvas but absent from brd-safeguards.json\n`);
  }
  for (const m of v.misplaced) process.stdout.write(`  WARN  ${m.id}: ${m.note}\n`);
  return v.pass ? 0 : 1;
}

function main() {
  const target = process.argv[2] || DEFAULT;
  let md;
  try {
    md = fs.readFileSync(target, 'utf8');
  } catch (err) {
    process.stderr.write(`validate-canvas: cannot read ${target}: ${err.message}\n`);
    return process.exit(2);
  }
  const { errors, governs } = validateCanvas(md);
  if (errors.length) {
    process.stderr.write(`reasons-canvas INVALID (${errors.length}):\n${errors.map((e) => `  - ${e}`).join('\n')}\n`);
    return process.exit(1);
  }
  process.stdout.write(`reasons-canvas OK: all REASONS sections present, ${governs.length} governed path(s).\n`);
  return process.exit(reportSafeguards(md, process.argv[3] || SAFEGUARDS));
}

if (require.main === module) main();
