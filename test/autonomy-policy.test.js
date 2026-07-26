'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const {
  applyPromotion, currentMode, loadState, recommendation, reconcile, stamp,
} = require('../.claude/scripts/autonomy-policy');
const { stampEnvelope } = require('../.claude/hooks/lib/task-envelope');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomy-policy-'));
  fs.mkdirSync(path.join(root, '.claude', 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'evidence'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'config', 'autonomy-policy.json'), JSON.stringify({
    schema_version: 1,
    modes: ['attended', 'supervised', 'unattended'],
    risk_ceiling: {
      R0: 'unattended', R1: 'unattended', R2: 'supervised', R3: 'supervised', R4: 'attended',
    },
    promotion: {
      minimum_matched_pairs: 10,
      maximum_agentic_rework_rate: 0.2,
      require_complete_study: true,
      require_security_certification_for_unattended: true,
    },
  }));
  const pairs = Array.from({ length: 10 }, (_, index) => ({
    comparison_id: `P${index}`, risk_tier: 'R1',
    agentic_rework_events: 0, baseline_rework_events: 1,
  }));
  fs.writeFileSync(path.join(root, '.claude', 'evidence', 'productivity-study.json'), JSON.stringify({
    schema_version: 1, study_id: 'S1', pairs,
    summary: { study_complete: true, eligible_pairs: 10 },
  }));
  fs.writeFileSync(path.join(root, '.claude', 'state', 'task-envelope.json'), JSON.stringify(stampEnvelope({
    schema_version: 1, task_id: 'ADMIN-1', risk_tier: 'R1',
    allowed_paths: ['.claude/state/**'], forbidden_actions: [],
    required_evidence: ['unit'], required_approvals: 1,
    budgets: { dimensions: [{ unit: 'agents', limit: 2 }] },
  })));
  return root;
}

function authority(id) {
  return {
    findCapability: () => ({ valid: true, receipt: { receipt_id: id } }),
    consumeCapability: () => ({ consumed: true }),
  };
}

function evidence(root) {
  return {
    productivityCheck: () => ({
      pass: true,
      failures: [],
      report: JSON.parse(fs.readFileSync(
        path.join(root, '.claude', 'evidence', 'productivity-study.json'), 'utf8'
      )),
    }),
  };
}

test('autonomy starts attended and promotes one level with exact external authority', () => {
  const root = fixture();
  assert.strictEqual(currentMode(root, 'R1').mode, 'attended');
  const proposed = recommendation(root, 'R1', {
    ...evidence(root), certificationCheck: () => ({ pass: true }),
  });
  assert.strictEqual(proposed.pass, true);
  assert.strictEqual(proposed.recommended_mode, 'supervised');
  const state = applyPromotion(root, 'R1', new Date('2026-07-26T12:00:00Z'), {
    ...authority('CAP-1'), ...evidence(root), certificationCheck: () => ({ pass: true }),
  });
  assert.strictEqual(state.tiers.R1.mode, 'supervised');
  assert.strictEqual(loadState(root).state, 'valid');
});

test('promotion requests authority scoped to the exact tier and target mode', () => {
  const root = fixture();
  let requestedAction;
  applyPromotion(root, 'R1', new Date(), {
    ...evidence(root),
    certificationCheck: () => ({ pass: true }),
    findCapability: (_root, _envelope, action) => {
      requestedAction = action;
      return { valid: true, receipt: { receipt_id: 'CAP-EXACT' } };
    },
    consumeCapability: () => ({ consumed: true }),
  });
  assert.strictEqual(requestedAction, 'promote_autonomy:R1:supervised');
});

test('unattended promotion requires a current security certification', () => {
  const root = fixture();
  applyPromotion(root, 'R1', new Date(), {
    ...authority('CAP-1'), ...evidence(root), certificationCheck: () => ({ pass: true }),
  });
  const blocked = recommendation(root, 'R1', {
    ...evidence(root), certificationCheck: () => ({ pass: false, failures: ['expired'] }),
  });
  assert.strictEqual(blocked.pass, false);
  assert.ok(blocked.failures.includes('security-certification:expired'));
});

test('risk ceilings prevent R4 promotion and cap R2 at supervised', () => {
  const root = fixture();
  assert.ok(recommendation(root, 'R4').failures.includes('risk-ceiling-reached'));
  const state = stamp({
    schema_version: 1, revision: 1, previous_state_hash: null,
    tiers: { R2: { mode: 'unattended' } },
  });
  fs.writeFileSync(path.join(root, '.claude', 'state', 'autonomy-policy.json'), JSON.stringify(state));
  const resolved = currentMode(root, 'R2');
  assert.strictEqual(resolved.pass, false);
  assert.strictEqual(resolved.mode, 'supervised');
});

test('tampered state fails closed to attended', () => {
  const root = fixture();
  const state = stamp({
    schema_version: 1, revision: 1, previous_state_hash: null,
    tiers: { R1: { mode: 'unattended' } },
  });
  state.tiers.R1.mode = 'supervised';
  fs.writeFileSync(path.join(root, '.claude', 'state', 'autonomy-policy.json'), JSON.stringify(state));
  const resolved = currentMode(root, 'R1');
  assert.strictEqual(resolved.pass, false);
  assert.strictEqual(resolved.mode, 'attended');
});

test('evidence drift automatically regresses autonomy without requiring authority', () => {
  const root = fixture();
  applyPromotion(root, 'R1', new Date(), {
    ...authority('CAP-1'), ...evidence(root), certificationCheck: () => ({ pass: true }),
  });
  const reportFile = path.join(root, '.claude', 'evidence', 'productivity-study.json');
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  report.summary.study_complete = false;
  fs.writeFileSync(reportFile, JSON.stringify(report));
  const result = reconcile(root, new Date('2026-07-26T13:00:00Z'));
  assert.strictEqual(result.changed, true);
  assert.strictEqual(result.state.tiers.R1.mode, 'attended');
  assert.strictEqual(result.regressions[0].reason, 'productivity-evidence-drift');
});
