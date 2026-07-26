#!/usr/bin/env node
'use strict';

// CLI: node .claude/scripts/evidence-integrity-gate.js [--group C] [--root DIR] [--files ...]
//
// evidence-integrity sensor (gap G39). fs plumbing here; pure classification
// lives in hooks/lib/evidence-integrity.js (the same split live-externals-gate.js
// uses). Reads the read-only sprint contract plus the evaluator's evidence
// ledger and BLOCKs when a claimed browser PASS is not backed by real user-path
// interaction against a pre-committed check.
//
// --files is accepted and ignored: the /gate registry runner appends it to every
// check, but this gate's input is the contract + ledger pair, not the diff.
//
// Exit 0 = pass (including "not applicable"), 1 = BLOCK, 2 = usage/IO error.
// A missing or malformed input is never a pass: an unreadable contract or
// ledger exits 2, and a contract whose checks were never evidenced exits 1.

const fs = require('fs');
const path = require('path');
const { classifyEvidence } = require('../hooks/lib/evidence-integrity');

const CONTRACTS_DIR = 'sprint-contracts';
const LEDGER_REL = path.join('specs', 'reviews', 'evaluator-evidence.json');
const VERDICT_REL = path.join('specs', 'reviews', 'evidence-integrity-verdict.json');

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
}

function readJson(abs, label) {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    const e = new Error(`cannot read ${label} ${abs}: ${err.message}`);
    e.io = true;
    throw e;
  }
}

function contractPath(root, group) {
  return path.join(root, CONTRACTS_DIR, `${group}.json`);
}

// Sorted so the multi-contract fallback is deterministic run to run.
function listGroups(root) {
  try {
    return fs.readdirSync(path.join(root, CONTRACTS_DIR))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  } catch (_) {
    return [];
  }
}

function loadLedger(root) {
  const abs = path.join(root, LEDGER_REL);
  return fs.existsSync(abs) ? readJson(abs, 'evidence ledger') : null;
}

// --group wins; otherwise the ledger names the group it covers. With neither,
// every contract is checked so a contract whose checks were never evidenced
// still BLOCKs instead of being skipped for lack of a group name.
function resolveGroups(argv, root, ledger) {
  const explicit = arg(argv, '--group');
  if (explicit) return [explicit];
  if (ledger && ledger.group) return [ledger.group];
  return listGroups(root);
}

function notApplicable(now) {
  return {
    gate: 'evidence-integrity',
    pass: true,
    applicable: false,
    group: null,
    checked: 0,
    untested: [],
    findings: [],
    summary: 'no sprint contract declares playwright checks — nothing to verify',
    timestamp: now(),
  };
}

function toVerdict(group, result, now) {
  return {
    gate: 'evidence-integrity',
    pass: result.pass,
    applicable: result.applicable,
    group,
    checked: result.checked,
    untested: result.untested,
    findings: result.findings,
    summary: result.pass
      ? `${result.checked} browser check(s) backed by user-path interaction`
      : `${result.findings.length} evidence-integrity finding(s)`,
    timestamp: now(),
  };
}

// The first blocking group decides the verdict; an applicable-and-clean group is
// kept as the fallback so a pass still reports which group it covered.
function evaluateGroups(groups, root, ledger, explicit, now) {
  let fallback = null;
  for (const group of groups) {
    const abs = contractPath(root, group);
    if (!fs.existsSync(abs)) {
      if (!explicit) continue;
      const e = new Error(`no contract at ${abs}`);
      e.io = true;
      throw e;
    }
    const result = classifyEvidence({ contract: readJson(abs, 'sprint contract'), ledger });
    if (!result.pass) return toVerdict(group, result, now);
    if (result.applicable && !fallback) fallback = toVerdict(group, result, now);
  }
  return fallback || notApplicable(now);
}

function writeVerdict(root, verdict) {
  const abs = path.join(root, VERDICT_REL);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(verdict, null, 2) + '\n');
}

function readVerdict(root) {
  return JSON.parse(fs.readFileSync(path.join(root, VERDICT_REL), 'utf8'));
}

function report(v) {
  const state = v.applicable ? (v.pass ? 'PASS' : 'FAIL') : 'N/A';
  process.stdout.write(`evidence-integrity: ${state} — ${v.summary}\n`);
  for (const f of v.findings) {
    process.stdout.write(`  ${f.kind.toUpperCase()}${f.id ? ` [${f.id}]` : ''}: ${f.detail}\n    fix: ${f.fix}\n`);
  }
  if (v.untested.length) {
    process.stdout.write(`  note: recorded untested — ${v.untested.join(', ')}\n`);
  }
}

function run(argv, root, deps) {
  const now = (deps && deps.now) || (() => new Date().toISOString());
  try {
    const ledger = loadLedger(root);
    const groups = resolveGroups(argv, root, ledger);
    const verdict = evaluateGroups(groups, root, ledger, !!arg(argv, '--group'), now);
    writeVerdict(root, verdict);
    report(verdict);
    return verdict.pass ? 0 : 1;
  } catch (err) {
    process.stderr.write(`evidence-integrity: ${err.message}\n`);
    return 2;
  }
}

module.exports = { run, readVerdict, resolveGroups, listGroups };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
