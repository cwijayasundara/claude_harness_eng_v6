#!/usr/bin/env node

'use strict';

// CLI orchestrator for the computational security sensors (gap G3). Three tiers,
// each fail-open-but-LOUD when its tool is absent (the harness convention: a
// skipped gate is announced, never silently mistaken for a clean pass):
//   --secrets : baseline regex scan (always available) + gitleaks (if present)
//   --sast    : semgrep (if present)
//   --deps    : npm audit (if package.json) + pip-audit (if present)
//   --all     : all tiers (the default when none is named)
// Targets: --staged (git staged files) or explicit file args.
// --boundary-only restricts SAST to security/data/network files (review-policy).
// --threshold=low|moderate|high|critical sets the blocking floor (default high).
// Writes specs/reviews/security-scan.json. Exit 0 = clean, 1 = blocking
// findings, 2 = usage error.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { run, skipped } = require('../hooks/lib/toolchain');
const lib = require('../hooks/lib/security-scan');

const TIERS = ['secrets', 'sast', 'deps'];

function noteSkip(tool, reason) {
  process.stderr.write(
    `WARNING: SENSOR SKIPPED — ${tool} did not run (${reason}). ` +
    `This scope was NOT scanned by ${tool}.\n` +
    `         Fix: install ${tool} to enable this computational security sensor.\n`
  );
}

function parseArgs(argv) {
  const opts = { tiers: new Set(), staged: false, boundaryOnly: false, threshold: 'high', files: [] };
  for (const a of argv) {
    if (a === '--all') TIERS.forEach((t) => opts.tiers.add(t));
    else if (a === '--secrets' || a === '--sast' || a === '--deps') opts.tiers.add(a.slice(2));
    else if (a === '--staged') opts.staged = true;
    else if (a === '--boundary-only') opts.boundaryOnly = true;
    else if (a.startsWith('--threshold=')) opts.threshold = a.split('=')[1] || 'high';
    else if (!a.startsWith('--')) opts.files.push(a);
  }
  if (opts.tiers.size === 0) TIERS.forEach((t) => opts.tiers.add(t));
  return opts;
}

function parseJsonSafe(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

function readSource(cwd, file) {
  return fs.readFileSync(path.resolve(cwd, file), 'utf8');
}

function stagedFiles(cwd) {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd, encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch (_) { return []; }
}

function gatherFiles(opts, cwd) {
  if (opts.files.length) return opts.files;
  if (opts.staged) return stagedFiles(cwd);
  return [];
}

function runGitleaks(cwd) {
  const report = path.join(os.tmpdir(), `gitleaks-${process.pid}.json`);
  const res = run(['gitleaks', 'detect', '--no-banner', '--report-format', 'json', '--report-path', report, '--source', cwd], cwd, 60000);
  if (skipped(res)) { noteSkip('gitleaks', 'not installed or unprovisioned'); return []; }
  try {
    return lib.normalizeGitleaks(JSON.parse(fs.readFileSync(report, 'utf8')));
  } catch (_) {
    return [];
  } finally {
    try { fs.unlinkSync(report); } catch (_) { /* best effort */ }
  }
}

function runSecrets(files, cwd) {
  const baseline = lib.baselineSecretFindings(files, (f) => readSource(cwd, f));
  return baseline.concat(runGitleaks(cwd));
}

function runSast(files, cwd, boundaryOnly) {
  const targets = boundaryOnly ? lib.boundaryFiles(files) : files;
  if (!targets.length) return [];
  const res = run(['semgrep', '--json', '--quiet', '--config', 'auto', ...targets], cwd, 120000);
  if (skipped(res)) { noteSkip('semgrep', 'not installed or unprovisioned'); return []; }
  const json = parseJsonSafe(res.stdout);
  if (!json) { noteSkip('semgrep', 'could not parse output'); return []; }
  return lib.normalizeSemgrep(json);
}

function runNpmAudit(cwd) {
  const res = run(['npm', 'audit', '--json'], cwd, 90000);
  if (skipped(res)) { noteSkip('npm audit', 'npm unavailable or no lockfile'); return []; }
  const json = parseJsonSafe(res.stdout);
  if (!json) { noteSkip('npm audit', 'could not parse output'); return []; }
  return lib.normalizeNpmAudit(json);
}

function runPipAudit(cwd) {
  const res = run(['pip-audit', '--format=json'], cwd, 90000);
  if (skipped(res)) { noteSkip('pip-audit', 'not installed'); return []; }
  const json = parseJsonSafe(res.stdout);
  if (!json) { noteSkip('pip-audit', 'could not parse output'); return []; }
  return lib.normalizePipAudit(json);
}

function runDeps(cwd) {
  const out = [];
  if (fs.existsSync(path.join(cwd, 'package.json'))) out.push(...runNpmAudit(cwd));
  if (['pyproject.toml', 'requirements.txt'].some((f) => fs.existsSync(path.join(cwd, f)))) {
    out.push(...runPipAudit(cwd));
  }
  return out;
}

function writeReport(cwd, payload) {
  const dir = path.join(cwd, 'specs', 'reviews');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'security-scan.json'), JSON.stringify(payload, null, 2) + '\n');
  } catch (_) { /* report is best-effort; the exit code is the source of truth */ }
}

function collect(opts, files, cwd) {
  const findings = [];
  if (opts.tiers.has('secrets')) findings.push(...runSecrets(files, cwd));
  if (opts.tiers.has('sast')) findings.push(...runSast(files, cwd, opts.boundaryOnly));
  if (opts.tiers.has('deps')) findings.push(...runDeps(cwd));
  return findings;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const files = gatherFiles(opts, cwd);
  const summary = lib.summarize(collect(opts, files, cwd), opts.threshold);
  writeReport(cwd, { threshold: opts.threshold, tiers: [...opts.tiers], ...summary });

  if (summary.blocking > 0) {
    process.stderr.write(
      `BLOCKED: ${summary.blocking} security finding(s) at or above "${opts.threshold}":\n` +
      lib.renderFindings(summary.findings) + '\n'
    );
    process.exit(1);
  }
  process.stdout.write(`security-scan OK: no findings at or above "${opts.threshold}" (${summary.total} below-threshold).\n`);
  process.exit(0);
}

// Export the tier runners so other harness tools (e.g. the drift monitor) can
// reuse the dependency audit without re-running the whole CLI or clobbering its
// report. Only run as a CLI when invoked directly.
module.exports = { runSecrets, runSast, runDeps, collect, parseArgs };

if (require.main === module) main();
