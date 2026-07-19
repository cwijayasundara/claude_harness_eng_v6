'use strict';

// C4 (Increment 2): the secure-baseline-wiring gate additionally requires a
// present, non-empty .github/CODEOWNERS when project-manifest.json#github
// .require_code_owner_review is true — otherwise the ruleset's code-owner rule is
// inert. This extends an existing control (no new control-budget entry).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const lib = require('../.claude/hooks/lib/security-baseline');
const strict = require('../.claude/hooks/lib/gates-strict');

const GOOD_WORKFLOW = [
  'name: Security', 'on:', '  pull_request:', 'jobs:',
  '  gitleaks:', '    runs-on: ubuntu-latest', '    steps:',
  '      - uses: gitleaks/gitleaks-action@v2',
  '  sast:', '    runs-on: ubuntu-latest', '    steps:',
  '      - run: semgrep ci --error', '',
].join('\n');

const base = { workflowText: GOOD_WORKFLOW, gitleaksTomlExists: true, sastEngine: 'semgrep' };

test('CODEOWNERS required + absent ⇒ violation', () => {
  const v = lib.wiringViolations({ ...base, requireCodeOwnerReview: true, codeownersText: null });
  assert.ok(v.some((x) => /CODEOWNERS/.test(x)), JSON.stringify(v));
});

test('CODEOWNERS required + comment-only/empty ⇒ violation', () => {
  const v = lib.wiringViolations({ ...base, requireCodeOwnerReview: true, codeownersText: '# comment only\n\n' });
  assert.ok(v.some((x) => /CODEOWNERS/.test(x)), JSON.stringify(v));
});

test('CODEOWNERS required + has a rule ⇒ clean', () => {
  const v = lib.wiringViolations({ ...base, requireCodeOwnerReview: true, codeownersText: '* @org/team\n' });
  assert.deepStrictEqual(v, []);
});

test('require_code_owner_review false/absent ⇒ CODEOWNERS not required', () => {
  assert.deepStrictEqual(lib.wiringViolations({ ...base, requireCodeOwnerReview: false, codeownersText: null }), []);
  assert.deepStrictEqual(lib.wiringViolations({ ...base }), []);
});

// Gate-level: the gates-strict caller reads github.require_code_owner_review from
// the target manifest and .github/CODEOWNERS from disk, and blocks via failBlock.
function mkProject({ codeowners, requireReview }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-'));
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'security.yml'), GOOD_WORKFLOW);
  fs.writeFileSync(path.join(dir, '.gitleaks.toml'), '[allowlist]\npaths = []\n');
  const manifest = { quality: { sast_engine: 'semgrep' }, github: { require_code_owner_review: requireReview } };
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify(manifest));
  if (codeowners !== undefined) {
    fs.writeFileSync(path.join(dir, '.github', 'CODEOWNERS'), codeowners);
  }
  return dir;
}

// checkSecureBaselineWiring calls failBlock (which throws in-hook). Capture by
// intercepting process.exit / thrown block — simplest is to assert it throws when
// a violation exists and does not when clean. failBlock throws a BlockError.
function runGate(dir) {
  let blocked = null;
  const origExit = process.exit;
  const origErr = process.stderr.write;
  const origOut = process.stdout.write;
  process.stderr.write = () => true;
  process.stdout.write = () => true;
  process.exit = (code) => { blocked = code; throw new Error('__exit__'); };
  try {
    strict.checkSecureBaselineWiring({ projectDir: dir });
  } catch (e) {
    if (e.message !== '__exit__') throw e;
  } finally {
    process.exit = origExit;
    process.stderr.write = origErr;
    process.stdout.write = origOut;
  }
  return blocked;
}

test('gate blocks when require_code_owner_review is true and CODEOWNERS is absent', () => {
  const dir = mkProject({ requireReview: true }); // no CODEOWNERS file
  assert.notStrictEqual(runGate(dir), null, 'expected the gate to block');
});

test('gate passes when require_code_owner_review is true and CODEOWNERS has a rule', () => {
  const dir = mkProject({ requireReview: true, codeowners: '* @org/team\n' });
  assert.strictEqual(runGate(dir), null, 'expected the gate to pass');
});

test('gate passes when require_code_owner_review is false and no CODEOWNERS', () => {
  const dir = mkProject({ requireReview: false });
  assert.strictEqual(runGate(dir), null);
});
