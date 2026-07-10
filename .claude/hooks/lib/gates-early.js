'use strict';

// Pre-commit gates that run before / around the source-only filter.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkContentViolations, loadLayerConfig, getLayer } = require('./layers');
const { checkContextContent, loadContextConfig } = require('./contexts');
const { findImpureFiles } = require(path.join(__dirname, '..', '..', 'git-hooks', 'lib', 'refactor-purity'));
const { baselineSecretFindings } = require('./security-scan');
const { secretScanExempt } = require('./secrets');
const { failBlock, noteSkip, requireScript } = require('./pre-commit-util');

function checkSecrets(ctx) {
  const { projectDir, staged } = ctx;
  const targets = staged.filter((f) => !secretScanExempt(f, projectDir));
  const findings = baselineSecretFindings(targets, (f) => fs.readFileSync(path.join(projectDir, f), 'utf8'));
  if (findings.length === 0) return;
  const lines = findings.map((x) => `  ${x.file} — ${x.message}`);
  failBlock({
    id: 'secret-scan',
    title: 'potential secrets in staged files',
    detail: `${lines.join('\n')}\n`,
    fix: 'move the secret to .env (gitignored) and reference it via an env var; never commit credentials. If this is a non-secret fixture, place it under an exempt path or rename it.',
    waive: 'reviewed exception in specs/reviews/sensor-waivers.json (sensor_id: secret-scan)',
    minTier: 'minimal',
  });
}

function checkAmendmentProvenance(ctx) {
  const { projectDir, staged } = ctx;
  if (process.env.HARNESS_AMENDMENT_GATE === 'off') {
    noteSkip('amendment-provenance', 'HARNESS_AMENDMENT_GATE=off');
    return;
  }
  let checkFn;
  try {
    ({ checkProvenance: checkFn } = requireScript('amendment-provenance-check'));
  } catch (_) {
    noteSkip('amendment-provenance', 'sensor script missing or unloadable from .claude/scripts');
    return;
  }
  let baselineExists = false;
  try {
    execFileSync('git', ['show', 'HEAD:specs/design/architecture.md'], { cwd: projectDir, encoding: 'utf8' });
    baselineExists = true;
  } catch (_) {
    baselineExists = false;
  }
  const verdict = checkFn(staged, baselineExists);
  if (!verdict.pass) {
    failBlock({
      id: 'amendment-provenance',
      title: verdict.reason,
      fix: 'write a design amendment under specs/design/amendments/ (see docs/superpowers/specs/2026-07-04-sprint-delta-lane-design.md) in the same commit as the specs/design/ change.',
      envOff: 'HARNESS_AMENDMENT_GATE',
      minTier: 'minimal',
    });
  }
}

function checkTestDeletionGate(ctx) {
  const { projectDir } = ctx;
  if (process.env.HARNESS_TEST_DELETION_GATE === 'off') {
    noteSkip('test-deletion-guard', 'HARNESS_TEST_DELETION_GATE=off');
    return;
  }
  let gate;
  try {
    gate = requireScript('test-deletion-gate');
  } catch (_) {
    noteSkip('test-deletion-guard', 'sensor script missing or unloadable from .claude/scripts');
    return;
  }
  const exec = (cmd, args) => execFileSync(cmd, args, { cwd: projectDir, encoding: 'utf8' });
  const verdict = gate.checkStaged(exec);
  if (!verdict.pass) {
    failBlock({
      id: 'test-deletion-guard',
      title: 'test-deletion-guard (G31) — a staged commit removes or newly skips existing test coverage',
      detail: `${verdict.findings.map(gate.findingLine).join('\n')}\n`,
      fix: 'restore the test, or replace it with an equivalent one covering the same behavior — do not make a suite pass by deleting or skipping the test that catches the regression.',
      waive: 'genuine exception (removed functionality / quarantine) in specs/reviews/sensor-waivers.json (sensor_id: test-deletion-guard)',
      envOff: 'HARNESS_TEST_DELETION_GATE',
      minTier: 'standard',
    });
  }
}

