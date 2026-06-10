#!/usr/bin/env node

'use strict';

// Generic groundedness engine for the planning pipeline.
//
// Every downstream artifact (stories, design components, test cases) must trace
// back, by stable id, to the layer above it — the same discipline the BRD uses
// against the FRD. This proves it mechanically, not by LLM judgement:
//
//   net_new — a downstream item whose `traces` is empty or points at an id that
//             exists in no upstream layer. An invented item (scope creep): it
//             must not pass without explicit human sign-off.
//   dropped — a `required` upstream id that no downstream item traces back to.
//             A silently lost requirement.
//
// pass = net_new is empty AND dropped is empty. Both directions block, because a
// gap at any link cascades to every link below it.
//
// `required` ids must all be covered (e.g. BRD requirements -> stories).
// `optional` ids are valid trace targets but need not be covered (e.g. a
// clarification, or a design decision that legitimately elaborates a story).

const fs = require('fs');
const path = require('path');

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function idSet(items) {
  return new Set(asArray(items).map((r) => r.id));
}

function netNewReason(traces) {
  return traces.length === 0
    ? 'no traces — not grounded in any upstream artifact'
    : `traces (${traces.join(', ')}) resolve to no upstream id`;
}

// Returns { net_new: [...], covered: Set<id> } for the given downstream items.
function classify(downstream, groundedIds) {
  const net_new = [];
  const covered = new Set();
  for (const item of asArray(downstream)) {
    const traces = asArray(item.traces).filter((t) => t != null && t !== '');
    const valid = traces.filter((t) => groundedIds.has(t));
    if (valid.length === 0) {
      net_new.push({ id: item.id, text: item.text || '', reason: netNewReason(traces) });
    }
    for (const t of valid) covered.add(t);
  }
  return { net_new, covered };
}

// Pure core. required/optional/downstream are arrays of { id, text?, traces? }.
function checkTraces({ required, optional, downstream, layer }) {
  const requiredItems = asArray(required);
  const optionalItems = asArray(optional);
  const groundedIds = new Set([...idSet(requiredItems), ...idSet(optionalItems)]);

  const { net_new, covered } = classify(downstream, groundedIds);
  const dropped = requiredItems
    .filter((r) => !covered.has(r.id))
    .map((r) => (r.section ? { id: r.id, text: r.text || '', section: r.section } : { id: r.id, text: r.text || '' }));

  return {
    layer: layer || null,
    pass: net_new.length === 0 && dropped.length === 0,
    required_total: requiredItems.length,
    required_covered: requiredItems.filter((r) => covered.has(r.id)).length,
    downstream_total: asArray(downstream).length,
    net_new,
    dropped,
  };
}

// --- CLI ----------------------------------------------------------------------

function parseArgs(argv) {
  const args = { required: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key || !key.startsWith('--')) continue;
    const name = key.slice(2);
    if (name === 'required') args.required.push(argv[i + 1]);
    else args[name] = argv[i + 1];
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

function loadRequired(files) {
  return asArray(files).flatMap((f) => readJson(f, false));
}

function printVerdict(v) {
  const label = v.layer ? `${v.layer} grounding` : 'grounding';
  process.stdout.write(
    `${label}: ${v.pass ? 'PASS' : 'FAIL'} — ` +
      `${v.required_covered}/${v.required_total} upstream covered, ` +
      `${v.net_new.length} net-new, ${v.dropped.length} dropped\n`
  );
  for (const n of v.net_new) process.stdout.write(`  NET-NEW  ${n.id}: ${n.reason}\n`);
  for (const d of v.dropped) process.stdout.write(`  DROPPED  ${d.id}: ${d.text}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let verdict;
  try {
    verdict = checkTraces({
      required: loadRequired(args.required),
      optional: readJson(args.optional, true),
      downstream: readJson(args.downstream, false),
      layer: args.layer,
    });
  } catch (err) {
    process.stderr.write(`trace-check: ${err.message}\n`);
    process.exit(2);
  }
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(verdict, null, 2) + '\n');
  }
  printVerdict(verdict);
  process.exit(verdict.pass ? 0 : 1);
}

module.exports = { checkTraces };

if (require.main === module) main();
