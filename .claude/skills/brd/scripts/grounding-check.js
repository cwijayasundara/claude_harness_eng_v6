#!/usr/bin/env node

'use strict';

// Deterministic BRD-vs-FRD grounding check.
//
// The greenfield pipeline grounds everything to the BRD, but the BRD is itself
// generated from a Functional Requirements Document (FRD) plus the human's
// answers during interrogation. Those two — the FRD and the confirmed
// clarifications — are the ONLY sanctioned sources of truth. This script proves,
// mechanically (not by LLM judgement), that the generated BRD did not invent or
// drop anything relative to them:
//
//   net_new  — a BRD requirement whose `traces` is empty or points at an id that
//              exists in neither the FRD nor the clarification log. An invented
//              requirement: must not pass without explicit human sign-off.
//   dropped  — an FRD requirement that no BRD requirement traces back to. A
//              silently lost requirement.
//
// pass = net_new is empty AND dropped is empty. Both directions block, because a
// mistake here cascades through spec → design → test → implementation.
//
// Inputs are JSON arrays (produced by /brd ingestion):
//   frd-requirements.json    [{ id, text, section }]
//   clarification-log.json   [{ id, question, answer }]   (optional)
//   brd-requirements.json    [{ id, text, traces: [..] }]

const fs = require('fs');
const path = require('path');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function groundedIdSet(frdReqs, clarReqs) {
  return new Set([...frdReqs.map((r) => r.id), ...clarReqs.map((r) => r.id)]);
}

// A BRD requirement is grounded iff at least one of its traces resolves to a
// real FRD section or clarification id. Returns { covered: Set<id>, net_new: [] }.
function classifyBrd(brdReqs, groundedIds) {
  const covered = new Set();
  const net_new = [];
  for (const br of brdReqs) {
    const traces = asArray(br.traces).filter((t) => t != null && t !== '');
    const valid = traces.filter((t) => groundedIds.has(t));
    if (valid.length === 0) {
      net_new.push({ id: br.id, text: br.text || '', reason: netNewReason(traces) });
    }
    for (const t of valid) covered.add(t);
  }
  return { covered, net_new };
}

function netNewReason(traces) {
  return traces.length === 0
    ? 'no traces — not stated in the FRD and not confirmed in the clarification log'
    : `traces (${traces.join(', ')}) reference no real FRD section or clarification`;
}

// Pure core: returns the grounding verdict for the three requirement sets.
function checkGrounding(frd, clarifications, brd) {
  const frdReqs = asArray(frd);
  const clarReqs = asArray(clarifications);
  const brdReqs = asArray(brd);

  const { covered, net_new } = classifyBrd(brdReqs, groundedIdSet(frdReqs, clarReqs));
  const dropped = frdReqs
    .filter((r) => !covered.has(r.id))
    .map((r) => ({ id: r.id, text: r.text || '', section: r.section || '' }));

  return {
    pass: net_new.length === 0 && dropped.length === 0,
    frd_total: frdReqs.length,
    // count of FRD requirements covered (the `covered` set also holds clarification ids)
    frd_covered: frdReqs.filter((r) => covered.has(r.id)).length,
    brd_total: brdReqs.length,
    net_new,
    dropped,
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

function printVerdict(verdict) {
  process.stdout.write(
    `BRD grounding: ${verdict.pass ? 'PASS' : 'FAIL'} — ` +
      `${verdict.frd_covered}/${verdict.frd_total} FRD requirements covered, ` +
      `${verdict.net_new.length} net-new, ${verdict.dropped.length} dropped\n`
  );
  for (const n of verdict.net_new) process.stdout.write(`  NET-NEW  ${n.id}: ${n.reason}\n`);
  for (const d of verdict.dropped) process.stdout.write(`  DROPPED  ${d.id} (${d.section}): ${d.text}\n`);
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
