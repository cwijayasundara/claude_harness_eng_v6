#!/usr/bin/env node

'use strict';

// Loop-health scorecard orchestrator (agentic-flywheel §4.1). Thin CLI over
// hooks/lib/loop-health.js: condenses existing run-state into a deterministic
// scorecard for the /retro recommender and for human review. REPORT-ONLY —
// exit 0 always, changes nothing (same contract as agent-readiness.js).

const fs = require('fs');
const path = require('path');
const { buildScorecard, renderMd } = require('../hooks/lib/loop-health.js');

function arg(argv, name, fb) {
  const i = argv.indexOf(name);
  return i === -1 ? fb : argv[i + 1];
}

function main() {
  const argv = process.argv.slice(2);
  const root = arg(argv, '--root', process.cwd());
  const generatedAt = new Date().toISOString();
  const scorecard = buildScorecard(root);
  const out = { generatedAt, ...scorecard };

  const outDir = path.join(root, 'specs', 'retro');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'loop-health.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(outDir, 'loop-health.md'), renderMd(scorecard, generatedAt));

  const t = scorecard.signals.telemetry;
  process.stdout.write(
    `loop-health: ${t.events} events, ${scorecard.signals.failures.total} failures, ` +
    `${scorecard.notes.length} observation(s). Report: specs/retro/loop-health.md\n`,
  );
  process.exit(0);
}

module.exports = { main };

if (require.main === module) main();
