'use strict';

// Pure classification for the evidence-integrity sensor (gap G39). No fs, no
// git — plumbing lives in scripts/evidence-integrity-gate.js (the same split
// live-externals-gate.js and test-deletion-gate.js use).
//
// ONE invariant: a claimed PASS on a pre-committed sprint-contract browser check
// is backed by real user-path interaction against that exact check.
//
// The evaluator holds browser_evaluate (it needs it to inject axe-core), so it
// can satisfy a UI assertion by reading state or firing a handler in JS instead
// of driving the app — the "JavaScript cheating" failure mode Cognition
// documents for Devin's own computer-use testing. That silently voids the
// evaluator's black-box premise ("the running app produces the evidence").
//
// Three of the five findings (missing-evidence, undeclared-check,
// no-interaction-pass) are arithmetic against the read-only contract and do not
// depend on the evaluator describing its own method honestly. js-bypass and
// unbacked-axe do — they are the Devin-style pre-commitment control: cheap, and
// they catch the rationalising evaluator, not the determined one. Disclosed
// limitation, not hidden: full tamper-proofing needs the PostToolUse tap
// documented in HARNESS.md G39.

const EVALUATE = 'browser_evaluate';
const NON_INTERACTIONS = new Set([EVALUATE, 'browser_close']);
const AXE_PURPOSE = 'axe-core';

// Accepts both the bare tool name and the full MCP name
// (mcp__plugin_playwright_playwright__browser_click).
function toolName(raw) {
  const parts = String(raw || '').split('__');
  return parts[parts.length - 1];
}

function isEvaluate(tool) {
  return toolName(tool) === EVALUATE;
}

function isInteraction(tool) {
  const name = toolName(tool);
  return name.startsWith('browser_') && !NON_INTERACTIONS.has(name);
}

function finding(kind, id, detail, fix) {
  return { kind, id, detail, fix };
}

// Real sprint contracts nest their checks under `contract` (see
// skills/evaluate/references/contract-schema.json). A flat object is tolerated
// so a hand-written probe still works, but the nested shape is the real one.
function innerContract(contract) {
  return (contract && contract.contract) || contract || {};
}

function checkJsBypass(entry) {
  const used = (entry.interactions || []).filter(isEvaluate);
  if (used.length === 0) return null;
  return finding(
    'js-bypass',
    entry.id,
    `functional playwright check "${entry.id}" recorded ${EVALUATE} (${used.join(', ')}) — ` +
      'a UI assertion satisfied in JavaScript instead of through the user path',
    `Re-run the check driving the app: browser_click / browser_fill_form / browser_press_key. ${EVALUATE} ` +
      'is permitted only on an accessibility-layer entry, for axe-core injection.'
  );
}

function checkNoInteractionPass(entry) {
  if (entry.verdict !== 'pass') return null;
  if ((entry.interactions || []).some(isInteraction)) return null;
  return finding(
    'no-interaction-pass',
    entry.id,
    `playwright check "${entry.id}" is recorded PASS with no user-path interaction`,
    'A pass that never touched the app is vacuous. Either execute the contract steps and record the ' +
      'tools used, or record the honest verdict ("untested" / "fail").'
  );
}

function classifyPlaywrightEntry(entry) {
  const bypass = checkJsBypass(entry);
  // Exclusive: an entry whose only tool was browser_evaluate is one defect, not two.
  return bypass ? [bypass] : [checkNoInteractionPass(entry)].filter(Boolean);
}

function classifyAccessibilityEntry(entry, inner) {
  if (inner.accessibility_checks) return [];
  return [
    finding(
      'unbacked-axe',
      entry.id,
      `accessibility entry "${entry.id}" claims the ${AXE_PURPOSE} exemption, but the contract ` +
        'declares no accessibility_checks block',
      'Remove the entry, or add the accessibility_checks block to the sprint contract at negotiation ' +
        'time. The axe exemption may not be claimed where no audit was contracted.'
    ),
  ];
}

function coverageFindings(contractIds, ledgerIds) {
  const missing = contractIds.filter((id) => !ledgerIds.has(id)).map((id) =>
    finding('missing-evidence', id, `contracted playwright check "${id}" has no evidence entry`,
      'Execute the check and record its entry, or record it as "untested" — a contracted check with ' +
      'no evidence is a silent skip, never a pass.')
  );
  const extra = [...ledgerIds].filter((id) => !contractIds.includes(id)).map((id) =>
    finding('undeclared-check', id, `evidence entry "${id}" matches no check in the sprint contract`,
      'The contract is the read-only, pre-committed expectation set. Do not invent checks during ' +
      'evaluation; renegotiate the contract instead.')
  );
  return [...missing, ...extra];
}

function groupMismatch(contract, ledger) {
  if (!ledger.group || !contract.group || ledger.group === contract.group) return [];
  return [
    finding('group-mismatch', null,
      `evidence ledger records group "${ledger.group}" but the contract is group "${contract.group}"`,
      'Re-run the evaluation for this group. Evidence from another group proves nothing about this one.'),
  ];
}

function blocked(findings, checked = 0) {
  return { pass: false, applicable: true, checked, untested: [], findings };
}

function missingContract() {
  return blocked([
    finding('missing-contract', null, 'no sprint contract was supplied',
      'Pass --group <id> so the gate can read sprint-contracts/<id>.json. A gate with no input is ' +
      'not a pass.'),
  ]);
}

function missingLedger(contracted) {
  return blocked([
    finding('missing-ledger', null,
      `the contract declares ${contracted} playwright check(s) but no evidence ledger was recorded`,
      'The evaluator must write specs/reviews/evaluator-evidence.json for every runtime evaluation. ' +
      'A missing ledger is treated exactly like a missing security scan: not a pass.'),
  ]);
}

function classifyEntries(entries, contract, ledger, inner, contracted) {
  const playwright = entries.filter((e) => e.layer === 'playwright');
  return [
    ...groupMismatch(contract, ledger),
    ...playwright.flatMap((e) => classifyPlaywrightEntry(e)),
    ...entries.filter((e) => e.layer === 'accessibility').flatMap((e) => classifyAccessibilityEntry(e, inner)),
    ...coverageFindings(contracted.map((c) => c.id), new Set(playwright.map((e) => e.id))),
  ];
}

function classifyEvidence({ contract, ledger } = {}) {
  if (!contract) return missingContract();
  const inner = innerContract(contract);
  const contracted = Array.isArray(inner.playwright_checks) ? inner.playwright_checks : [];
  if (contracted.length === 0) return { pass: true, applicable: false, checked: 0, untested: [], findings: [] };

  const entries = ledger && Array.isArray(ledger.checks) ? ledger.checks : [];
  if (entries.length === 0) return missingLedger(contracted.length);

  const playwright = entries.filter((e) => e.layer === 'playwright');
  const findings = classifyEntries(entries, contract, ledger, inner, contracted);
  return {
    pass: findings.length === 0,
    applicable: true,
    checked: playwright.length,
    // Reported, never a finding: "never report a layer as passed that you could not
    // execute" is the evaluator's own rule. One owner per invariant.
    untested: playwright.filter((e) => e.verdict === 'untested').map((e) => e.id),
    findings,
  };
}

module.exports = { classifyEvidence, isEvaluate, isInteraction, toolName };
