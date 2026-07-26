#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalize, loadEnvelope } = require('../hooks/lib/task-envelope');
const { consumeCapability, findCapability } = require('../hooks/lib/authority-receipt');
const { verifyCertification } = require('./security-certification');
const { verifyReport } = require('./productivity-study');

const CONFIG_REL = '.claude/config/autonomy-policy.json';
const STATE_REL = '.claude/state/autonomy-policy.json';
const PRODUCTIVITY_REL = '.claude/evidence/productivity-study.json';
const RECOMMENDATION_REL = '.claude/evidence/autonomy-recommendation.json';
const MODES = ['attended', 'supervised', 'unattended'];

function hash(value) {
  return crypto.createHash('sha256').update(
    typeof value === 'string' ? value : canonicalize(value)
  ).digest('hex');
}

function stamp(value) {
  const body = { ...value };
  delete body.integrity;
  return { ...body, integrity: { algorithm: 'sha256', hash: hash(body) } };
}

function validStamped(value) {
  if (!value || value.integrity?.algorithm !== 'sha256') return false;
  const body = { ...value };
  delete body.integrity;
  return value.integrity.hash === hash(body);
}

function readJson(root, relative) {
  try { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); } catch (_) { return null; }
}

function writeAtomic(root, relative, value) {
  const target = path.join(root, relative);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  return target;
}

function validateConfig(config) {
  if (!config || config.schema_version !== 1) throw new Error('autonomy policy schema_version must be 1');
  for (const tier of ['R0', 'R1', 'R2', 'R3', 'R4']) {
    if (!MODES.includes(config.risk_ceiling?.[tier])) throw new Error(`invalid autonomy ceiling for ${tier}`);
  }
  if (!(config.promotion?.minimum_matched_pairs >= 2)) throw new Error('minimum_matched_pairs must be >= 2');
  if (!(config.promotion.maximum_agentic_rework_rate >= 0
    && config.promotion.maximum_agentic_rework_rate <= 1)) {
    throw new Error('maximum_agentic_rework_rate must be between 0 and 1');
  }
}

function loadState(root) {
  const state = readJson(root, STATE_REL);
  if (!state) return { state: 'absent', value: null };
  if (!validStamped(state) || state.schema_version !== 1 || !state.tiers) {
    return { state: 'invalid', value: state };
  }
  return { state: 'valid', value: state };
}

function currentMode(root, riskTier) {
  const config = readJson(root, CONFIG_REL);
  try { validateConfig(config); } catch (error) {
    return { pass: false, mode: 'attended', failures: [error.message] };
  }
  const loaded = loadState(root);
  if (loaded.state === 'invalid') {
    return { pass: false, mode: 'attended', failures: ['autonomy-state-invalid'] };
  }
  const selected = loaded.value?.tiers?.[riskTier]?.mode || 'attended';
  const ceiling = config.risk_ceiling[riskTier];
  const mode = MODES[Math.min(MODES.indexOf(selected), MODES.indexOf(ceiling))];
  return {
    pass: selected === mode,
    mode,
    configured_mode: selected,
    ceiling,
    failures: selected === mode ? [] : [`risk-ceiling-exceeded:${riskTier}:${selected}>${ceiling}`],
  };
}

function recommendation(root, riskTier, dependencies = {}) {
  const config = readJson(root, CONFIG_REL);
  validateConfig(config);
  if (!/^R[0-4]$/.test(riskTier || '')) throw new Error('risk tier must be R0-R4');
  const mode = currentMode(root, riskTier);
  if (!mode.pass) return { pass: false, risk_tier: riskTier, current_mode: mode.mode, failures: mode.failures };
  const ceilingIndex = MODES.indexOf(mode.ceiling);
  const currentIndex = MODES.indexOf(mode.mode);
  if (currentIndex >= ceilingIndex) {
    return {
      pass: false, risk_tier: riskTier, current_mode: mode.mode,
      recommended_mode: mode.mode, failures: ['risk-ceiling-reached'],
    };
  }
  const productivityCheck = (dependencies.productivityCheck || verifyReport)(root);
  const report = productivityCheck.report || readJson(root, PRODUCTIVITY_REL);
  const failures = [];
  if (!productivityCheck.pass) failures.push(...productivityCheck.failures);
  if (!report || report.schema_version !== 1 || !report.summary) failures.push('productivity-evidence-missing');
  const matchingPairs = (report?.pairs || []).filter((pair) => pair.risk_tier === riskTier);
  if (matchingPairs.length < config.promotion.minimum_matched_pairs) failures.push('insufficient-matched-pairs');
  if (config.promotion.require_complete_study && report?.summary?.study_complete !== true) {
    failures.push('productivity-study-incomplete');
  }
  const rework = matchingPairs.reduce((sum, pair) => sum + Number(pair.agentic_rework_events || 0), 0);
  if (matchingPairs.length && rework / matchingPairs.length > config.promotion.maximum_agentic_rework_rate) {
    failures.push('agentic-rework-rate-too-high');
  }
  const desired = MODES[currentIndex + 1];
  const certificationCheck = dependencies.certificationCheck || verifyCertification;
  if (desired === 'unattended' && config.promotion.require_security_certification_for_unattended) {
    const certification = certificationCheck(root, 'unattended-core');
    if (!certification.pass) failures.push(...certification.failures.map((item) => `security-certification:${item}`));
  }
  const result = {
    schema_version: 1,
    risk_tier: riskTier,
    current_mode: mode.mode,
    recommended_mode: desired,
    matched_pairs: matchingPairs.length,
    agentic_rework_rate: matchingPairs.length ? rework / matchingPairs.length : null,
    productivity_report_hash: report ? hash(report) : null,
    autonomy_config_hash: hash(config),
    generated_at: new Date().toISOString(),
    pass: failures.length === 0,
    failures,
  };
  return stamp(result);
}

