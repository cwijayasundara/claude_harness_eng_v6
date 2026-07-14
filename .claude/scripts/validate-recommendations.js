#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/validate-recommendations.js [specs/retro/recommendations.jsonl]
// Validates the /retro skill's output — scored harness-improvement recommendations
// (agentic-flywheel design doc §4.2, docs/agentic-flywheel-design.md). Checks required
// fields, controlled vocabularies, and the permanently-human-gated invariant from §4.5:
// a recommendation whose class is "gate-loosen" or "security" must declare
// human_gate:true, so the guardrail is baked into the artifact itself, not left to prose.
// This validator does NOT approve, apply, or auto-merge anything — it only rejects
// malformed recommendations before a human reviews them.
// Exit 0 = valid (including an empty batch — no recommendations is a legitimate outcome),
// 1 = invalid, 2 = usage/IO error.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_PATH = path.join(REPO_ROOT, 'specs', 'retro', 'recommendations.jsonl');

const CLASSES = new Set(['docs', 'sensor-tune', 'gate-tighten', 'rule-add', 'prompt-edit', 'gate-loosen', 'security']);
const LEVELS = new Set(['low', 'med', 'high']);
const STATUSES = new Set(['proposed', 'approved', 'deferred', 'rejected']);
const GATED_CLASSES = new Set(['gate-loosen', 'security']);

function validate(e) {
  const errors = [];
  if (!e.id) errors.push('missing id');
  if (!e.target) errors.push('missing target');
  if (!e.change) errors.push('missing change');
  if (!CLASSES.has(e.class)) errors.push(`invalid class "${e.class}" (must be one of ${[...CLASSES].join(', ')})`);
  if (!LEVELS.has(e.risk)) errors.push(`invalid risk "${e.risk}"`);
  if (!LEVELS.has(e.cost)) errors.push(`invalid cost "${e.cost}"`);
  if (!LEVELS.has(e.benefit)) errors.push(`invalid benefit "${e.benefit}"`);
  if (!STATUSES.has(e.status)) errors.push(`invalid status "${e.status}"`);
  if (typeof e.confidence !== 'number' || Number.isNaN(e.confidence) || e.confidence < 0 || e.confidence > 1) {
    errors.push(`confidence must be a number in [0,1], got ${JSON.stringify(e.confidence)}`);
  }
  if (!Array.isArray(e.evidence) || e.evidence.length === 0 || e.evidence.some((x) => typeof x !== 'string' || !x.trim())) {
    errors.push('evidence must be a non-empty array of non-empty strings');
  }
  if (GATED_CLASSES.has(e.class) && e.human_gate !== true) {
    errors.push(`class "${e.class}" is permanently human-gated — must declare human_gate:true`);
  }
  return { errors };
}

function validateAll(entries) {
  const errors = [];
  const seen = new Map();
  entries.forEach((e, i) => {
    const { errors: entryErrors } = validate(e);
    for (const msg of entryErrors) errors.push(`[${i}] ${e && e.id ? e.id : '(no id)'}: ${msg}`);
    if (e && e.id) {
      if (seen.has(e.id)) errors.push(`[${i}] duplicate id "${e.id}" (also at [${seen.get(e.id)}])`);
      else seen.set(e.id, i);
    }
  });
  return { errors, counts: { total: entries.length } };
}

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`line ${i + 1}: invalid JSON — ${err.message}`);
    }
  });
}

module.exports = { validate, validateAll, DEFAULT_PATH };

if (require.main === module) {
  const filePath = process.argv[2] || DEFAULT_PATH;
  let entries;
  try {
    entries = fs.existsSync(filePath) ? readJsonl(filePath) : [];
  } catch (err) {
    process.stderr.write(`validate-recommendations: cannot read ${filePath}: ${err.message}\n`);
    process.exit(2);
  }
  const { errors, counts } = validateAll(entries);
  if (errors.length) {
    process.stderr.write(`recommendations INVALID (${errors.length} error(s)):\n`);
    for (const e of errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }
  process.stdout.write(`recommendations OK: ${counts.total} entrie(s), all valid.\n`);
  process.exit(0);
}
