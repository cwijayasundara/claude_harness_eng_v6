#!/usr/bin/env node

'use strict';

// CR acceptance-index extractor for the brownfield test lane (/test --from-cr).
//
// A change request is the brownfield analogue of a story's acceptance criteria.
// This turns a CR markdown document into a stable [{id,text}] upstream index so
// the delta test plan can be grounded against the CR with the SAME trace-check
// gate the greenfield lane runs against story acceptance criteria: a delta test
// tracing to no CR line is scope creep; a CR line with no delta test is an
// unverified requirement.
//
// Extraction is deterministic: list items (bullet / checkbox / numbered) under an
// acceptance-like heading become the index; if no such heading exists, every list
// item in the document is used. Prose is ignored. No list items → empty index
// (the skill routes that to /clarify before writing tests).

const fs = require('fs');
const path = require('path');

const HEADING = /^#{1,6}\s+(.*)$/;
const RELEVANT = /accept|criteria|requirement|behaviou?r/i;
const LIST_ITEM = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)(.+?)\s*$/;

// Pure core. Returns [{ id, text }] in document order.
function extractAcceptance(markdown) {
  const items = [];
  let relevantSection = false;
  for (const line of String(markdown || '').split('\n')) {
    const heading = line.match(HEADING);
    if (heading) {
      relevantSection = RELEVANT.test(heading[1]);
      continue;
    }
    const item = line.match(LIST_ITEM);
    if (item) items.push({ text: item[1].replace(/\s+/g, ' ').trim(), inRelevant: relevantSection });
  }
  const chosen = items.some((i) => i.inRelevant) ? items.filter((i) => i.inRelevant) : items;
  return chosen.map((i, n) => ({ id: `CR-AC${n + 1}`, text: i.text }));
}

// --- CLI -----------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (k && k.startsWith('--')) args[k.slice(2)] = argv[i + 1];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let markdown = args.text;
  if (markdown == null) {
    if (!args.cr || !fs.existsSync(args.cr)) {
      process.stderr.write('usage: cr-index.js (--cr <file.md> | --text "<md>") [--out <file>]\n');
      process.exit(2);
    }
    markdown = fs.readFileSync(args.cr, 'utf8');
  }
  const index = extractAcceptance(markdown);
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(index, null, 2) + '\n');
  }
  process.stdout.write(`cr-index: ${index.length} acceptance line(s)\n`);
  for (const i of index) process.stdout.write(`  ${i.id}: ${i.text}\n`);
  process.exit(0);
}

module.exports = { extractAcceptance };

if (require.main === module) main();
