#!/usr/bin/env node

'use strict';

// Prune old harness runtime churn under .claude/runs/ and .claude/state/archive/.
// Project Zero Phase 2: keep dogfood history bounded without deleting active state.
//
// Usage:
//   node .claude/scripts/runs-retention.js [--root path] [--runs-days N] [--archive-days N]
//                                         [--dry-run]
//
// Defaults: runs 14 days, archive 30 days. Exit 0 always (best-effort hygiene).

const fs = require('fs');
const path = require('path');

const DEFAULT_RUNS_DAYS = 14;
const DEFAULT_ARCHIVE_DAYS = 30;

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

function main(argv = process.argv.slice(2)) {
  const root = path.resolve(arg(argv, '--root', process.cwd()));
  const runsDays = Math.max(1, parseInt(arg(argv, '--runs-days', String(DEFAULT_RUNS_DAYS)), 10) || DEFAULT_RUNS_DAYS);
  const archiveDays = Math.max(1, parseInt(arg(argv, '--archive-days', String(DEFAULT_ARCHIVE_DAYS)), 10) || DEFAULT_ARCHIVE_DAYS);
  const dryRun = hasFlag(argv, '--dry-run');
  const now = new Date();

  const runsDir = path.join(root, '.claude', 'runs');
  const archiveDir = path.join(root, '.claude', 'state', 'archive');

  const runsDeleted = pruneDir(runsDir, runsDays, now, { dryRun, preferName: true });
  // Archive files are mostly timestamped telemetry; use mtime when name has no day
  const archiveDeleted = pruneDir(archiveDir, archiveDays, now, { dryRun, preferName: true });

  const mode = dryRun ? 'dry-run' : 'deleted';
  process.stdout.write(
    `runs-retention (${mode}): runs ${runsDeleted.length} file(s) older than ${runsDays}d; ` +
      `archive ${archiveDeleted.length} file(s) older than ${archiveDays}d.\n`
  );
  if (dryRun && (runsDeleted.length || archiveDeleted.length)) {
    for (const n of runsDeleted.slice(0, 20)) process.stdout.write(`  would delete runs/${n}\n`);
    if (runsDeleted.length > 20) process.stdout.write(`  … ${runsDeleted.length - 20} more runs\n`);
    for (const n of archiveDeleted.slice(0, 10)) process.stdout.write(`  would delete archive/${n}\n`);
    if (archiveDeleted.length > 10) process.stdout.write(`  … ${archiveDeleted.length - 10} more archive\n`);
  }
  process.exit(0);
}

module.exports = {
  isStaleByName,
  planDeletes,
  DEFAULT_RUNS_DAYS,
  DEFAULT_ARCHIVE_DAYS,
};

if (require.main === module) main();
