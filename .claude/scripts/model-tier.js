#!/usr/bin/env node

'use strict';

// Model-tier presets — map a cost posture to the per-agent model pins.
//
// The harness runs a GAN: generation is the high-volume output bucket, judgment
// is lower-volume but quality-sensitive. Judgment (evaluator + reviewers +
// planner) is pinned to Opus 4.8 across every posture. Opus 4.7 is retired
// (superseded by Opus 4.8) and Sonnet 4.6 is retired (superseded by Sonnet 5,
// which now reaches near-Opus quality on coding/agentic work at Sonnet
// pricing) — so the old three-step generation ladder (Sonnet 4.6 -> Opus 4.7
// -> Opus 4.8) collapses to two steps: Sonnet 5 -> Opus 4.8.
//
//   cost        (Profile A) — Sonnet 5 generation, Opus 4.8 judgment. Lowest bill.
//   balanced    (Profile B) — the shipped default. Same generator as cost
//               (Sonnet 5) now that it covers what Opus 4.7 used to.
//   max-quality              — Opus 4.8 generation; codebase-explorer stays Sonnet 5.

const fs = require('fs');
const path = require('path');

// Exact model IDs (not bare aliases) — version-pinned and unambiguous.
const OPUS = 'claude-opus-4-8';     // judgment: evaluator + reviewers + planner
const SONNET5 = 'claude-sonnet-5';  // generation + read-only exploration

const PRESETS = {
  cost: {
    planner: OPUS, generator: SONNET5, evaluator: OPUS,
    'design-critic': OPUS, 'security-reviewer': OPUS, 'diff-reviewer': OPUS,
    'clean-code-reviewer': OPUS, 'codebase-explorer': SONNET5,
  },
  balanced: {
    planner: OPUS, generator: SONNET5, evaluator: OPUS,
    'design-critic': OPUS, 'security-reviewer': OPUS, 'diff-reviewer': OPUS,
    'clean-code-reviewer': OPUS, 'codebase-explorer': SONNET5,
  },
  'max-quality': {
    planner: OPUS, generator: OPUS, evaluator: OPUS,
    'design-critic': OPUS, 'security-reviewer': OPUS, 'diff-reviewer': OPUS,
    'clean-code-reviewer': OPUS, 'codebase-explorer': SONNET5,
  },
};

// Recommended session/orchestrator model per tier (guidance, not an agent pin).
const SESSION = { cost: OPUS, balanced: OPUS, 'max-quality': OPUS };

function modelsForTier(preset) {
  const pins = PRESETS[preset];
  if (!pins) throw new Error(`unknown model tier preset: ${preset}`);
  return { ...pins };
}

function sessionFor(preset) {
  if (!SESSION[preset]) throw new Error(`unknown model tier preset: ${preset}`);
  return SESSION[preset];
}

// Rewrite the `model:` frontmatter line in each agent file to match the preset.
// Returns the list of roles whose model actually changed.
function applyTier(agentsDir, preset) {
  const pins = modelsForTier(preset);
  const changed = [];
  for (const [role, model] of Object.entries(pins)) {
    const file = path.join(agentsDir, `${role}.md`);
    if (!fs.existsSync(file)) continue;
    const before = fs.readFileSync(file, 'utf8');
    const after = before.replace(/^model: .*$/m, `model: ${model}`);
    if (after !== before) {
      fs.writeFileSync(file, after);
      changed.push(role);
    }
  }
  return changed;
}

function printTable(preset) {
  const pins = modelsForTier(preset);
  process.stdout.write(`model tier: ${preset}  (session/orchestrator: ${sessionFor(preset)})\n`);
  for (const [role, model] of Object.entries(pins)) {
    process.stdout.write(`  ${role.padEnd(20)} ${model}\n`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const preset = args.find((a) => !a.startsWith('--')) || 'balanced';
  const applyIdx = args.indexOf('--apply');
  try {
    if (applyIdx !== -1) {
      const dir = args[applyIdx + 1];
      const changed = applyTier(dir, preset);
      process.stdout.write(`applied tier "${preset}" to ${dir} — changed: ${changed.join(', ') || 'none'}\n`);
    } else {
      printTable(preset);
    }
  } catch (err) {
    process.stderr.write(`model-tier: ${err.message}\n`);
    process.exit(2);
  }
}

module.exports = { modelsForTier, sessionFor, applyTier, PRESETS };

if (require.main === module) main();
