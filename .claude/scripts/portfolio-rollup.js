#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/portfolio-rollup.js <collection-dir> [--target-version X]
//        [--fetch] [--fleet <file>] [--out <path>] [--verify <file>] [--json]
//
// Increment 4b — aggregate a collection of per-repo 4a attestations into a single
// integrity-hashed portfolio compliance rollup, verifying each input's integrity
// and computing harness-version drift. Sibling of generate-attestation.js; reuses
// canonical-json (integrity), attestation-io#readJson, portfolio-rollup-core (pure
// aggregation), and the fleet.json + validSegment + injected-gh idiom from the
// provisioners.
//
// Core (collection-dir): enumerate per-repo attestation files (flat <name>.json OR
// a per-repo subdir), verify each one's sha256 integrity, and roll them up. A
// tampered/failed attestation is integrity_failed and NEVER counted compliant; a
// --fleet repo with no attestation is a recorded not-attested gap. portfolio_compliant
// is fail-safe (empty portfolio => false). --verify recomputes the rollup's own
// integrity (never mutates). --fetch gathers the attestations via fleet.json + gh api.
//
// INTEGRITY NOTE: the embedded sha256 is a corruption-detecting checksum, not
// cryptographic authenticity — same documented signing seam as 4a.
//
// Exit 0 = rollup written / --verify match; 1 = --verify mismatch; 2 = usage/fetch error.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readJson } = require('./attestation-io');
const { fromInTotoStatement } = require('./attestation-bundle');
const { contentHash } = require('./canonical-json');
const core = require('./portfolio-rollup-core');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join('.claude', 'attestations', 'portfolio-rollup.json');

// owner/repo path segments are [A-Za-z0-9._-], no "..", validated before any gh
// path so a malicious fleet entry cannot traverse the gh API.
const SEGMENT = /^[A-Za-z0-9._-]+$/;
function validSegment(s) { return typeof s === 'string' && SEGMENT.test(s) && !s.includes('..'); }

// A remote index entry's `path` is interpolated into the gh api path; the audited
// repo controls its own index.json, so a malicious entry path could redirect the
// runner's token off the repo's own tree. Require a repo-relative path under
// .claude/attestations/ with no traversal / absolute / backslash / URL scheme.
function validRelPath(p) {
  return typeof p === 'string'
    && p.startsWith('.claude/attestations/')
    && !p.includes('..')
    && !p.includes('\\')
    && !/:\/\//.test(p);
}

function defaultGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--fetch') flags.fetch = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--target-version') flags.targetVersion = argv[++i];
    else if (a === '--fleet') flags.fleet = argv[++i];
    else if (a === '--out') flags.out = argv[++i];
    else if (a === '--verify') flags.verify = argv[++i];
    else if (!a.startsWith('--') && !flags.dir) flags.dir = a;
  }
  return flags;
}

// The default drift target when --target-version is omitted: the running harness
// version. Prefer the scaffold-stamped project-manifest.json#harness_version (in a
// scaffolded target, package.json is the PROJECT's version, not the harness's —
// same precedence generate-attestation.js uses); fall back to package.json version.
function runningVersion() {
  const pm = readJson(path.join(REPO_ROOT, 'project-manifest.json'));
  if (pm && typeof pm.harness_version === 'string' && pm.harness_version.trim()) return pm.harness_version;
  const pkg = readJson(path.join(REPO_ROOT, 'package.json'));
  return pkg && pkg.version ? pkg.version : null;
}

function readFleet(file) {
  try {
    const reg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const repos = Array.isArray(reg.repos) ? reg.repos : [];
    return { ok: true, entries: repos.map((r) => ({ owner: r.owner, repo: r.repo })) };
  } catch (err) {
    return { ok: false, reason: `cannot read fleet ${file}: ${String((err && err.message) || err).split('\n')[0]}` };
  }
}

// --- collection enumeration (flat <name>.json OR per-repo subdir) --------------

// The actual output file is excluded via the caller's exclude Set (its real path),
// so we do not also hardcode the default basename — a repo file that happens to
// share the default name but sits under a different --out is still read.
function isAttestationFile(name) {
  return name.endsWith('.json') && name !== 'index.json';
}

