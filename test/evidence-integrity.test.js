'use strict';

// Pure-classification tests for the evidence-integrity sensor (gap G39).
//
// Every contract fixture here is round-tripped through the REAL schema
// validator before it is fed to the gate (CLAUDE.md principle 5): real sprint
// contracts nest their checks under a `contract` key, and a flat fixture would
// keep these tests green while the gate read nothing at all.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { classifyEvidence } = require('../.claude/hooks/lib/evidence-integrity');
const { validate } = require('../.claude/hooks/lib/contract-schema');

const SCHEMA = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'skills', 'evaluate', 'references', 'contract-schema.json'),
    'utf8'
  )
);

const PW_CHECK = {
  id: 'PW-1',
  description: 'login flow reaches the dashboard',
  steps: [{ action: 'click', selector: 'Sign in', assertion: 'dashboard visible' }],
};

function contractWith(inner) {
  const c = { group: 'C', stories: ['E1-S1'], features: ['F001'], contract: inner };
  const errors = validate(SCHEMA, c);
  assert.deepStrictEqual(errors, [], `fixture is not a real contract: ${errors.join('; ')}`);
  return c;
}

function ledger(checks, group = 'C') {
  return { group, checks };
}

function kinds(findings) {
  return findings.map((f) => f.kind).sort();
}

test('fixture contracts validate against the real contract schema', () => {
  assert.deepStrictEqual(validate(SCHEMA, contractWith({ playwright_checks: [PW_CHECK] })), []);
});

test('a pass backed by real user-path interaction is clean', () => {
  const v = classifyEvidence({
    contract: contractWith({ playwright_checks: [PW_CHECK] }),
    ledger: ledger([
      {
        id: 'PW-1',
        layer: 'playwright',
        verdict: 'pass',
        interactions: ['browser_navigate', 'browser_click', 'browser_snapshot'],
      },
    ]),
  });
  assert.strictEqual(v.pass, true, JSON.stringify(v.findings));
  assert.strictEqual(v.checked, 1);
});

test('full MCP tool names are recognised as interactions', () => {
  const v = classifyEvidence({
    contract: contractWith({ playwright_checks: [PW_CHECK] }),
    ledger: ledger([
      {
        id: 'PW-1',
        layer: 'playwright',
        verdict: 'pass',
        interactions: [
          'mcp__plugin_playwright_playwright__browser_navigate',
          'mcp__plugin_playwright_playwright__browser_click',
        ],
      },
    ]),
  });
  assert.strictEqual(v.pass, true, JSON.stringify(v.findings));
});

test('js-bypass: a functional check satisfied via browser_evaluate BLOCKs', () => {
  const v = classifyEvidence({
    contract: contractWith({ playwright_checks: [PW_CHECK] }),
    ledger: ledger([
      {
        id: 'PW-1',
        layer: 'playwright',
        verdict: 'pass',
        interactions: ['browser_navigate', 'mcp__plugin_playwright_playwright__browser_evaluate'],
      },
    ]),
  });
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(kinds(v.findings), ['js-bypass']);
  assert.strictEqual(v.findings[0].id, 'PW-1');
});

test('js-bypass fires even when the contract does carry an accessibility block', () => {
  // The axe exemption belongs to the accessibility layer, never to a functional
  // playwright check — otherwise an a11y block would launder every bypass.
  const v = classifyEvidence({
    contract: contractWith({
      playwright_checks: [PW_CHECK],
      accessibility_checks: { required: true, urls: ['/'] },
    }),
    ledger: ledger([
      {
        id: 'PW-1',
        layer: 'playwright',
        verdict: 'pass',
        interactions: ['browser_click', 'browser_evaluate'],
        evaluate_purpose: 'axe-core',
      },
    ]),
  });
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(kinds(v.findings), ['js-bypass']);
});

test('axe on the accessibility layer is permitted when the contract asks for it', () => {
  const v = classifyEvidence({
    contract: contractWith({
      playwright_checks: [PW_CHECK],
      accessibility_checks: { required: true, urls: ['/'] },
    }),
    ledger: ledger([
      { id: 'PW-1', layer: 'playwright', verdict: 'pass', interactions: ['browser_click'] },
      {
        id: 'A11Y-1',
        layer: 'accessibility',
        verdict: 'pass',
        interactions: ['browser_navigate', 'browser_evaluate'],
        evaluate_purpose: 'axe-core',
      },
    ]),
  });
  assert.strictEqual(v.pass, true, JSON.stringify(v.findings));
});

test('unbacked-axe: an accessibility entry with no accessibility_checks in the contract BLOCKs', () => {
  const v = classifyEvidence({
    contract: contractWith({ playwright_checks: [PW_CHECK] }),
    ledger: ledger([
      { id: 'PW-1', layer: 'playwright', verdict: 'pass', interactions: ['browser_click'] },
      {
        id: 'A11Y-1',
        layer: 'accessibility',
        verdict: 'pass',
        interactions: ['browser_evaluate'],
        evaluate_purpose: 'axe-core',
      },
    ]),
  });
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(kinds(v.findings), ['unbacked-axe']);
});

