'use strict';

// Join of existing receipts into one trajectory verdict. BLOCK only when an
// agent session is evident AND a required step left no receipt. Human-only
// commits (no receipts) SKIP. Does not re-check AT-first or live-externals.

const DEFAULT_PACK_MAX_AGE_MS = 4 * 60 * 60 * 1000;

function isAgentSession(receipts) {
  const r = receipts || {};
  return Boolean(
    r.contextPack
    || (r.redPhaseEvents && r.redPhaseEvents.length)
    || (r.atRed && r.atRed.length)
    || (r.coverageVerdicts && r.coverageVerdicts.length)
  );
}

function contextPackOk(receipt, now, maxAgeMs) {
  if (!receipt || !receipt.ts) return false;
  const at = Date.parse(receipt.ts);
  if (!Number.isFinite(at)) return false;
  return (now - at) <= maxAgeMs;
}

function testRan(receipts) {
  const r = receipts || {};
  if (r.atRed && r.atRed.length) return true;
  if (r.coverageVerdicts && r.coverageVerdicts.length) return true;
  const events = r.redPhaseEvents || [];
  return events.some((e) => e.verdict === 'pass' || e.verdict === 'fail');
}

function requiredChecks(receipts, graphReal, now, maxAgeMs) {
  const checks = [{
    id: 'test_ran', required: true, ok: testRan(receipts),
    detail: 'need a red-phase, at-red, or coverage-verdict receipt',
  }];
  if (graphReal) {
    checks.push({
      id: 'context_pack', required: true,
      ok: contextPackOk(receipts && receipts.contextPack, now, maxAgeMs),
      detail: 'brownfield graph is real; need a fresh context-pack-last.json',
    });
  }
  return checks;
}

function evaluateTrajectory(input) {
  const {
    storyOwnedFiles, graphReal, receipts, now,
    contextPackMaxAgeMs = DEFAULT_PACK_MAX_AGE_MS,
  } = input;
  const owned = storyOwnedFiles || [];
  if (!owned.length) {
    return { status: 'skip', reason: 'no story-owned production files', checks: [] };
  }
  if (!isAgentSession(receipts)) {
    return { status: 'skip', reason: 'no agent-session receipts', checks: [] };
  }
  const checks = requiredChecks(receipts, graphReal, now, contextPackMaxAgeMs);
  const failed = checks.filter((c) => c.required && !c.ok);
  return {
    status: failed.length ? 'fail' : 'pass',
    reason: failed.length ? failed.map((c) => c.id).join(',') : 'ok',
    checks,
    stories: owned,
  };
}

module.exports = {
  DEFAULT_PACK_MAX_AGE_MS,
  isAgentSession, contextPackOk, testRan, evaluateTrajectory,
};
