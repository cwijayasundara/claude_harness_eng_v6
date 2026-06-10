#!/usr/bin/env node

'use strict';

// Model-tier presets — map a cost posture to the per-agent model pins.
//
// The harness runs a GAN: generation is the high-volume output bucket (cheapest
// capable tier), judgment is lower-volume but quality-sensitive. Fable 5 is ~2x
// Opus 4.8, so it is spent only where first-shot quality has high downstream
// leverage and low token volume (planning, which cascades), never on the volume
// bucket (generation) or on the security reviewer (Fable 5's cyber safety
// classifiers can refuse offensive-security reasoning and fall back anyway).
//
//   cost        (Profile A) — zero Fable. Sonnet generation, Opus judgment.
//   balanced    (Profile B) — Fable only on the planner; everything else cost-
//                             conscious. The shipped default.
//   max-quality              — Fable on the judgment roles, generator bumped to
//                             Opus (never Fable on volume), security stays Opus.
//
// HARD INVARIANT: security-reviewer is never Fable in any preset.

const fs = require('fs');
const path = require('path');

const PRESETS = {
  cost: {
    planner: 'opus', generator: 'sonnet', evaluator: 'opus',
    'design-critic': 'opus', 'security-reviewer': 'opus', 'codebase-explorer': 'sonnet',
  },
  balanced: {
    planner: 'fable', generator: 'sonnet', evaluator: 'opus',
    'design-critic': 'opus', 'security-reviewer': 'opus', 'codebase-explorer': 'sonnet',
  },
  'max-quality': {
    planner: 'fable', generator: 'opus', evaluator: 'fable',
    'design-critic': 'fable', 'security-reviewer': 'opus', 'codebase-explorer': 'sonnet',
  },
};

// Recommended session/orchestrator model per tier (guidance, not an agent pin).
const SESSION = { cost: 'opus', balanced: 'opus', 'max-quality': 'fable' };

function modelsForTier(preset) {
  const pins = PRESETS[preset];
  if (!pins) throw new Error(`unknown model tier preset: ${preset}`);
  if (pins['security-reviewer'] === 'fable') {
    throw new Error('invariant violated: security-reviewer must never be Fable');
  }
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
