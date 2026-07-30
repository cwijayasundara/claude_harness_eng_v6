#!/usr/bin/env node

'use strict';

// Prune old harness runtime churn under .claude/runs/ and .claude/state/.
// Project Zero Phase 2: keep dogfood history bounded without deleting active state.
//
// Usage:
//   node .claude/scripts/runs-retention.js [--root path] [--runs-days N] [--archive-days N]
//                                         [--cache-days N] [--dry-run]
//
// Defaults: runs 14 days, archive 30 days, transient caches 7 days.
// Exit 0 always (best-effort hygiene).

const fs = require('fs');
const path = require('path');

const DEFAULT_RUNS_DAYS = 14;
const DEFAULT_ARCHIVE_DAYS = 30;
// context-cache / tool-output are regenerated on demand — a short window is enough.
const DEFAULT_CACHE_DAYS = 7;

/**
 * Every directory of harness churn that has a retention policy.
 *
 * context-cache and tool-output are listed here because they had none: they
 * reached 86MB unbounded. context-cache entries are named by content hash
 * ("bc2be0c7ad3617e8.raw") with no date anywhere in the name, so they can only
 * be aged by mtime — a name-only rule would prune nothing and still report
 * success.
 */
const RETENTION_DIRS = Object.freeze([
  { label: 'runs', rel: ['.claude', 'runs'], daysFlag: '--runs-days', defaultDays: DEFAULT_RUNS_DAYS },
  { label: 'archive', rel: ['.claude', 'state', 'archive'], daysFlag: '--archive-days', defaultDays: DEFAULT_ARCHIVE_DAYS },
  { label: 'context-cache', rel: ['.claude', 'state', 'context-cache'], daysFlag: '--cache-days', defaultDays: DEFAULT_CACHE_DAYS },
  { label: 'tool-output', rel: ['.claude', 'state', 'tool-output'], daysFlag: '--cache-days', defaultDays: DEFAULT_CACHE_DAYS },
]);

// Daily run ledgers: 2026-07-10.jsonl
const RUN_DAY_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
// Telemetry / archive stamps often embed ISO-ish timestamps
const ISO_DAY_RE = /(\d{4}-\d{2}-\d{2})/;

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  return argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

/**
 * @param {string} name
 * @param {Date} now
 * @param {number} keepDays
 * @returns {boolean} true if file should be deleted
 */
function isStaleByName(name, now, keepDays) {
  let day = null;
  const runM = name.match(RUN_DAY_RE);
  if (runM) day = runM[1];
  else {
    const isoM = name.match(ISO_DAY_RE);
    if (isoM) day = isoM[1];
  }
  if (!day) return false; // unknown naming — keep
  const fileDate = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(fileDate.getTime())) return false;
  const cutoff = new Date(now.getTime() - keepDays * 24 * 60 * 60 * 1000);
  return fileDate < cutoff;
}

/**
 * Pure planner: given directory listing + mtimes fallback, return names to delete.
 * @param {{ name: string, mtimeMs?: number }[]} entries
 * @param {{ now: Date, keepDays: number, preferName: boolean }} opts
 */
function planDeletes(entries, opts) {
  const { now, keepDays, preferName } = opts;
  const out = [];
  const cutoffMs = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  for (const e of entries) {
    if (preferName && isStaleByName(e.name, now, keepDays)) {
      out.push(e.name);
      continue;
    }
    if (!preferName || !ISO_DAY_RE.test(e.name)) {
      if (typeof e.mtimeMs === 'number' && e.mtimeMs < cutoffMs) out.push(e.name);
    }
  }
  return out;
}

function listEntries(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((name) => {
    const p = path.join(dir, name);
    let mtimeMs;
    try {
      mtimeMs = fs.statSync(p).mtimeMs;
    } catch (_) {
      mtimeMs = undefined;
    }
    return { name, path: p, mtimeMs };
  }).filter((e) => {
    try {
      return fs.statSync(e.path).isFile();
    } catch (_) {
      return false;
    }
  });
}

function pruneDir(dir, keepDays, now, { dryRun, preferName }) {
  const entries = listEntries(dir);
  const names = planDeletes(entries, { now, keepDays, preferName });
  const deleted = [];
  for (const name of names) {
    const full = path.join(dir, name);
    if (!dryRun) {
      try {
        fs.unlinkSync(full);
      } catch (err) {
        process.stderr.write(`runs-retention: could not delete ${full}: ${err.message}\n`);
        continue;
      }
    }
    deleted.push(name);
  }
  return deleted;
}

/** Resolve each spec's window from argv and prune it. */
function pruneAll(root, argv, now, dryRun) {
  return RETENTION_DIRS.map((spec) => {
    const days = Math.max(
      1,
      parseInt(arg(argv, spec.daysFlag, String(spec.defaultDays)), 10) || spec.defaultDays
    );
    // Aged by name where the name carries a date, by mtime where it does not
    // (see RETENTION_DIRS) — preferName:true selects exactly that.
    const deleted = pruneDir(path.join(root, ...spec.rel), days, now, { dryRun, preferName: true });
    return { label: spec.label, days, deleted };
  });
}

function report(results, dryRun) {
  const mode = dryRun ? 'dry-run' : 'deleted';
  const summary = results
    .map((r) => `${r.label} ${r.deleted.length} file(s) older than ${r.days}d`)
    .join('; ');
  process.stdout.write(`runs-retention (${mode}): ${summary}.\n`);
  if (!dryRun) return;
  for (const r of results) {
    for (const n of r.deleted.slice(0, 10)) {
      process.stdout.write(`  would delete ${r.label}/${n}\n`);
    }
    if (r.deleted.length > 10) {
      process.stdout.write(`  … ${r.deleted.length - 10} more ${r.label}\n`);
    }
  }
}

function main(argv = process.argv.slice(2)) {
  const root = path.resolve(arg(argv, '--root', process.cwd()));
  const dryRun = hasFlag(argv, '--dry-run');
  report(pruneAll(root, argv, new Date(), dryRun), dryRun);
  process.exit(0);
}

module.exports = {
  isStaleByName,
  planDeletes,
  RETENTION_DIRS,
  DEFAULT_RUNS_DAYS,
  DEFAULT_ARCHIVE_DAYS,
  DEFAULT_CACHE_DAYS,
};

if (require.main === module) main();
