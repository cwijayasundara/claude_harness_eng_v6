#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/control-budget-gate.js [--check]
// Subtractive ratchet on the harness's own control count (harness-simplification
// P0). Reads harness-manifest.json + .claude/state/control-budget-baseline.json
// and enforces: the count of registered controls (guides+sensors, non-planned)
// may only stay flat or drop, unless each newly-added control carries a
// net_add_justification. Net growth without justification exits 1 (BLOCK).
//   default  -> ratchet: writes the new baseline on pass (down on removal, up on
//               a justified add), like cycle-gate.js.
//   --check  -> read-only: never writes; still exits 1 on a block (for CI / test
//               / a pre-commit backstop where mutating state is undesirable).
// Run via `npm run control-budget`, in /retro, or when adding/removing a control.
// Exit 0 = within budget, 1 = over budget (unjustified growth), 2 = IO error.

const fs = require('fs');
const path = require('path');
const { controlIds, justifiedIds, budgetDecision } = require('../hooks/lib/control-budget');

const REPO = path.resolve(__dirname, '..', '..');
const MANIFEST = path.join(REPO, 'harness-manifest.json');
const BASELINE = path.join(REPO, '.claude', 'state', 'control-budget-baseline.json');

function readBaseline() {
  try {
    const b = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    return b && Number.isFinite(b.count) && Array.isArray(b.ids) ? b : undefined;
  } catch (_) {
    return undefined;
  }
}

function writeBaseline(newBaseline) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  const payload = { count: newBaseline.count, ids: newBaseline.ids };
  fs.writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + '\n');
}

function blockMessage(d) {
  return (
    `BLOCKED: harness control count rose ${d.baseline} -> ${d.count} without justification.\n` +
    'The harness ratchets its own complexity: a new control must either REPLACE one\n' +
    '(keep the count flat/down) or carry a written reason. Unjustified additions:\n' +
    d.unjustified.map((id) => `  - ${id}`).join('\n') +
    '\nFix: remove a control to net-flat, OR add "net_add_justification": "<why this earns\n' +
    'its keep>" to each new manifest entry, then re-run `npm run control-budget`.\n'
  );
}

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch (err) {
    process.stderr.write(`control-budget: cannot read ${MANIFEST}: ${err.message}\n`);
    process.exit(2);
  }
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const manifest = loadManifest();
  const d = budgetDecision(controlIds(manifest), readBaseline(), justifiedIds(manifest));

  if (d.blocked) {
    process.stderr.write(blockMessage(d));
    process.exit(1);
  }

  if (!checkOnly) writeBaseline(d.newBaseline);
  const verb = d.baselineRun ? 'established' : (d.count < d.baseline ? 'ratcheted down' : 'held');
  process.stdout.write(`control-budget OK: ${d.count} controls (baseline ${verb}${checkOnly ? ', not written' : ''}).\n`);
  process.exit(0);
}

if (require.main === module) main();

module.exports = { readBaseline };
