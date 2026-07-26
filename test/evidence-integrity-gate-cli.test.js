'use strict';

// CLI/plumbing tests for the evidence-integrity gate (gap G39): group
// resolution, verdict emission, exit codes, and the fail-loud-on-empty-input
// rule (a gate that finds nothing to read must not report a pass).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, readVerdict } = require('../.claude/scripts/evidence-integrity-gate');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evid-'));
}

function write(root, rel, obj) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
  return abs;
}

const PW_CHECK = { id: 'PW-1', description: 'login flow', steps: [{ action: 'click' }] };

function contract(group = 'C', inner = { playwright_checks: [PW_CHECK] }) {
  return { group, stories: ['E1-S1'], features: ['F001'], contract: inner };
}

function verdictOf(root) {
  return readVerdict(root);
}

test('a clean run exits 0 and writes a passing verdict', () => {
  const root = tmp();
  write(root, 'sprint-contracts/C.json', contract());
  write(root, 'specs/reviews/evaluator-evidence.json', {
    group: 'C',
    checks: [{ id: 'PW-1', layer: 'playwright', verdict: 'pass', interactions: ['browser_click'] }],
  });
  assert.strictEqual(run(['--group', 'C'], root), 0);
  const v = verdictOf(root);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.gate, 'evidence-integrity');
  assert.strictEqual(v.group, 'C');
  assert.strictEqual(v.checked, 1);
});

test('a js-bypass run exits 1 and records the finding in the verdict', () => {
  const root = tmp();
  write(root, 'sprint-contracts/C.json', contract());
  write(root, 'specs/reviews/evaluator-evidence.json', {
    group: 'C',
    checks: [
      {
        id: 'PW-1',
        layer: 'playwright',
        verdict: 'pass',
        interactions: ['mcp__plugin_playwright_playwright__browser_evaluate'],
      },
    ],
  });
  assert.strictEqual(run(['--group', 'C'], root), 1);
  const v = verdictOf(root);
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.findings[0].kind, 'js-bypass');
  assert.ok(v.findings[0].fix);
});

test('the group is resolved from the ledger when --group is omitted', () => {
  const root = tmp();
  write(root, 'sprint-contracts/D.json', contract('D'));
  write(root, 'specs/reviews/evaluator-evidence.json', {
    group: 'D',
    checks: [{ id: 'PW-1', layer: 'playwright', verdict: 'pass', interactions: [] }],
  });
  assert.strictEqual(run([], root), 1);
  assert.strictEqual(verdictOf(root).group, 'D');
  assert.strictEqual(verdictOf(root).findings[0].kind, 'no-interaction-pass');
});

test('the runner passing only --files still resolves and runs', () => {
  const root = tmp();
  write(root, 'sprint-contracts/C.json', contract());
  write(root, 'specs/reviews/evaluator-evidence.json', {
    group: 'C',
    checks: [{ id: 'PW-1', layer: 'playwright', verdict: 'pass', interactions: ['browser_click'] }],
  });
  assert.strictEqual(run(['--files', 'src/a.ts', 'src/b.ts'], root), 0);
  assert.strictEqual(verdictOf(root).pass, true);
});

test('contracts with playwright checks but no ledger at all BLOCK', () => {
  const root = tmp();
  write(root, 'sprint-contracts/C.json', contract());
  assert.strictEqual(run([], root), 1);
  const v = verdictOf(root);
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.findings[0].kind, 'missing-ledger');
});

test('the worst group decides the verdict when no ledger names a group', () => {
  const root = tmp();
  write(root, 'sprint-contracts/A.json', contract('A', { api_checks: [] }));
  write(root, 'sprint-contracts/B.json', contract('B'));
  assert.strictEqual(run([], root), 1);
  assert.strictEqual(verdictOf(root).group, 'B');
});

test('a project with no sprint contracts is not applicable, and says so', () => {
  const root = tmp();
  assert.strictEqual(run([], root), 0);
  const v = verdictOf(root);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.applicable, false);
  assert.match(v.summary, /no sprint contract/i);
});

test('a contract with no playwright checks is not applicable', () => {
  const root = tmp();
  write(root, 'sprint-contracts/C.json', contract('C', { api_checks: [] }));
  assert.strictEqual(run(['--group', 'C'], root), 0);
  assert.strictEqual(verdictOf(root).applicable, false);
});

test('an explicit --group with no contract file is an IO error, not a pass', () => {
  const root = tmp();
  write(root, 'sprint-contracts/C.json', contract());
  assert.strictEqual(run(['--group', 'ZZ'], root), 2);
});

test('a malformed contract is an IO error, not a pass', () => {
  const root = tmp();
  const abs = path.join(root, 'sprint-contracts', 'C.json');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, '{ not json');
  assert.strictEqual(run(['--group', 'C'], root), 2);
});

test('a malformed evidence ledger is an IO error, not a silent missing-ledger', () => {
  const root = tmp();
  write(root, 'sprint-contracts/C.json', contract());
  const abs = path.join(root, 'specs', 'reviews', 'evaluator-evidence.json');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, '{ not json');
  assert.strictEqual(run(['--group', 'C'], root), 2);
});

test('untested checks are reported on the verdict without blocking', () => {
  const root = tmp();
  write(root, 'sprint-contracts/C.json', contract());
  write(root, 'specs/reviews/evaluator-evidence.json', {
    group: 'C',
    checks: [{ id: 'PW-1', layer: 'playwright', verdict: 'untested', interactions: [] }],
  });
  assert.strictEqual(run(['--group', 'C'], root), 0);
  assert.deepStrictEqual(verdictOf(root).untested, ['PW-1']);
});
