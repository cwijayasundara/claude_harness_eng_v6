#!/usr/bin/env node

'use strict';

// Compare a current agent-readiness report to a committed baseline.
//
// Modes (project-manifest.json#quality.agent_readiness, or CLI flags):
//   report  — always exit 0; print summary (Phase 0 default for Project Zero)
//   ratchet — exit 1 when active pillars regress below baseline (if
//             forbid_regression) or below min_active_pillars
//
// Usage:
//   node .claude/scripts/assert-readiness-ratchet.js \
//     [--current path] [--baseline path] [--root path] \
//     [--mode report|ratchet] [--min-active N] [--forbid-regression]
//
// Defaults:
//   current  = <root>/specs/reviews/agent-readiness.json
//   baseline = <root>/.claude/state/agent-readiness-baseline.json
//   root     = cwd
//   mode/min/forbid from project-manifest.json#quality.agent_readiness when present

const fs = require('fs');
const path = require('path');

const VALID_MODES = new Set(['report', 'ratchet']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  return argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function loadReadinessConfig(root) {
  const manifestPath = path.join(root, 'project-manifest.json');
  let ar = {};
  try {
    const m = readJson(manifestPath);
    ar = (m.quality && m.quality.agent_readiness) || {};
  } catch (_) {
    /* no manifest */
  }
  return {
    mode: ar.mode === 'ratchet' ? 'ratchet' : 'report',
    minActivePillars: Number.isFinite(ar.min_active_pillars) ? ar.min_active_pillars : 0,
    forbidRegression: ar.forbid_regression === true,
  };
}

/**
 * Pure decision core — unit-tested without filesystem.
 *
 * @param {{ summary: { active: number, partial?: number, planned?: number } }} current
 * @param {{ summary: { active: number } } | null} baseline  null = no baseline file
 * @param {{ mode: string, minActivePillars: number, forbidRegression: boolean }} opts
 * @returns {{ pass: boolean, reasons: string[], summaryLine: string }}
 */
function evaluateReadinessRatchet(current, baseline, opts) {
  const mode = VALID_MODES.has(opts.mode) ? opts.mode : 'report';
  const minActive = Math.max(0, opts.minActivePillars | 0);
  const forbidRegression = !!opts.forbidRegression;
  const active = current && current.summary ? Number(current.summary.active) || 0 : 0;
  const reasons = [];

  if (mode === 'report') {
    return {
      pass: true,
      reasons: [],
      summaryLine: `agent-readiness ratchet: report mode — active ${active}/8 (no fail).`,
    };
  }

  // ratchet mode
  if (active < minActive) {
    reasons.push(
      `active pillars ${active} is below min_active_pillars ${minActive}`
    );
  }

  if (forbidRegression) {
    if (!baseline || !baseline.summary) {
      reasons.push(
        'forbid_regression is set but baseline is missing or has no summary — cannot prove non-regression'
      );
    } else {
      const baseActive = Number(baseline.summary.active) || 0;
      if (active < baseActive) {
        reasons.push(
          `active pillars regressed: current ${active} < baseline ${baseActive}`
        );
      }
    }
  }

  const pass = reasons.length === 0;
  const summaryLine = pass
    ? `agent-readiness ratchet: PASS — active ${active}/8` +
      (minActive ? ` (min ${minActive})` : '') +
      (forbidRegression && baseline
        ? `; baseline active ${baseline.summary.active}`
        : '') +
      '.'
    : `agent-readiness ratchet: FAIL — ${reasons.join('; ')}.`;

  return { pass, reasons, summaryLine };
}

function main(argv = process.argv.slice(2)) {
  const root = path.resolve(arg(argv, '--root', process.cwd()));
  const cfg = loadReadinessConfig(root);

  const mode = arg(argv, '--mode', cfg.mode);
  const minActivePillars = Number(arg(argv, '--min-active', String(cfg.minActivePillars)));
  const forbidRegression =
    hasFlag(argv, '--forbid-regression') || cfg.forbidRegression;

  const currentPath = path.resolve(
    arg(argv, '--current', path.join(root, 'specs', 'reviews', 'agent-readiness.json'))
  );
  const baselinePath = path.resolve(
    arg(argv, '--baseline', path.join(root, '.claude', 'state', 'agent-readiness-baseline.json'))
  );

  if (!fs.existsSync(currentPath)) {
    process.stderr.write(
      `assert-readiness-ratchet: current report not found: ${currentPath}\n` +
        'Fix: run `npm run agent-readiness` first.\n'
    );
    process.exit(1);
  }

  let current;
  try {
    current = readJson(currentPath);
  } catch (err) {
    process.stderr.write(`assert-readiness-ratchet: cannot parse current: ${err.message}\n`);
    process.exit(1);
  }

  let baseline = null;
  if (fs.existsSync(baselinePath)) {
    try {
      baseline = readJson(baselinePath);
    } catch (err) {
      process.stderr.write(`assert-readiness-ratchet: cannot parse baseline: ${err.message}\n`);
      process.exit(1);
    }
  }

  const result = evaluateReadinessRatchet(current, baseline, {
    mode,
    minActivePillars,
    forbidRegression,
  });

  process.stdout.write(result.summaryLine + '\n');
  if (!result.pass) {
    for (const r of result.reasons) process.stderr.write(`  - ${r}\n`);
    process.exit(1);
  }
  process.exit(0);
}

module.exports = {
  evaluateReadinessRatchet,
  loadReadinessConfig,
  VALID_MODES,
};

if (require.main === module) main();
