#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/fleet-retrofit.js --fleet <file> [--apply] [--out <path>] [--json]
//
// Fleet-retrofit runner: bring an existing fleet of repos into compliance across
// BOTH live gates (branch-protection ruleset + deploy-approval environment) in one
// command, and return a single aggregate report of which repos are gated, drifted,
// provisioned-but-not-gating, or failed.
//
//   default (audit): read-only. Per repo, --verify both provisioners; classify;
//                    aggregate. Changes nothing.
//   --apply        : per repo, --apply both provisioners then --verify to confirm;
//                    classify from the apply+verify codes; aggregate.
//
// Isolation: each provisioner is invoked PER REPO (--repo owner/repo) so one repo's
// failure (no admin, 404, gh error) becomes a 'failed' row and NEVER aborts the
// rest — the value of a retrofit driver is the complete fleet picture. Exit 0 iff
// every repo is gated; 1 if any repo is not gated (report still fully written); 2
// for usage / unreadable fleet.
//
// No client literals: the branch-protection/environment specs come from
// project-manifest.json#github (the single operator config the provisioners read);
// repo identity comes from fleet.json at runtime. gh flows through an injected
// runner shared with both provisioners (execFileSync('gh', argv), literal argv).
//
// The provisioners are consumed as MODULES (provProt.run / provEnv.run) with the
// shared injected runner, so this round-trips their real entrypoints — no
// re-implementation of the gh/diff logic.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const provProt = require('./provision-protection');
const provEnv = require('./provision-environments');
const core = require('./fleet-retrofit-core');

function defaultGh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input });
}

// owner/repo are single path segments [A-Za-z0-9._-], no "..", validated before a
// slug is ever handed to a provisioner (which interpolates it into a gh api path).
const SEGMENT = /^[A-Za-z0-9._-]+$/;
function validSegment(s) { return typeof s === 'string' && SEGMENT.test(s) && !s.includes('..'); }

function parseFlags(argv) {
  const flags = { mode: 'audit' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') flags.mode = 'apply';
    else if (a === '--fleet') flags.fleet = argv[++i];
    else if (a === '--out') flags.out = argv[++i];
    else if (a === '--json') flags.json = true;
  }
  return flags;
}

// Read the operator's github config (the single source of the gate specs). Absent
// => both gates are unconfigured (see retrofitRepo). Never throws.
function readGithub(cwd) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(cwd, 'project-manifest.json'), 'utf8'));
    return (m && m.github) || null;
  } catch (_) { return null; }
}

// Read + validate the fleet registry. Returns { ok, repos:[{owner,repo,slug}] } or
// { ok:false, reason } — an unreadable file, a non-array `repos`, or a traversal
// owner/repo is a hard exit-2 error BEFORE any repo is touched.
function readFleet(file) {
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `cannot read fleet registry ${file}: ${String((err && err.message) || err).split('\n')[0]}` };
  }
  if (reg.repos !== undefined && !Array.isArray(reg.repos)) {
    return { ok: false, reason: `fleet "repos" must be an array (got ${typeof reg.repos})` };
  }
  const repos = Array.isArray(reg.repos) ? reg.repos : [];
  for (const r of repos) {
    if (!validSegment(r && r.owner) || !validSegment(r && r.repo)) {
      return { ok: false, reason: `invalid fleet entry ${JSON.stringify(r)} (owner/repo must be chars [A-Za-z0-9._-], no "..")` };
    }
  }
  return { ok: true, repos: repos.map((r) => ({ owner: r.owner, repo: r.repo, slug: `${r.owner}/${r.repo}` })) };
}

// Run one provisioner in one mode against one repo, returning its numeric exit
// code. The provisioners are result-object/never-throw by design; a genuine throw
// therefore signals a programming bug, so we surface it on stderr (observable, not
// silently indistinguishable from a gh failure) and map to code 2 (failed) so a
// single repo can never crash the fleet loop.
function provRun(mod, mode, slug, cwd, runner) {
  try {
    return mod.run([`--${mode}`, '--repo', slug], { cwd, runner });
  } catch (err) {
    process.stderr.write(`fleet-retrofit: unexpected error from ${mode} on ${slug}: ${String((err && err.message) || err).split('\n')[0]}\n`);
    return 2;
  }
}

