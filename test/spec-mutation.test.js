'use strict';

// Spec mutation (SwarmForge pickup #2).
//
// The hardener role in swarm-forge runs `gherkin-mutator`: it perturbs the
// ACCEPTANCE SPEC's example values and requires the suite to notice. Our
// mutation-gate mutates code; nothing mutated the contract. The difference
// matters because our recurring defect is not "the code is wrong" — it is "the
// check was never wired to anything, and everything was green the whole time":
// a gate that read a FLAT contract while real sprint contracts nest under a
// `contract` key, passing because it found zero checks to fail.
//
// A surviving mutant is that defect, made visible: the expected value was
// corrupted and the verification still passed, so that criterion is decorative.

const assert = require('assert');
const { test } = require('node:test');

const {
  applyMutation,
  classifyResults,
  mutantsFor,
  perturb,
  readChecks,
} = require('../.claude/hooks/lib/spec-mutation.js');

const CONTRACT = {
  group: 'A',
  stories: ['E1-S1'],
  contract: {
    api_checks: [
      { id: 'E1-S1-AC1', method: 'POST', path: '/auth/sign-in', expected_status: 200 },
      { id: 'E1-S1-AC2', method: 'GET', path: '/healthz', expected_status: 200, expected_body: { ok: true } },
    ],
    performance_checks: [{ endpoint: '/healthz', method: 'GET', max_response_time_ms: 500 }],
  },
};

// ---- reading the real shape ----

test('checks are read from the nested `contract` key, the shape real contracts use', () => {
  const checks = readChecks(CONTRACT);
  assert.equal(checks.length, 3, 'two api checks and one performance check');
  assert.ok(checks.some((c) => c.id === 'E1-S1-AC1' && c.kind === 'api'));
  assert.ok(checks.some((c) => c.kind === 'performance'));
});

test('a FLAT contract is an error, never a silent empty pass', () => {
  // This is the bug the control exists for. A reader that quietly accepts both
  // shapes finds zero checks in a malformed contract and reports success.
  const flat = { group: 'A', api_checks: [{ id: 'x', expected_status: 200 }] };
  assert.throws(() => readChecks(flat), /top level/i);
});

test('an empty contract is an error — a gate with no input must fail loud', () => {
  assert.throws(() => readChecks({ group: 'A', contract: {} }), /no checks/i);
});

// ---- perturbation ----

test('a perturbed value is always different from the original', () => {
  for (const v of [200, 0, -1, 'ok', true, false]) {
    assert.notDeepEqual(perturb(v), v, `perturb(${JSON.stringify(v)}) must differ`);
  }
});

test('a status code is perturbed to another VALID code, not to nonsense', () => {
  // 200 -> 599 would be rejected by a schema before any check ran, and the
  // mutant would "die" for the wrong reason: a false kill is worse than none.
  const mutated = perturb(200, 'expected_status');
  assert.notEqual(mutated, 200);
  assert.ok(mutated >= 100 && mutated <= 599, `${mutated} must still be a status code`);
});

test('a latency budget is perturbed DOWNWARD — that is the direction that must fail', () => {
  assert.ok(perturb(500, 'max_response_time_ms') < 500,
    'raising a budget cannot fail; only tightening it discriminates');
});

// ---- mutants ----

test('one mutant per mutable field, each naming what it changed', () => {
  const mutants = mutantsFor(CONTRACT);
  assert.ok(mutants.length >= 4, `expected a mutant per field, got ${mutants.length}`);
  const first = mutants[0];
  assert.ok(first.checkId, 'a mutant must name the check it corrupts');
  assert.ok(first.field, 'and the field');
  assert.notDeepEqual(first.mutated, first.original);
});

test('applying a mutant changes exactly one value and leaves the rest intact', () => {
  const mutant = mutantsFor(CONTRACT).find((m) => m.field === 'expected_status');
  const applied = applyMutation(CONTRACT, mutant);

  assert.notEqual(applied.contract.api_checks[0].expected_status,
    CONTRACT.contract.api_checks[0].expected_status);
  assert.equal(applied.contract.api_checks[1].expected_status, 200, 'the sibling check is untouched');
  assert.equal(applied.group, 'A');
  assert.equal(CONTRACT.contract.api_checks[0].expected_status, 200,
    'the original contract object must not be mutated in place');
});

test('a nested expected_body value is mutable, not just top-level scalars', () => {
  const mutants = mutantsFor(CONTRACT);
  const bodyMutant = mutants.find((m) => m.field.startsWith('expected_body'));
  assert.ok(bodyMutant, 'expected_body.ok must be reachable');
  const applied = applyMutation(CONTRACT, bodyMutant);
  assert.notEqual(applied.contract.api_checks[1].expected_body.ok, true);
});

// ---- the verdict ----

test('a mutant the verification still PASSES is a survivor — the check does not bite', () => {
  const verdict = classifyResults([
    { checkId: 'E1-S1-AC1', field: 'expected_status', verificationPassed: true },
    { checkId: 'E1-S1-AC2', field: 'expected_status', verificationPassed: false },
  ]);
  assert.equal(verdict.survivors.length, 1);
  assert.equal(verdict.survivors[0].checkId, 'E1-S1-AC1');
  assert.equal(verdict.killed, 1);
  assert.match(verdict.summary, /E1-S1-AC1/);
});

test('every mutant killed is a clean verdict', () => {
  const verdict = classifyResults([{ checkId: 'a', field: 'f', verificationPassed: false }]);
  assert.equal(verdict.survivors.length, 0);
  assert.equal(verdict.clean, true);
});

test('a verification that errored is not counted as a kill', () => {
  // An exit code from a crashed runner is not evidence the check discriminates.
  const verdict = classifyResults([
    { checkId: 'a', field: 'f', verificationPassed: false, errored: true },
  ]);
  assert.equal(verdict.killed, 0);
  assert.equal(verdict.inconclusive, 1);
  assert.equal(verdict.clean, false, 'an inconclusive run must not read as a pass');
});
