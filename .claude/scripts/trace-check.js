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

// The BRD carries two id spaces, and a milestone scope has to join across them.
//   brd-requirements.json -> keyed on the spine id (`FRD-1`), carrying the PRD's
//                    own identifier in `label` (`FR-1`).
//   brd-milestones.json#requirements and brd-acceptance.json#requirement -> the
//                    PRD label.
// `/spec` copies the milestone's list into `requirements_in_scope`, so a scope
// always arrives in label space while `--required` may be in either.
//
// `label` is written by brd-adopt.js. Parsing it back out of `section` is the
// fallback for spines adopted before that field existed: the adopter builds that
// string deterministically and shortlink-prd-roundtrip pins the format.
const SECTION_LABEL = /\/\s*((?:FR|NFR)-[\w.]+)(?:\s+AC)?\s*$/;

function labelFromSection(section) {
  const m = String(section || '').match(SECTION_LABEL);
  return m ? m[1] : null;
}

// Every id an item can legitimately be selected by. `label` is honoured first so
// an artifact that states its label explicitly never depends on the section
// convention; parsing `section` is the fallback for adopter output, which builds
// that string deterministically and has it pinned by shortlink-prd-roundtrip.
function scopeKeysOf(item) {
  return [item.id, item.label, item.requirement, labelFromSection(item.section)].filter(Boolean);
}

// The declared in-scope id list, or a thrown error naming why it cannot be used.
// Both throws are vacuous-pass guards: a scope that selects nothing would leave
// the gate reporting PASS over an empty required set.
function scopeIdsFrom(scope, source) {
  const inScope = scope && scope.milestone && scope.milestone.requirements_in_scope;
  if (!Array.isArray(inScope)) {
    throw new Error(`${source}: no milestone.requirements_in_scope — not a /spec decisions file`);
  }
  if (inScope.length === 0) {
    throw new Error(`${source}: milestone.requirements_in_scope is empty — a scope covering nothing would pass this gate vacuously`);
  }
  return inScope;
}

// A scope id matching no record is REPORTED, not thrown, because the two gates
// this scopes differ on what it means. Against brd-requirements.json it is a
// stale decisions file. Against brd-acceptance.json it is the ordinary case of a
// requirement with no postcondition — the shortlink BRD reaches /spec with seven
// of them, and throwing would block the acceptance gate for doing its job.
// Either way the ids travel in the verdict and print, so neither disappears.
/**
 * Narrow `required` to one milestone's requirement set.
 *
 * /spec's D1 routinely expands a single milestone to story depth and leaves the
 * rest at epic granularity. Run unscoped against that story set, this gate
 * reports every deferred requirement as `dropped` and can never pass — so the
 * only routes were re-running /brd or hand-building a narrowed `--required`
 * file. A live run took the second: the renderer fabricated an in-scope file the
 * skill never specified, the gate went green on inputs it had chosen, and
 * nothing recorded that 18 of 24 requirements went unchecked.
 *
 * Deferred ids become `optional` — still valid trace targets, so a story may
 * legitimately reference one, but no longer required to be covered. The
 * narrowing travels in the verdict, because a gate that does not say what it
 * stopped checking reads as full coverage.
 */
function applyScope({ required, optional, scope, source }) {
  const requiredItems = asArray(required);
  const wanted = new Set(scopeIdsFrom(scope, source));
  const isWanted = (r) => scopeKeysOf(r).some((k) => wanted.has(k));
  const matched = requiredItems.filter(isWanted);
  if (matched.length === 0) {
    throw new Error(`${source}: milestone.requirements_in_scope matches no record in --required — nothing would be checked`);
  }
  const known = new Set(requiredItems.flatMap(scopeKeysOf));
  const deferred = requiredItems.filter((r) => !isWanted(r));
  return {
    required: matched,
    optional: [...asArray(optional), ...deferred],
    scope: {
      source,
      milestone: (scope.milestone.name || null),
      in_scope: matched.length,
      deferred: deferred.length,
      deferred_ids: deferred.map((r) => r.id),
      unmatched_ids: [...wanted].filter((id) => !known.has(id)),
    },
  };
}

// Pure core. required/optional/downstream are arrays of { id, text?, traces? }.
function checkTraces({ required, optional, downstream, layer, scope }) {
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
    scope: scope || null,
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
  const scoped = v.scope
    ? ` [scoped to ${v.scope.milestone || 'milestone'}, ${v.scope.deferred} deferred]`
    : '';
  process.stdout.write(
    `${label}: ${v.pass ? 'PASS' : 'FAIL'}${scoped} — ` +
      `${v.required_covered}/${v.required_total} upstream covered, ` +
      `${v.net_new.length} net-new, ${v.dropped.length} dropped\n`
  );
  if (v.scope && v.scope.deferred) {
    process.stdout.write(`  DEFERRED (not checked here): ${v.scope.deferred_ids.join(', ')}\n`);
  }
  if (v.scope && v.scope.unmatched_ids.length) {
    process.stdout.write(`  UNMATCHED (in scope, no record in --required): ${v.scope.unmatched_ids.join(', ')}\n`);
  }
  for (const n of v.net_new) process.stdout.write(`  NET-NEW  ${n.id}: ${n.reason}\n`);
  for (const d of v.dropped) process.stdout.write(`  DROPPED  ${d.id}: ${d.text}\n`);
}

// The upstream side of the run: every `--required` file pooled, `--optional`
// if given, and the `--scope` narrowing applied when asked for.
function loadUpstream(args) {
  const required = loadRequired(args.required);
  const optional = readJson(args.optional, true);
  if (!args.scope) return { required, optional, scope: null };
  return applyScope({
    required,
    optional,
    scope: readJson(args.scope, false),
    source: args.scope,
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let verdict;
  try {
    const upstream = loadUpstream(args);
    verdict = checkTraces({
      ...upstream,
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

module.exports = { checkTraces, applyScope };

if (require.main === module) main();