function checkRefactorPurity(ctx) {
  const { staged } = ctx;
  if (process.env.HARNESS_COMMIT_KIND !== 'refactor') return;
  const impure = findImpureFiles(staged);
  if (impure.length === 0) return;
  failBlock({
    id: 'refactor-purity',
    title: 'refactor commit touches test/snapshot files',
    detail: `${impure.map((f) => `  ${f}`).join('\n')}\n`,
    fix: 'a refactor commit changes no behavior — tests and snapshots must stay byte-identical. Split the behavioral work into its own commit (see .claude/skills/keeping-refactors-pure/SKILL.md).',
    minTier: 'minimal',
  });
}

function checkLayers(ctx) {
  const { projectDir, stagedSource } = ctx;
  const layerCfg = loadLayerConfig(projectDir);
  const violations = [];
  let mapped = 0;
  for (const file of stagedSource) {
    if (getLayer(file, layerCfg) !== null) mapped++;
    let content;
    try {
      content = fs.readFileSync(path.join(projectDir, file), 'utf8');
    } catch (_) {
      try { content = fs.readFileSync(file, 'utf8'); } catch (_2) { continue; }
    }
    violations.push(...checkContentViolations(file, content, layerCfg));
  }
  if (violations.length > 0) {
    const lines = violations.map((v) => `  ${v.filePath}:${v.line} — ${v.layer} cannot import from ${v.imported}`);
    failBlock({
      id: 'layer-imports',
      title: 'Architecture violations found — fix before committing',
      detail: `${lines.join('\n')}\n`,
      fix: 'Move imports to the correct layer or extract shared types to src/types/.',
      minTier: 'minimal',
    });
  }
  if (mapped === 0 && stagedSource.length > 0) {
    process.stdout.write(
      `note: layer gate matched no staged file — this project's layout does not follow ` +
      `${layerCfg.roots.join('|')}/<layer>/. Configure "architecture": {"layers": [...], "layer_roots": [...]} ` +
      `in project-manifest.json if it should be layer-checked.\n`
    );
  }
}

function checkContexts(ctx) {
  const { projectDir, stagedSource } = ctx;
  const cfg = loadContextConfig(projectDir);
  if (!cfg) return;
  const violations = [];
  for (const file of stagedSource) {
    let content;
    try {
      content = fs.readFileSync(path.join(projectDir, file), 'utf8');
    } catch (_) {
      try { content = fs.readFileSync(file, 'utf8'); } catch (_2) { continue; }
    }
    violations.push(...checkContextContent(file, content, cfg));
  }
  if (violations.length === 0) return;
  const lines = violations.map((v) => `  ${v.filePath}:${v.line} — "${v.from}" reaches into "${v.to}" internals (${v.importPath})`);
  failBlock({
    id: 'bounded-context-rules',
    title: 'Bounded-context violations — fix before committing',
    detail: `${lines.join('\n')}\n`,
    fix: 'import the other context only through its public surface (root/index), or add the edge to architecture.contexts.allow in project-manifest.json.',
    minTier: 'minimal',
  });
}

function checkOwnership(ctx) {
  const { projectDir, stagedSource } = ctx;
  if (process.env.HARNESS_OWNERSHIP_GATE === 'off') {
    noteSkip('ownership', 'HARNESS_OWNERSHIP_GATE=off');
    return;
  }
  const mapPath = path.join(projectDir, 'specs', 'design', 'component-map.md');
  if (!fs.existsSync(mapPath)) return;
  let checkFn;
  try {
    ({ checkOwnership: checkFn } = requireScript('ownership-check'));
  } catch (_) {
    noteSkip('ownership', 'sensor script missing or unloadable from .claude/scripts');
    return;
  }
  const verdict = checkFn(stagedSource, fs.readFileSync(mapPath, 'utf8'));
  if (!verdict.pass) {
    const lines = verdict.unowned.map((f) => `  UNOWNED  ${f}`);
    const reason = verdict.reason === 'empty_map'
      ? 'component-map.md parsed to zero owned paths — the map is stale or malformed.\n'
      : '';
    failBlock({
      id: 'ownership-check',
      title: 'staged source files are not owned by any story in specs/design/component-map.md',
      detail: `${lines.join('\n')}${lines.length ? '\n' : ''}${reason}`,
      fix: 'add the file(s) to the owning story\'s row in component-map.md.',
      envOff: 'HARNESS_OWNERSHIP_GATE',
      minTier: 'minimal',
    });
  }
}

module.exports = {
  checkSecrets,
  checkAmendmentProvenance,
  checkTestDeletionGate,
  checkRefactorPurity,
  checkLayers,
  checkContexts,
  checkOwnership,
};
