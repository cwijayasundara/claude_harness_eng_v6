#!/usr/bin/env node

'use strict';

// Resolve standard vs adversarial code-review mode (Bun Phase A).
// Usage:
//   node .claude/scripts/review-tier.js
//   node .claude/scripts/review-tier.js --files 12 --lines 50 --security-boundary
// Prints JSON: { "mode": "standard"|"adversarial", "reasons": [...] }

const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  adversarial: 'auto', // auto | always | never
  adversarial_min_files: 8,
  adversarial_min_lines: 200,
  block_merge_policy: 'union',
});

function loadReviewConfig(projectDir) {
  const cfg = { ...DEFAULTS };
  try {
    const m = JSON.parse(fs.readFileSync(path.join(projectDir, 'project-manifest.json'), 'utf8'));
    const r = (m && m.review) || {};
    if (r.adversarial != null) cfg.adversarial = String(r.adversarial).toLowerCase();
    if (r.adversarial_min_files != null) cfg.adversarial_min_files = Number(r.adversarial_min_files);
    if (r.adversarial_min_lines != null) cfg.adversarial_min_lines = Number(r.adversarial_min_lines);
    if (r.block_merge_policy != null) cfg.block_merge_policy = String(r.block_merge_policy).toLowerCase();
    const tier = m && m.quality && m.quality.sensor_tier;
    if (tier) cfg.sensor_tier = String(tier).toLowerCase();
  } catch (_) {
    /* no manifest */
  }
  if (process.env.HARNESS_SENSOR_TIER) {
    cfg.sensor_tier = String(process.env.HARNESS_SENSOR_TIER).toLowerCase();
  }
  if (process.env.HARNESS_REVIEW_ADVERSARIAL) {
    cfg.adversarial = String(process.env.HARNESS_REVIEW_ADVERSARIAL).toLowerCase();
  }
  return cfg;
}

/**
 * @param {object} opts
 * @param {number} [opts.files] changed production file count
 * @param {number} [opts.lines] changed line count
 * @param {boolean} [opts.securityBoundary]
 * @param {boolean} [opts.vibeLane] micro /vibe path forces standard unless always
 * @param {string} [opts.projectDir]
 */
function resolveReviewTier(opts = {}) {
  const projectDir = opts.projectDir || process.cwd();
  const cfg = loadReviewConfig(projectDir);
  const reasons = [];
  const files = Number(opts.files) || 0;
  const lines = Number(opts.lines) || 0;
  const securityBoundary = Boolean(opts.securityBoundary);
  const vibeLane = Boolean(opts.vibeLane);

  if (cfg.adversarial === 'never') {
    return { mode: 'standard', policy: cfg.block_merge_policy || 'union', reasons: ['review.adversarial=never'], config: cfg };
  }
  if (cfg.adversarial === 'always') {
    return { mode: 'adversarial', policy: cfg.block_merge_policy || 'union', reasons: ['review.adversarial=always'], config: cfg };
  }

  // auto
  if (vibeLane) {
    return { mode: 'standard', policy: cfg.block_merge_policy || 'union', reasons: ['vibe lane — single reviewer'], config: cfg };
  }
  if (cfg.sensor_tier === 'strict') {
    reasons.push('quality.sensor_tier=strict');
  }
  if (securityBoundary) {
    reasons.push('security-boundary trigger');
  }
  if (files >= (cfg.adversarial_min_files || DEFAULTS.adversarial_min_files)) {
    reasons.push(`files ${files} >= adversarial_min_files ${cfg.adversarial_min_files}`);
  }
  if (lines >= (cfg.adversarial_min_lines || DEFAULTS.adversarial_min_lines)) {
    reasons.push(`lines ${lines} >= adversarial_min_lines ${cfg.adversarial_min_lines}`);
  }

  const mode = reasons.length > 0 ? 'adversarial' : 'standard';
  if (mode === 'standard') reasons.push('below auto thresholds');
  return {
    mode,
    policy: cfg.block_merge_policy || 'union',
    reasons,
    config: cfg,
  };
}

function parseArgs(argv) {
  const out = { files: 0, lines: 0, securityBoundary: false, vibeLane: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--files') out.files = Number(argv[++i]) || 0;
    else if (argv[i] === '--lines') out.lines = Number(argv[++i]) || 0;
    else if (argv[i] === '--security-boundary') out.securityBoundary = true;
    else if (argv[i] === '--vibe') out.vibeLane = true;
  }
  return out;
}

function run(argv, root = process.cwd()) {
  const args = parseArgs(argv);
  const result = resolveReviewTier({ ...args, projectDir: root });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

module.exports = {
  DEFAULTS,
  loadReviewConfig,
  resolveReviewTier,
  run,
};

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