// In a per-repo subdir, prefer the latest entry named by its index.json; fall back
// to any attestation file present. The <owner>__<repo> naming maps back to a slug.
function subdirAttestation(dir) {
  const idx = readJson(path.join(dir, 'index.json'));
  if (idx && Array.isArray(idx.entries) && idx.entries.length) {
    const latest = [...idx.entries].sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)))[0];
    if (latest && latest.path) {
      const f = path.join(dir, path.basename(latest.path));
      if (fs.existsSync(f)) return f;
    }
  }
  const flat = fs.readdirSync(dir).filter(isAttestationFile);
  return flat.length ? path.join(dir, flat[0]) : null;
}

function slugFromName(name) {
  return name.replace(/\.json$/, '').replace('__', '/');
}

// exclude = absolute paths that live in the dir but are NOT attestations (the
// fleet registry, the rollup output) so a fleet.json/out file dropped alongside
// the attestations is never mis-read as a repo.
function enumerateAttestations(dir, exclude) {
  const out = [];
  const skip = exclude || new Set();
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (skip.has(full)) continue;
    if (ent.isDirectory()) {
      const file = subdirAttestation(full);
      if (file) out.push({ repo: slugFromName(ent.name), file });
    } else if (isAttestationFile(ent.name)) {
      out.push({ repo: slugFromName(ent.name), file: full });
    }
  }
  return out;
}

// --- core aggregation ---------------------------------------------------------

function collect(dir, fleetEntries, target, exclude) {
  // Dedup enumerated attestations by resolved repo (keep the latest by
  // generated_at) so the same repo present as both a flat file AND a per-repo
  // subdir yields one row. Track BOTH the filename slug and the attested repo so a
  // repo already present is not also emitted as a duplicate not-attested gap.
  const byRepo = new Map();
  const seenSlugs = new Set();
  for (const { repo: nameSlug, file } of enumerateAttestations(dir, exclude)) {
    // Attestations are in-toto Statements as of C2; pre-C2 bare bundles pass through
    // unchanged. A malformed statement throws rather than reading as empty evidence,
    // which would otherwise count a broken input as an uninteresting non-finding.
    let att;
    try {
      att = fromInTotoStatement(readJson(file));
    } catch (_) {
      att = null;
    }
    const row = core.buildRow(att, nameSlug, target);
    seenSlugs.add(nameSlug);
    seenSlugs.add(row.repo);
    const ts = String((att && att.generated_at) || '');
    const prev = byRepo.get(row.repo);
    if (!prev || ts.localeCompare(prev.ts) > 0) byRepo.set(row.repo, { row, ts });
  }
  const rows = [];
  for (const { row } of byRepo.values()) rows.push(row);
  for (const { owner, repo } of fleetEntries) {
    const slug = `${owner}/${repo}`;
    if (!seenSlugs.has(slug)) { rows.push(core.notAttestedRow(slug)); seenSlugs.add(slug); }
  }
  return rows;
}

// --- fetch mode ---------------------------------------------------------------

// gh contents API returns { content: <base64>, encoding: 'base64' }. A real
// "HTTP 404" is a missing file (skip => later not-attested); any other failure
// (gh absent, auth, permission) is fatal so we never silently under-report.
function fetchContents(gh, apiPath) {
  try {
    const j = JSON.parse(gh(['api', apiPath]));
    // Files >1MB come back encoding:"none" with empty content; treat any non-base64
    // encoding as a fetch-miss (skip => not-attested), never a fatal abort.
    if (j.encoding !== 'base64') {
      return { ok: false, notFound: true, reason: `unsupported content encoding "${j.encoding}"` };
    }
    return { ok: true, text: Buffer.from(j.content || '', 'base64').toString('utf8') };
  } catch (err) {
    // Match the FULL message: real execFileSync throws "Command failed: gh api ...\n
    // <stderr>", so the "HTTP 404" marker lands on line 2+ — split()[0] would miss
    // it and misclassify a missing attestation (the common case) as a fatal error.
    const full = String((err && err.message) || err);
    return { ok: false, notFound: /HTTP 404/.test(full), reason: full.split('\n')[0] };
  }
}

function latestEntryPath(text) {
  let entries;
  try { entries = JSON.parse(text).entries; } catch (_) { return null; }
  if (!Array.isArray(entries) || !entries.length) return null;
  const latest = [...entries].sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)))[0];
  return latest && latest.path ? latest.path : null;
}

