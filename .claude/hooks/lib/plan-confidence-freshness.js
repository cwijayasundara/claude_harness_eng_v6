'use strict';

// Freshness for the plan-confidence verdict.
//
// The audited run wrote `score: 0, band: low, hardLow: true` and then ran
// /design fifteen hours later. Worse than being ignored, the verdict was WRONG
// by then: it still claimed 7 needs-breakdown stories after a review round had
// brought it to 6. A confidence verdict that describes a superseded plan is
// more dangerous than no verdict, because it reads as current.
//
// Same remedy as plan-approval's digest-voids-on-change — record what the
// verdict was computed from, so a reader can tell whether it still applies.
// Pure: the caller injects the reader, so this is testable without file I/O.

const crypto = require('crypto');

/**
 * @param {(rel: string) => string|null} readText
 * @param {string[]} paths relative paths the verdict is derived from
 * @returns {Object<string, string|null>} digest per path; null when absent —
 *   absent and unchanged are different facts and must not collapse.
 */
function digestInputs(readText, paths) {
  const out = {};
  for (const rel of paths) {
    const body = readText(rel);
    out[rel] = body === null || body === undefined
      ? null
      : crypto.createHash('sha256').update(body).digest('hex');
  }
  return out;
}

/**
 * @param {object|null} stored the verdict read back from disk
 * @param {Object<string, string|null>} current digests computed now
 * @returns {{fresh: boolean, reason: string|null, changed: string[]}}
 */
function verifyFreshness(stored, current) {
  if (!stored || typeof stored !== 'object') {
    return { fresh: false, reason: 'no verdict recorded', changed: [] };
  }
  if (!stored.inputs || typeof stored.inputs !== 'object') {
    // A verdict written before inputs were recorded cannot be shown to still
    // apply. Treating that as fresh would be the vacuous pass this exists to stop.
    return { fresh: false, reason: 'verdict predates input tracking', changed: [] };
  }
  const changed = Object.keys(current).filter((rel) => stored.inputs[rel] !== current[rel]);
  return changed.length
    ? { fresh: false, reason: 'inputs changed since it was computed', changed }
    : { fresh: true, reason: null, changed: [] };
}

/**
 * The `--verify` command. Reads the stored verdict, recomputes the digests, and
 * returns an exit code plus the line to print. Never recomputes the score —
 * that is `--gate`'s job, and conflating them would let a stale verdict be
 * silently refreshed instead of reported.
 *
 * @returns {{code: number, out: string|null, err: string|null}}
 */
function runVerify({ verdictPath, readText, paths, readFile }) {
  let stored = null;
  try {
    stored = JSON.parse(readFile(verdictPath));
  } catch (_) { /* reported as not-fresh below */ }

  const { fresh, reason, changed } = verifyFreshness(stored, digestInputs(readText, paths));
  if (!fresh) {
    const detail = changed.length ? ` (${changed.join(', ')})` : '';
    return {
      code: 1,
      out: null,
      err: `plan-confidence --verify: STALE — ${reason}${detail}. Recompute before relying on it.\n`,
    };
  }
  return {
    code: 0,
    out: `plan-confidence --verify: current (${stored.band.toUpperCase()}, computed ${stored.computed_at}).\n`,
    err: null,
  };
}

module.exports = { digestInputs, verifyFreshness, runVerify };
