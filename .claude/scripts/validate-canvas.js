#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/validate-canvas.js [reasons-canvas.md]
// Deterministic structure gate for the SPDD REASONS Canvas (gap G4): the seven
// REASONS sections must be present and the `Governs` list must name at least one
// source path (Canvas<->code drift detection depends on it). Run in /design's
// Step 1.9 alongside the grounding gate. Exit 0 = valid, 1 = invalid, 2 = IO.

const fs = require('fs');
const path = require('path');
const { validateCanvas } = require('../hooks/lib/canvas');

const DEFAULT = path.join(process.cwd(), 'specs', 'design', 'reasons-canvas.md');

function main() {
  const target = process.argv[2] || DEFAULT;
  let md;
  try {
    md = fs.readFileSync(target, 'utf8');
  } catch (err) {
    process.stderr.write(`validate-canvas: cannot read ${target}: ${err.message}\n`);
    process.exit(2);
  }
  const { errors, governs } = validateCanvas(md);
  if (errors.length) {
    process.stderr.write(`reasons-canvas INVALID (${errors.length}):\n${errors.map((e) => `  - ${e}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write(`reasons-canvas OK: all REASONS sections present, ${governs.length} governed path(s).\n`);
  process.exit(0);
}

if (require.main === module) main();
