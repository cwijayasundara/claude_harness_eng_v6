#!/usr/bin/env node

'use strict';

// BRD-vs-FRD grounding check — the first link in the pipeline trace chain.
//
// The BRD is generated from a Functional Requirements Document (FRD) plus the
// human's confirmed interrogation answers; those two are the ONLY sanctioned
// sources of truth. This proves mechanically (not by LLM judgement) that the
// BRD invented nothing and dropped nothing relative to them:
//   net_new — a BRD requirement tracing to nothing in the FRD or clarifications.
//   dropped — an FRD requirement no BRD requirement traces back to.
// pass = both empty. A mistake here cascades through spec → design → test → impl.
//
// This is the BRD-specific wrapper around the generic trace engine
// (.claude/scripts/trace-check.js): FRD requirements are `required` (must all be
// covered), clarifications are `optional` (valid trace targets, not required to
// be covered), and the BRD requirements are the `downstream` items.
//
// Inputs are JSON arrays produced by /brd ingestion:
//   frd-requirements.json    [{ id, text, section }]
//   clarification-log.json   [{ id, question, answer }]   (optional)
//   brd-requirements.json    [{ id, text, traces: [..] }]

const fs = require('fs');
const path = require('path');
const { checkTraces } = require('../../../scripts/trace-check');

// Pure core: returns the BRD grounding verdict (BRD-named fields), backed by the
// generic engine so the net-new / dropped semantics stay single-sourced.
function checkGrounding(frd, clarifications, brd) {
  const v = checkTraces({ required: frd, optional: clarifications, downstream: brd, layer: 'BRD' });
  return {
    pass: v.pass,
    frd_total: v.required_total,
    frd_covered: v.required_covered,
    brd_total: v.downstream_total,
    net_new: v.net_new,
    dropped: v.dropped.map((d) => ({ id: d.id, text: d.text, section: d.section || '' })),
  };
}

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
    throw new Error(file ? `file not found: ${file}` : 'missing required path');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function printVerdict(v) {
  process.stdout.write(
    `BRD grounding: ${v.pass ? 'PASS' : 'FAIL'} — ` +
      `${v.frd_covered}/${v.frd_total} FRD requirements covered, ` +
      `${v.net_new.length} net-new, ${v.dropped.length} dropped\n`
  );
  for (const n of v.net_new) process.stdout.write(`  NET-NEW  ${n.id}: ${n.reason}\n`);
  for (const d of v.dropped) process.stdout.write(`  DROPPED  ${d.id} (${d.section}): ${d.text}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let verdict;
  try {
    verdict = checkGrounding(
      readJson(args.frd, false),
      readJson(args.clarifications, true),
      readJson(args.brd, false)
    );
  } catch (err) {
    process.stderr.write(`grounding-check: ${err.message}\n`);
    process.exit(2);
  }
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(verdict, null, 2) + '\n');
  }
  printVerdict(verdict);
  process.exit(verdict.pass ? 0 : 1);
}

module.exports = { checkGrounding };

if (require.main === module) main();
