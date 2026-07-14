#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/promote-recommendation.js --check <id> [specs/retro/recommendations.jsonl]
// Deterministic guardrail for agentic-flywheel Phase B (§4.3, docs/agentic-flywheel-design.md).
// The /promote skill MUST call this before touching anything — this is the "guardrails outside
// the loop the agent cannot rewrite in the same run" invariant made real as code, not prose:
// a recommendation whose class is "gate-loosen" or "security" is PERMANENTLY ineligible for
// automated promotion, no matter its status, confidence, or any other field. Those always route
// through a normal human-driven /vibe or /change instead. This script only decides eligibility —
// it never implements a change, never touches git, never opens a PR.
// Exit 0 = eligible, 1 = ineligible (reason printed), 2 = usage/IO error.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_PATH = path.join(REPO_ROOT, 'specs', 'retro', 'recommendations.jsonl');

// Allowlist, not a denylist (code-review CR-003): an unrecognized, mis-cased, or missing
// class must fail closed, not silently pass because it isn't one of the two known-gated
// names. gate-loosen/security are permanently excluded — not threshold-crossable
// (agentic-flywheel design doc §4.5's invariant, enforced here even though §4.5's scored
// auto-approval itself is out of scope for Phase B).
const ELIGIBLE_CLASSES = new Set(['docs', 'sensor-tune', 'gate-tighten', 'rule-add', 'prompt-edit']);

// The id ends up in a git branch name (retro/<id>) and PR title in the /promote skill —
// a real shell-injection choke point (security-review PROMOTE-003), not just cosmetic.
const VALID_ID_RE = /^REC-\d{8}-\d{3}$/;

function findRecommendation(list, id) {
  return (list || []).find((e) => e.id === id) || null;
}

function checkPromotionEligible(rec) {
  if (!rec) return { eligible: false, reason: 'recommendation not found' };
  if (!VALID_ID_RE.test(rec.id || '')) {
    return { eligible: false, reason: `id "${rec.id}" does not match the required REC-YYYYMMDD-NNN format` };
  }
  if (!ELIGIBLE_CLASSES.has(rec.class)) {
    return {
      eligible: false,
      reason: `class "${rec.class}" is not eligible for automated promotion — only `
        + `${[...ELIGIBLE_CLASSES].join(', ')} may be promoted; gate-loosen, security, and any `
        + 'unrecognized class are permanently human-gated, route through /vibe or /change manually',
    };
  }
  if (rec.status === 'promoted') return { eligible: false, reason: 'already promoted' };
  if (rec.status !== 'approved') {
    return { eligible: false, reason: `must be status "approved" to promote, got "${rec.status}"` };
  }
  return { eligible: true, reason: null };
}

function readRecommendations(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  return raw ? raw.split('\n').map((line) => JSON.parse(line)) : [];
}

module.exports = { checkPromotionEligible, findRecommendation, ELIGIBLE_CLASSES, VALID_ID_RE, DEFAULT_PATH };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const checkIdx = argv.indexOf('--check');
  const id = checkIdx !== -1 ? argv[checkIdx + 1] : null;
  const filePath = argv.find((a, i) => a !== '--check' && argv[i - 1] !== '--check') || DEFAULT_PATH;
  if (!id) {
    process.stderr.write('usage: promote-recommendation.js --check <id> [recommendations.jsonl]\n');
    process.exit(2);
  }
  let list;
  try {
    list = readRecommendations(filePath);
  } catch (err) {
    process.stderr.write(`promote-recommendation: cannot read ${filePath}: ${err.message}\n`);
    process.exit(2);
  }
  const { eligible, reason } = checkPromotionEligible(findRecommendation(list, id));
  if (!eligible) {
    process.stderr.write(`INELIGIBLE for promotion: ${id} — ${reason}\n`);
    process.exit(1);
  }
  process.stdout.write(`ELIGIBLE for promotion: ${id}\n`);
  process.exit(0);
}