// Returns 0 on success (populated dir), 2 on a fatal gh error. A repo whose
// attestation is absent (404) is skipped and later surfaces as not-attested.
function doFetch(gh, dir, fleetEntries) {
  for (const { owner, repo } of fleetEntries) {
    if (!validSegment(owner) || !validSegment(repo)) {
      process.stderr.write(`portfolio-rollup: invalid fleet repo "${owner}/${repo}" (chars [A-Za-z0-9._-], no "..", no "/")\n`);
      return 2;
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const { owner, repo } of fleetEntries) {
    const idx = fetchContents(gh, `repos/${owner}/${repo}/contents/.claude/attestations/index.json`);
    if (!idx.ok) { if (idx.notFound) continue; return fetchFail(owner, repo, idx.reason); }
    const relPath = latestEntryPath(idx.text);
    if (!relPath) continue;
    if (!validRelPath(relPath)) {
      process.stderr.write(`portfolio-rollup: skipping ${owner}/${repo}: index path "${relPath}" is not a safe .claude/attestations/ path\n`);
      continue;
    }
    const att = fetchContents(gh, `repos/${owner}/${repo}/contents/${relPath}`);
    if (!att.ok) { if (att.notFound) continue; return fetchFail(owner, repo, att.reason); }
    fs.writeFileSync(path.join(dir, `${owner}__${repo}.json`), att.text.endsWith('\n') ? att.text : `${att.text}\n`);
  }
  return 0;
}

function fetchFail(owner, repo, reason) {
  process.stderr.write(
    `portfolio-rollup: gh error for ${owner}/${repo}: ${reason}\n` +
    '  (gh must be installed, authenticated, and have org read access for --fetch.)\n');
  return 2;
}

// --- verify mode --------------------------------------------------------------

function runVerify(file, jsonOut) {
  const report = readJson(path.resolve(file));
  if (!report) { process.stderr.write(`portfolio-rollup: cannot read rollup: ${file}\n`); return 2; }
  const algo = report.integrity && report.integrity.algo;
  const stored = (report.integrity && report.integrity.hash) || null;
  const recomputed = algo === 'sha256' ? contentHash(report) : null;
  const ok = algo === 'sha256' && Boolean(stored) && stored === recomputed;
  const msg = ok
    ? `OK: ${file} integrity verified (sha256 ${recomputed}). NOTE: checksum detects corruption, not forgery.`
    : `MISMATCH: ${file} rollup integrity does not match its content (corrupt or tampered).`;
  process.stdout.write((jsonOut ? JSON.stringify({ ok, storedHash: stored, recomputedHash: recomputed }, null, 2) : msg) + '\n');
  return ok ? 0 : 1;
}

// --- main ---------------------------------------------------------------------

function resolveFleet(flags, cwd) {
  if (!flags.fleet && !flags.fetch) return { ok: true, entries: [], file: null };
  const file = path.resolve(cwd, flags.fleet || 'fleet.json');
  const f = readFleet(file);
  if (!f.ok) { process.stderr.write(`portfolio-rollup: ${f.reason}\n`); return { ok: false }; }
  return { ...f, file };
}

function writeReport(outPath, report) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  return outPath;
}

function run(argv, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const gh = opts.gh || defaultGh;
  const now = opts.now || (() => new Date().toISOString());
  const flags = parseFlags(argv);
  if (flags.verify) return runVerify(flags.verify, flags.json);
  if (!flags.dir) { process.stderr.write('portfolio-rollup: <collection-dir> is required (or --verify <file>)\n'); return 2; }

  const dir = path.resolve(cwd, flags.dir);
  const fleet = resolveFleet(flags, cwd);
  if (!fleet.ok) return 2;
  if (flags.fetch) { const code = doFetch(gh, dir, fleet.entries); if (code !== 0) return code; }

  const outPath = path.resolve(cwd, flags.out || DEFAULT_OUT);
  const exclude = new Set([outPath, fleet.file].filter(Boolean));
  const target = flags.targetVersion || (opts.runningVersion !== undefined ? opts.runningVersion : runningVersion());
  const report = core.buildReport({ rows: collect(dir, fleet.entries, target, exclude), target, now: now() });
  if (flags.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  writeReport(outPath, report);
  const s = report.summary;
  process.stdout.write(
    `portfolio-rollup: ${s.total} repo(s) — ${s.compliant} compliant, ${s.non_compliant} non-compliant, ` +
    `${s.not_evaluated} not-evaluated, ${s.not_attested} not-attested, ${s.integrity_failed} integrity-failed; ` +
    `portfolio_compliant=${report.portfolio_compliant}. Wrote ${path.relative(cwd, outPath)}.\n`);
  return 0;
}

module.exports = { run, parseFlags, enumerateAttestations };

if (require.main === module) process.exit(run(process.argv.slice(2), {}));
