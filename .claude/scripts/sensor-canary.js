#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/sensor-canary.js [--json]
// Runs every preventive-gate canary (.claude/config/sensor-canaries.js) against the
// gate's REAL detector and classifies it. A gate that misses its known-bad input is
// DEAD (broken or inert); one that fires on the known-good input is FALSE-POSITIVE.
// Only a gate that bites the bad and stays quiet on the good is PROVEN-LIVE. Feeds
// sensor-value-report so "never blocked" can split into proven-live vs still-ambiguous.
// Exit 1 if any canary is not LIVE — a preventive gate failing its own canary is a
// real regression, not a report-only signal.

const { CANARIES } = require('../config/sensor-canaries');

// bit = fired on the known-bad input; quiet = did NOT fire on the known-good input.
function classify(result) {
  if (!result || !result.bit) return 'DEAD';
  if (!result.quiet) return 'FALSE-POSITIVE';
  return 'LIVE';
}

function runCanaries(canaries) {
  return (canaries || CANARIES).map((c) => {
    let status;
    try { status = classify(c.run()); } catch (e) { status = 'DEAD'; }
    return { probe: c.probe, sensors: c.sensors, why: c.why, status };
  });
}

// Ledger sensor names with a LIVE canary — what sensor-value-report reads to promote
// a "never blocked" gate out of the shelfware-candidate bucket.
function provenLiveSensors(canaries) {
  const live = new Set();
  for (const r of runCanaries(canaries)) {
    if (r.status === 'LIVE') for (const s of r.sensors) live.add(s);
  }
  return live;
}

function main(argv) {
  const results = runCanaries(CANARIES);
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } else {
    process.stdout.write(`sensor-canary: ${results.length} preventive-gate canaries\n`);
    for (const r of results) process.stdout.write(`  ${r.status.padEnd(14)} ${r.probe} — ${r.why}\n`);
  }
  return results.every((r) => r.status === 'LIVE') ? 0 : 1;
}

module.exports = { classify, runCanaries, provenLiveSensors };

if (require.main === module) process.exit(main(process.argv.slice(2)));