function applyPromotion(root, riskTier, now = new Date(), dependencies = {}) {
  const proposed = recommendation(root, riskTier, dependencies);
  if (!proposed.pass) throw new Error(proposed.failures.join('; '));
  const loadedEnvelope = loadEnvelope(root);
  if (loadedEnvelope.state !== 'valid') throw new Error(`task envelope is ${loadedEnvelope.state}`);
  const action = `promote_autonomy:${riskTier}:${proposed.recommended_mode}`;
  const authority = (dependencies.findCapability || findCapability)(
    root, loadedEnvelope.envelope, action, now
  );
  if (!authority.valid) throw new Error(authority.errors.join('; '));
  const consumed = (dependencies.consumeCapability || consumeCapability)(
    root, authority.receipt, action, now
  );
  if (!consumed.consumed) throw new Error(consumed.error);
  const loaded = loadState(root);
  if (loaded.state === 'invalid') throw new Error('autonomy state is invalid');
  const prior = loaded.value || { schema_version: 1, revision: 0, tiers: {} };
  const next = stamp({
    schema_version: 1,
    revision: prior.revision + 1,
    previous_state_hash: prior.integrity?.hash || null,
    tiers: {
      ...prior.tiers,
      [riskTier]: {
        mode: proposed.recommended_mode,
        updated_at: now.toISOString(),
        authorization_receipt_id: authority.receipt.receipt_id,
        evidence_hash: proposed.integrity.hash,
        productivity_report_hash: proposed.productivity_report_hash,
        autonomy_config_hash: proposed.autonomy_config_hash,
      },
    },
  });
  writeAtomic(root, STATE_REL, next);
  writeAtomic(root, RECOMMENDATION_REL, proposed);
  return next;
}

function reconcile(root, now = new Date(), dependencies = {}) {
  const loaded = loadState(root);
  if (loaded.state !== 'valid') return { changed: false, failures: [`autonomy-state-${loaded.state}`] };
  const nextTiers = { ...loaded.value.tiers };
  const regressions = [];
  const config = readJson(root, CONFIG_REL);
  const report = readJson(root, PRODUCTIVITY_REL);
  for (const [tier, entry] of Object.entries(nextTiers)) {
    if (entry.mode === 'attended') continue;
    let reason = null;
    if (!config || entry.autonomy_config_hash !== hash(config)) reason = 'autonomy-config-drift';
    else if (!report || entry.productivity_report_hash !== hash(report)) reason = 'productivity-evidence-drift';
    if (!reason && entry.mode === 'unattended') {
      const checked = (dependencies.certificationCheck || verifyCertification)(root, 'unattended-core');
      if (!checked.pass) reason = 'security-certification-regression';
    }
    if (reason) {
      const target = MODES[MODES.indexOf(entry.mode) - 1];
      nextTiers[tier] = {
        mode: target,
        updated_at: now.toISOString(),
        reason: `automatic-${reason}`,
      };
      regressions.push({ risk_tier: tier, from: entry.mode, to: target, reason });
    }
  }
  if (!regressions.length) return { changed: false, failures: [], state: loaded.value };
  const next = stamp({
    schema_version: 1,
    revision: loaded.value.revision + 1,
    previous_state_hash: loaded.value.integrity.hash,
    tiers: nextTiers,
  });
  writeAtomic(root, STATE_REL, next);
  return { changed: true, regressions, state: next };
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const command = process.argv[2];
  const tierIndex = process.argv.indexOf('--risk');
  const riskTier = tierIndex === -1 ? null : process.argv[tierIndex + 1];
  try {
    if (command === 'status') {
      const result = currentMode(root, riskTier);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.pass) process.exitCode = 1;
    } else if (command === 'recommend') {
      const result = recommendation(root, riskTier);
      writeAtomic(root, RECOMMENDATION_REL, result);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.pass) process.exitCode = 1;
    } else if (command === 'apply') {
      const state = applyPromotion(root, riskTier);
      process.stdout.write(`autonomy-policy: PROMOTED ${riskTier} → ${state.tiers[riskTier].mode}\n`);
    } else if (command === 'reconcile') {
      const result = reconcile(root);
      process.stdout.write(`autonomy-policy: ${result.changed ? 'REGRESSED' : 'UNCHANGED'}\n`);
    } else {
      throw new Error('usage: autonomy-policy.js status|recommend|apply|reconcile --risk R0');
    }
  } catch (error) {
    process.stderr.write(`autonomy-policy: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  MODES, applyPromotion, currentMode, hash, loadState, recommendation, reconcile,
  stamp, validStamped, validateConfig,
};

if (require.main === module) main();
