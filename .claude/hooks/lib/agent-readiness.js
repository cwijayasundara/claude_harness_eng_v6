'use strict';

// Pure per-pillar scoring logic for the agent-readiness report (gap G21) —
// this file: Style & Validation, Architecture Fitness (G18/G8 ratchets),
// Testing (coverage ratchet, G7 mutation, G15/G16 regression, G20 AT). The
// remaining five pillars live in agent-readiness-project.js (same split
// rationale as regression-gate.js/impact-scope.js/local-regression-gate.js —
// one file, one responsibility, under the 300-line cap). Aggregates state
// this harness's OWN prior sensors already produce; invents no new
// measurements. CLI orchestration + rendering live in
// scripts/agent-readiness.js.

const fs = require('fs');
const path = require('path');
const { readJsonSafe, pillar, bool, hasNpmScript, defaultToolCheck } = require('./agent-readiness-shared');

// --- Style & Validation --------------------------------------------------

const ESLINT_CONFIGS = [
  '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json',
  '.eslintrc.yml', '.eslintrc.yaml', 'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
];

function hasEslintConfig(root) {
  if (ESLINT_CONFIGS.some((n) => fs.existsSync(path.join(root, n)))) return true;
  const pkg = readJsonSafe(path.join(root, 'package.json'));
  return !!(pkg && pkg.eslintConfig);
}

function hasRuffConfig(root) {
  if (fs.existsSync(path.join(root, 'ruff.toml')) || fs.existsSync(path.join(root, '.ruff.toml'))) return true;
  try {
    return /\[tool\.ruff\]/.test(fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf8'));
  } catch (_) {
    return false;
  }
}

function jsStyleState(root, runCheck) {
  const configured = hasEslintConfig(root);
  const provisioned = configured ? runCheck(['npx', '--no-install', 'eslint', '--version'], root) : false;
  return { configured, provisioned };
}

function pyStyleState(root, runCheck) {
  const configured = hasRuffConfig(root);
  const provisioned = configured ? runCheck(['ruff', '--version'], root) : false;
  return { configured, provisioned };
}

function summarizeStyleState(s) {
  if (!s.configured) return 'not configured';
  return s.provisioned ? 'configured + provisioned' : 'configured but tool unprovisioned';
}

function worstStyleStatus(states) {
  if (states.every((s) => s.configured && s.provisioned)) return 'active';
  if (states.every((s) => !s.configured)) return 'planned';
  return 'partial';
}

function styleDetail(hasJs, hasPy, states) {
  const parts = [];
  let i = 0;
  if (hasJs) parts.push(`js: ${summarizeStyleState(states[i++])}`);
  if (hasPy) parts.push(`py: ${summarizeStyleState(states[i++])}`);
  return parts.join('; ');
}

function styleValidationPillar(root, opts) {
  const runCheck = (opts && opts.runCheck) || defaultToolCheck;
  const hasJs = fs.existsSync(path.join(root, 'package.json'));
  const hasPy = fs.existsSync(path.join(root, 'pyproject.toml')) || fs.existsSync(path.join(root, 'requirements.txt'));
  if (!hasJs && !hasPy) {
    return pillar('style-validation', 'Style & Validation', 'planned',
      'No JS/TS or Python stack detected.',
      'Scaffold a stack (package.json or pyproject.toml) so lint/type tooling can apply.');
  }
  const states = [];
  if (hasJs) states.push(jsStyleState(root, runCheck));
  if (hasPy) states.push(pyStyleState(root, runCheck));
  const status = worstStyleStatus(states);
  return pillar('style-validation', 'Style & Validation', status, styleDetail(hasJs, hasPy, states),
    'Add the missing lint config, and ensure eslint/ruff is actually installed (not just referenced) — verify-on-save and pre-commit already enforce it once both are true.');
}

// --- Architecture Fitness (G18 coupling ratchet + G8 cycle ratchet) ------

function architectureFitnessPillar(root) {
  const cyclePath = path.join(root, '.claude', 'state', 'cycle-baseline.txt');
  const couplingPath = path.join(root, '.claude', 'state', 'coupling-baseline.txt');
  const cycleOk = fs.existsSync(cyclePath);
  const couplingOk = fs.existsSync(couplingPath);
  if (cycleOk && couplingOk) {
    const cycles = parseFloat(fs.readFileSync(cyclePath, 'utf8').trim()) || 0;
    const hubs = fs.readFileSync(couplingPath, 'utf8').split('\n').filter(Boolean).length;
    return pillar('architecture-fitness', 'Architecture Fitness', 'active',
      `Cycle and coupling ratchets established (baseline: ${cycles} cycle(s), ${hubs} unstable hub(s)).`, null);
  }
  if (cycleOk || couplingOk) {
    return pillar('architecture-fitness', 'Architecture Fitness', 'partial',
      `Only one ratchet baseline exists (cycle: ${bool(cycleOk)}, coupling: ${bool(couplingOk)}).`,
      'Run `npm run cycles` and `npm run coupling-gate` once a code-graph exists to establish both baselines.');
  }
  return pillar('architecture-fitness', 'Architecture Fitness', 'planned',
    'No cycle or coupling ratchet baseline has been established yet.',
    'Run `/code-map` (or `/brownfield`), then `npm run cycles && npm run coupling-gate`, to establish the architecture ratchets.');
}

// --- Testing (coverage ratchet, G7 mutation, G15/G16 regression, G20 AT) -

function countFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()).length;
  } catch (_) {
    return 0;
  }
}

function testingSignals(root) {
  const coverageOk = fs.existsSync(path.join(root, '.claude', 'state', 'coverage-baseline.txt'));
  const mutationOk = fs.existsSync(path.join(root, '.claude', 'scripts', 'mutation-gate.js')) && hasNpmScript(root, 'mutation');
  const regressionOk = fs.existsSync(path.join(root, '.claude', 'scripts', 'regression-gate.js')) &&
    fs.existsSync(path.join(root, '.claude', 'scripts', 'local-regression-gate.js')) &&
    hasNpmScript(root, 'regression-gate') && hasNpmScript(root, 'local-regression-gate');
  return { coverageOk, mutationOk, regressionOk };
}

function testingPillar(root) {
  const { coverageOk, mutationOk, regressionOk } = testingSignals(root);
  const atCount = countFiles(path.join(root, 'specs', 'test_artefacts', 'acceptance'));
  const activeCount = [coverageOk, mutationOk, regressionOk].filter(Boolean).length;
  const status = activeCount === 3 ? 'active' : activeCount === 0 ? 'planned' : 'partial';
  const atNote = atCount > 0
    ? `${atCount} acceptance-test artifact(s) found (G20 adopted).`
    : "No acceptance-test artifacts yet under specs/test_artefacts/acceptance/ (G20 not yet adopted — informational, doesn't affect this pillar's status).";
  return pillar('testing', 'Testing', status,
    `Coverage ratchet: ${bool(coverageOk)}; mutation gate: ${bool(mutationOk)}; regression gates: ${bool(regressionOk)}. ${atNote}`,
    'Run the test suite once to seed the coverage baseline, and confirm mutation-gate.js / regression-gate.js / local-regression-gate.js are wired into package.json scripts.');
}

module.exports = { styleValidationPillar, architectureFitnessPillar, testingPillar };