test('no-interaction-pass: a claimed pass that never touched the app BLOCKs', () => {
  const v = classifyEvidence({
    contract: contractWith({ playwright_checks: [PW_CHECK] }),
    ledger: ledger([{ id: 'PW-1', layer: 'playwright', verdict: 'pass', interactions: [] }]),
  });
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(kinds(v.findings), ['no-interaction-pass']);
});

test('no-interaction-pass does not double-report a js-bypass entry', () => {
  const v = classifyEvidence({
    contract: contractWith({ playwright_checks: [PW_CHECK] }),
    ledger: ledger([
      { id: 'PW-1', layer: 'playwright', verdict: 'pass', interactions: ['browser_evaluate'] },
    ]),
  });
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(kinds(v.findings), ['js-bypass']);
});

test('a fail or untested verdict needs no interaction evidence', () => {
  const v = classifyEvidence({
    contract: contractWith({ playwright_checks: [PW_CHECK, { ...PW_CHECK, id: 'PW-2' }] }),
    ledger: ledger([
      { id: 'PW-1', layer: 'playwright', verdict: 'fail', interactions: [] },
      { id: 'PW-2', layer: 'playwright', verdict: 'untested', interactions: [] },
    ]),
  });
  assert.strictEqual(v.pass, true, JSON.stringify(v.findings));
  assert.deepStrictEqual(v.untested, ['PW-2']);
});

test('missing-evidence: a contracted check with no ledger entry BLOCKs', () => {
  const v = classifyEvidence({
    contract: contractWith({ playwright_checks: [PW_CHECK, { ...PW_CHECK, id: 'PW-2' }] }),
    ledger: ledger([
      { id: 'PW-1', layer: 'playwright', verdict: 'pass', interactions: ['browser_click'] },
    ]),
  });
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(kinds(v.findings), ['missing-evidence']);
  assert.strictEqual(v.findings[0].id, 'PW-2');
});

test('undeclared-check: a ledger entry for a check the contract never declared BLOCKs', () => {
  const v = classifyEvidence({
    contract: contractWith({ playwright_checks: [PW_CHECK] }),
    ledger: ledger([
      { id: 'PW-1', layer: 'playwright', verdict: 'pass', interactions: ['browser_click'] },
      { id: 'PW-99', layer: 'playwright', verdict: 'pass', interactions: ['browser_click'] },
    ]),
  });
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(kinds(v.findings), ['undeclared-check']);
});

test('missing-ledger: contracted playwright checks with no ledger at all BLOCKs (never a vacuous pass)', () => {
  const contract = contractWith({ playwright_checks: [PW_CHECK] });
  for (const led of [null, undefined, {}, { group: 'C' }, { group: 'C', checks: [] }]) {
    const v = classifyEvidence({ contract, ledger: led });
    assert.strictEqual(v.pass, false, `ledger ${JSON.stringify(led)} must not pass`);
    assert.ok(kinds(v.findings).includes('missing-ledger'));
  }
});

test('group-mismatch: evidence recorded for a different group BLOCKs', () => {
  const v = classifyEvidence({
    contract: contractWith({ playwright_checks: [PW_CHECK] }),
    ledger: ledger(
      [{ id: 'PW-1', layer: 'playwright', verdict: 'pass', interactions: ['browser_click'] }],
      'B'
    ),
  });
  assert.strictEqual(v.pass, false);
  assert.ok(kinds(v.findings).includes('group-mismatch'));
});

test('a contract with no playwright_checks is not applicable, not a pass-by-default', () => {
  const v = classifyEvidence({
    contract: contractWith({
      api_checks: [{ id: 'API-1', method: 'GET', path: '/health', expected_status: 200 }],
    }),
    ledger: null,
  });
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.applicable, false);
  assert.deepStrictEqual(v.findings, []);
});

test('a missing contract is an error, not a pass', () => {
  const v = classifyEvidence({ contract: null, ledger: null });
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(kinds(v.findings), ['missing-contract']);
});

test('every finding carries an actionable remediation line', () => {
  const v = classifyEvidence({
    contract: contractWith({ playwright_checks: [PW_CHECK] }),
    ledger: ledger([
      { id: 'PW-1', layer: 'playwright', verdict: 'pass', interactions: ['browser_evaluate'] },
      { id: 'PW-99', layer: 'playwright', verdict: 'pass', interactions: ['browser_click'] },
    ]),
  });
  assert.strictEqual(v.findings.length, 2);
  for (const f of v.findings) {
    assert.ok(f.kind && f.detail && f.fix, `incomplete finding: ${JSON.stringify(f)}`);
  }
});
