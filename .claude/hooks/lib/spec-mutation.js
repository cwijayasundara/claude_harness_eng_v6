'use strict';

// Spec mutation — pure generation and classification (no filesystem, no runner).
//
// The code-mutation gate asks "does the suite notice when the CODE changes?".
// This asks the question one level up: does the verification notice when the
// CONTRACT changes? A criterion whose expected value can be corrupted while
// everything still passes is not verifying anything — it is decoration that
// reads as coverage.
//
// That is this harness's recurring defect rather than a hypothetical: a gate
// once shipped reading a FLAT contract while real sprint contracts nest their
// checks under a `contract` key. It found zero checks, failed nothing, and was
// green for as long as it existed. Hence `readChecks` refuses the flat shape
// loudly instead of accepting both — a reader that tolerates every shape can
// never report that it was handed the wrong one.

const STATUS_FIELD = 'expected_status';
const BUDGET_FIELDS = new Set(['max_response_time_ms', 'max_p95_ms']);

/** A different value of the same type — the mutation must be a real change. */
function perturb(value, field) {
  if (field === STATUS_FIELD && typeof value === 'number') {
    // Stay inside the valid status range: a mutant rejected by schema validation
    // before any check runs would "die" for the wrong reason — a false kill.
    return value === 503 ? 200 : 503;
  }
  if (BUDGET_FIELDS.has(field) && typeof value === 'number') {
    // Only tightening a budget can fail. Raising one is unfalsifiable.
    return 1;
  }
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'string') return `${value}-harness-mutant`;
  return null;
}

function isMutableScalar(value) {
  return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string';
}

/** Dotted paths to every mutable scalar inside an object (depth-first). */
function scalarPaths(value, prefix) {
  if (isMutableScalar(value)) return [prefix];
  if (!value || typeof value !== 'object') return [];
  const out = [];
  for (const [key, child] of Object.entries(value)) {
    out.push(...scalarPaths(child, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

function checksOfKind(block, key, kind) {
  const list = Array.isArray(block[key]) ? block[key] : [];
  return list.map((check, index) => ({ kind, index, listKey: key, id: check.id || `${kind}-${index}`, check }));
}

/**
 * Every check in a sprint contract, read from the nested `contract` key.
 * Throws on the flat shape and on an empty contract — both are malformed input,
 * and a gate that returns an empty list for malformed input passes vacuously.
 */
function readChecks(contract) {
  if (!contract || typeof contract !== 'object') throw new Error('spec-mutation: contract is not an object');

  const block = contract.contract;
  if (!block || typeof block !== 'object') {
    const flatKeys = Object.keys(contract).filter((k) => k.endsWith('_checks'));
    if (flatKeys.length > 0) {
      throw new Error(
        `spec-mutation: checks found at the top level (${flatKeys.join(', ')}) but a sprint contract `
        + 'nests them under the `contract` key. Reading the flat shape is how a gate finds zero '
        + 'checks and passes everything.');
    }
    throw new Error('spec-mutation: no `contract` key — not a sprint contract');
  }

  const checks = [
    ...checksOfKind(block, 'api_checks', 'api'),
    ...checksOfKind(block, 'performance_checks', 'performance'),
  ];
  if (checks.length === 0) {
    throw new Error('spec-mutation: no checks in the contract — nothing to mutate (fail loud, not vacuous)');
  }
  return checks;
}

/** Fields worth mutating on one check: the expectations, never the addressing. */
function mutableFields(check) {
  const fields = [];
  for (const key of ['expected_status', 'max_response_time_ms', 'max_p95_ms']) {
    if (isMutableScalar(check[key])) fields.push(key);
  }
  for (const p of scalarPaths(check.expected_body, 'expected_body')) fields.push(p);
  return fields;
}

function valueAt(obj, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function setAt(obj, dottedPath, value) {
  const keys = dottedPath.split('.');
  const last = keys.pop();
  const parent = keys.reduce((acc, key) => acc[key], obj);
  parent[last] = value;
}

/**
 * One mutant per mutable expectation. Playwright and design checks are NOT
 * mutated: their expectations are prose an automated perturbation cannot
 * corrupt meaningfully. Stated here rather than left as a silent gap.
 */
function mutantsFor(contract) {
  const mutants = [];
  for (const { kind, listKey, index, id, check } of readChecks(contract)) {
    for (const field of mutableFields(check)) {
      const original = valueAt(check, field);
      const mutated = perturb(original, field.split('.').pop());
      if (mutated === null || mutated === original) continue;
      mutants.push({ kind, listKey, index, checkId: id, field, original, mutated });
    }
  }
  return mutants;
}

/** A deep copy of `contract` with exactly one expectation corrupted. */
function applyMutation(contract, mutant) {
  const copy = JSON.parse(JSON.stringify(contract));
  setAt(copy.contract[mutant.listKey][mutant.index], mutant.field, mutant.mutated);
  return copy;
}

/**
 * Verdict over per-mutant verification outcomes.
 * A mutant is KILLED when verification failed, a SURVIVOR when it passed, and
 * INCONCLUSIVE when the runner itself errored — a crashed runner is not
 * evidence that a check discriminates.
 */
function classifyResults(results) {
  const survivors = [];
  let killed = 0;
  let inconclusive = 0;

  for (const r of results || []) {
    if (r.errored) { inconclusive += 1; continue; }
    if (r.verificationPassed) survivors.push({ checkId: r.checkId, field: r.field });
    else killed += 1;
  }

  const summary = survivors.length === 0
    ? `spec-mutation: ${killed} mutant(s) killed, 0 survivors`
    : `spec-mutation: ${survivors.length} surviving mutant(s) — `
      + `${survivors.map((s) => `${s.checkId}.${s.field}`).join(', ')}. `
      + 'The expected value was corrupted and verification still passed, so that criterion '
      + 'verifies nothing. Wire the check to a real assertion or delete it.';

  return {
    survivors,
    killed,
    inconclusive,
    clean: survivors.length === 0 && inconclusive === 0,
    summary,
  };
}

module.exports = {
  applyMutation,
  classifyResults,
  mutableFields,
  mutantsFor,
  perturb,
  readChecks,
};