// Classify one gate, short-circuiting to 'not-configured' when the operator never
// configured it. Without this, the provisioner's "nothing to provision" exit 0
// would be read as 'gated' — a false green (see fleet-retrofit-core NON_GATED note).
function classifyOne(mod, kind, mode, slug, cwd, runner, configured) {
  if (!configured) return 'not-configured';
  const applyCode = mode === 'apply' ? provRun(mod, 'apply', slug, cwd, runner) : null;
  const verifyCode = provRun(mod, 'verify', slug, cwd, runner);
  return core.classifyGate(kind, mode, applyCode, verifyCode);
}

// Retrofit one repo: (optionally) apply then verify each CONFIGURED gate, classify,
// roll up. cfg carries which gates the manifest actually configures.
function retrofitRepo(slug, mode, cwd, runner, cfg) {
  const branch_protection = classifyOne(provProt, 'protection', mode, slug, cwd, runner, cfg.bpConfigured);
  const deploy_gate = classifyOne(provEnv, 'env', mode, slug, cwd, runner, cfg.dgConfigured);
  return { repo: slug, branch_protection, deploy_gate, status: core.rollupRepo(branch_protection, deploy_gate) };
}

function writeReport(cwd, outFlag, report) {
  const out = outFlag
    ? (path.isAbsolute(outFlag) ? outFlag : path.join(cwd, outFlag))
    : path.join(cwd, 'specs', 'reviews', 'fleet-retrofit.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  return out;
}

// Which gates the operator actually configured. An unconfigured gate is reported
// 'not-configured' (never 'gated') because the provisioners return exit 0 for
// "nothing to provision" — indistinguishable from "compliant" by code alone.
function resolveConfig(cwd) {
  const github = readGithub(cwd);
  const cfg = {
    bpConfigured: !!github,
    dgConfigured: !!(github && Array.isArray(github.environments) && github.environments.length),
  };
  if (!cfg.bpConfigured) process.stdout.write('fleet-retrofit: no project-manifest.json#github — branch-protection is not-configured for the fleet.\n');
  if (!cfg.dgConfigured) process.stdout.write('fleet-retrofit: no github.environments configured — deploy-approval is not-configured for the fleet.\n');
  return cfg;
}

function retrofitFleet(repos, mode, cwd, runner, cfg) {
  const rows = [];
  for (const r of repos) {
    process.stdout.write(`fleet-retrofit: ${mode === 'apply' ? 'applying' : 'auditing'} ${r.slug} ...\n`);
    rows.push(retrofitRepo(r.slug, mode, cwd, runner, cfg));
  }
  return rows;
}

function printSummary(report, cwd, outPath) {
  const s = report.summary;
  process.stdout.write(
    `fleet-retrofit: ${s.gated}/${s.total} gated (drifted ${s.drifted}, not-gating ${s.not_gating},` +
    ` not-configured ${s.not_configured}, failed ${s.failed}); report ${path.relative(cwd, outPath)}.\n`);
  if (!report.fleet_gated) {
    process.stdout.write('fleet-retrofit: fleet is NOT fully gated — see the report for the per-repo worklist.\n');
  }
}

function run(argv, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const runner = opts.gh || defaultGh;
  const now = opts.now || (() => new Date().toISOString());
  const flags = parseFlags(argv);

  if (!flags.fleet) { process.stderr.write('fleet-retrofit: --fleet <file> is required.\n'); return 2; }
  const fleet = readFleet(flags.fleet);
  if (!fleet.ok) { process.stderr.write(`fleet-retrofit: ${fleet.reason}\n`); return 2; }

  const cfg = resolveConfig(cwd);
  const rows = retrofitFleet(fleet.repos, flags.mode, cwd, runner, cfg);
  const report = core.buildReport({ rows, mode: flags.mode, now: now() });
  const outPath = writeReport(cwd, flags.out, report);
  if (flags.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  printSummary(report, cwd, outPath);
  return report.fleet_gated ? 0 : 1;
}

module.exports = { run, readFleet, retrofitRepo, validSegment };

if (require.main === module) process.exit(run(process.argv.slice(2), {}));
