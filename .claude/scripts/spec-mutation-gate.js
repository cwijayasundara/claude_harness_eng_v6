#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/spec-mutation-gate.js [--contract <file>]
//        [--verify-cmd "<command>"] [--max-mutants 5]
//
// Spec mutation (SwarmForge pickup #2): corrupt one expected value in the
// sprint contract, re-run the project's verification, and require it to FAIL.
// A mutant that survives means the verification never consulted that criterion
// — the check is decoration that reads as coverage.
//
// The mutant is written OVER the real contract, because the point is to prove
// the REAL reader consults the REAL artifact; handing the verifier a copy at a
// path nothing reads would reproduce the very defect this gate exists to catch.
// The original is restored in a finally, and a crash mid-run leaves a `.backup`
// beside the contract which the next run restores before doing anything else.
//
// Exit 0 = every mutant killed (or unprovisioned), 1 = survivors or an
// inconclusive run, 2 = usage/IO error.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { applyMutation, classifyResults, mutantsFor } = require('../hooks/lib/spec-mutation');

const BACKUP_SUFFIX = '.spec-mutation-backup';

function parseArgs(argv) {
  const o = { maxMutants: 5 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--contract') o.contract = argv[++i];
    else if (argv[i] === '--verify-cmd') o.verifyCmd = argv[++i];
    else if (argv[i] === '--max-mutants') o.maxMutants = Number(argv[++i]);
  }
  return o;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The verification command, from the flag or the manifest. Null = unprovisioned. */
function resolveVerifyCmd(opts, cwd) {
  if (opts.verifyCmd) return opts.verifyCmd;
  try {
    const quality = readJson(path.join(cwd, 'project-manifest.json')).quality || {};
    return (quality.spec_mutation && quality.spec_mutation.verify_command) || null;
  } catch (_) {
    return null;
  }
}

/** A crashed previous run leaves the contract mutated; put it back first. */
function restoreStaleBackup(contractPath) {
  const backup = contractPath + BACKUP_SUFFIX;
  if (!fs.existsSync(backup)) return false;
  fs.copyFileSync(backup, contractPath);
  fs.rmSync(backup);
  return true;
}

/**
 * Run the verification with `mutated` written over the contract, then restore.
 * Exit 126/127 or a signal means the runner never ran — inconclusive, not a kill.
 */
function runMutant(contractPath, original, mutated, verifyCmd, cwd) {
  const backup = contractPath + BACKUP_SUFFIX;
  fs.writeFileSync(backup, original);
  try {
    fs.writeFileSync(contractPath, `${JSON.stringify(mutated, null, 2)}\n`);
    const r = spawnSync(verifyCmd, { shell: true, cwd, encoding: 'utf8' });
    const errored = r.signal !== null || r.status === 126 || r.status === 127 || r.status === null;
    return { verificationPassed: r.status === 0, errored };
  } finally {
    fs.writeFileSync(contractPath, original);
    if (fs.existsSync(backup)) fs.rmSync(backup);
  }
}

function contractFiles(opts, cwd) {
  if (opts.contract) return [path.resolve(cwd, opts.contract)];
  const dir = path.join(cwd, 'sprint-contracts');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f));
}

function mutateOneContract(file, verifyCmd, opts, cwd) {
  restoreStaleBackup(file);
  const original = fs.readFileSync(file, 'utf8');
  const contract = JSON.parse(original);

  const all = mutantsFor(contract);
  const chosen = all.slice(0, opts.maxMutants);
  if (all.length > chosen.length) {
    // No silent caps: a bounded run that reports full coverage is a lie.
    process.stdout.write(
      `spec-mutation: ${path.basename(file)} has ${all.length} mutants, running the first `
      + `${chosen.length} (--max-mutants). ${all.length - chosen.length} not run.\n`);
  }

  return chosen.map((m) => ({
    checkId: m.checkId,
    field: m.field,
    ...runMutant(file, original, applyMutation(contract, m), verifyCmd, cwd),
  }));
}

/** Null when there is something to run; otherwise the exit code to return. */
function unprovisionedExit(files, verifyCmd) {
  if (files.length === 0) {
    process.stdout.write('spec-mutation: no sprint contract — unprovisioned, nothing to mutate\n');
    return 0;
  }
  if (!verifyCmd) {
    process.stdout.write(
      'spec-mutation: unprovisioned — set quality.spec_mutation.verify_command in '
      + 'project-manifest.json, or pass --verify-cmd. Without a verification to run, a mutant '
      + 'cannot be killed or survive.\n');
    return 0;
  }
  return null;
}

function report(verdict) {
  process.stdout.write(`${verdict.summary}\n`);
  if (verdict.inconclusive > 0) {
    process.stdout.write(
      `spec-mutation: ${verdict.inconclusive} run(s) could not execute the verification command — `
      + 'not counted as kills.\n');
  }
  return verdict.clean ? 0 : 1;
}

function main(argv, cwd) {
  const opts = parseArgs(argv);
  const files = contractFiles(opts, cwd);
  const verifyCmd = resolveVerifyCmd(opts, cwd);

  const early = unprovisionedExit(files, verifyCmd);
  if (early !== null) return early;

  const results = [];
  for (const file of files) {
    try {
      results.push(...mutateOneContract(file, verifyCmd, opts, cwd));
    } catch (err) {
      process.stderr.write(`spec-mutation: ${file}: ${err.message}\n`);
      return 2;
    }
  }
  return report(classifyResults(results));
}

if (require.main === module) process.exit(main(process.argv.slice(2), process.cwd()));

module.exports = { main, resolveVerifyCmd, restoreStaleBackup, runMutant };
