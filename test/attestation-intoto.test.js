'use strict';

// C2: the attestation is emitted as an in-toto Statement rather than a bespoke JSON shape.
//
// Why in-toto and NOT a SLSA provenance predicate: SLSA provenance describes how an
// ARTIFACT was built by a trusted builder. This bundle is control evidence about a
// COMMIT — a different claim. in-toto's Statement envelope exists precisely to carry
// custom predicates, so we adopt the standard envelope (recognisable, cosign-signable)
// with our own documented predicateType, and do not misuse a build-provenance schema.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  toInTotoStatement, fromInTotoStatement, isInTotoStatement,
  IN_TOTO_STATEMENT_TYPE, PREDICATE_TYPE,
} = require('../.claude/scripts/attestation-bundle');

const BUNDLE = {
  schema_version: 1,
  repo: 'acme/widgets',
  commit_sha: 'deadbeefcafe0001',
  generated_at: '2026-07-23T00:00:00.000Z',
  harness_version: '3.0.0',
  status: 'compliant',
  compliant: true,
  control_inventory: { total: 132, guides: 44, sensors: 88 },
  integrity: { algo: 'sha256', hash: 'abc123' },
};

test('the statement carries the in-toto v1 type', () => {
  const s = toInTotoStatement(BUNDLE);
  assert.strictEqual(s._type, IN_TOTO_STATEMENT_TYPE);
  assert.match(s._type, /in-toto\.io\/Statement\/v1/);
});

test('the subject is the COMMIT, identified by a gitCommit digest', () => {
  const s = toInTotoStatement(BUNDLE);
  assert.strictEqual(s.subject.length, 1);
  assert.strictEqual(s.subject[0].name, 'git+https://github.com/acme/widgets');
  assert.strictEqual(s.subject[0].digest.gitCommit, 'deadbeefcafe0001');
});

test('the predicateType is ours, not a SLSA provenance URI', () => {
  const s = toInTotoStatement(BUNDLE);
  assert.strictEqual(s.predicateType, PREDICATE_TYPE);
  assert.doesNotMatch(s.predicateType, /slsa\.dev\/provenance/,
    'this is control evidence about a commit, not build provenance for an artifact');
});

test('the predicate is the bundle body, minus the fields the envelope now owns', () => {
  const s = toInTotoStatement(BUNDLE);
  assert.strictEqual(s.predicate.status, 'compliant');
  assert.deepStrictEqual(s.predicate.control_inventory, BUNDLE.control_inventory);
  assert.ok(!('_type' in s.predicate));
});

test('round-trip: fromInTotoStatement recovers the bundle', () => {
  const recovered = fromInTotoStatement(toInTotoStatement(BUNDLE));
  assert.strictEqual(recovered.repo, BUNDLE.repo);
  assert.strictEqual(recovered.commit_sha, BUNDLE.commit_sha);
  assert.strictEqual(recovered.compliant, true);
  assert.deepStrictEqual(recovered.control_inventory, BUNDLE.control_inventory);
});

test('isInTotoStatement distinguishes the two on-disk shapes', () => {
  assert.strictEqual(isInTotoStatement(toInTotoStatement(BUNDLE)), true);
  assert.strictEqual(isInTotoStatement(BUNDLE), false, 'a legacy bundle must still be recognised as legacy');
});

test('fromInTotoStatement passes a legacy bundle through unchanged', () => {
  // Attestations written before C2 must stay readable and verifiable; an auditor
  // holding last quarter's evidence should not need this quarter's tooling.
  assert.deepStrictEqual(fromInTotoStatement(BUNDLE), BUNDLE);
});

test('a malformed statement is rejected rather than silently treated as empty evidence', () => {
  assert.throws(() => fromInTotoStatement({ _type: IN_TOTO_STATEMENT_TYPE, predicateType: PREDICATE_TYPE }),
    /predicate/i, 'a statement with no predicate carries no evidence and must not read as compliant');
});

test('a statement with a foreign predicateType is rejected', () => {
  const s = toInTotoStatement(BUNDLE);
  s.predicateType = 'https://slsa.dev/provenance/v1';
  assert.throws(() => fromInTotoStatement(s), /predicateType/i,
    'reading someone else\'s predicate as our evidence would be a silent category error');
});

test('the subject name degrades safely when the repo slug is unknown', () => {
  const s = toInTotoStatement({ ...BUNDLE, repo: null });
  assert.strictEqual(s.subject[0].name, 'git+unknown');
  assert.strictEqual(s.subject[0].digest.gitCommit, BUNDLE.commit_sha);
});
