'use strict';

// Legacy discipline, sprout-diff, and AT-first pre-commit gates (G17/G23/G29/G30).

const fs = require('fs');
const path = require('path');
const { runMutationOnFiles, renderSurvivors } = require('./mutation-gate');
const { biteCheckFiles } = require('./legacy-bite-check');
const { failBlock, noteSkip, inAutoBuild, requireScript, gitExec } = require('./pre-commit-util');

function computeLegacyDisciplineInputs(projectDir, gate) {
  const execFn = gitExec(projectDir);
  const modified = execFn('git', ['diff', '--cached', '--name-only', '--diff-filter=MR'])
    .split('\n')
    .filter(Boolean)
    .filter((f) => gate.isSource(f) && !gate.isTestFile(f));
  const changedRanges = gate.gitDiffRanges(execFn, 'MR');
  const mapPath = path.join(projectDir, 'specs', 'design', 'component-map.md');
  const mapText = fs.existsSync(mapPath) ? fs.readFileSync(mapPath, 'utf8') : null;
  return { modified, changedRanges, mapText };
}

function reportLegacyDisciplineFailure(verdict) {
  const lines = [
    ...verdict.noVerdict.map((f) => `  NO VERDICT RECORDED       ${f}`),
    ...verdict.uncoveredNoEvidence.map((f) => `  UNCOVERED, NO TEST STAGED ${f}`),
  ];
  failBlock({
    id: 'legacy-discipline-proof',
    title: 'legacy-discipline-proof (G17) — checking-coverage-before-change was not proven for staged file(s)',
    detail: `${lines.join('\n')}\n`,
    fix:
      'run checking-coverage-before-change Step 2 (coverage_map.py piped through record-coverage-verdict.js) for the ' +
      'ACTUALLY-CHANGED lines of these files (a receipt for a different symbol/range in the same file no longer counts, ' +
      'gap G29); for an UNCOVERED verdict, stage a RELATED pin-down or sprout test in the same commit ' +
      '(pinning-down-behavior / sprouting-instead-of-editing — relatedness checked via component-map.md story ownership, ' +
      'then a naming-convention heuristic, gap G29).',
    waive: 'real exception in specs/reviews/sensor-waivers.json (sensor_id: legacy-discipline-proof)',
    envOff: 'HARNESS_LEGACY_DISCIPLINE_GATE',
    minTier: 'standard',
  });
}

function checkLegacyBiteBackstop(projectDir, files) {
  if ((process.env.HARNESS_LEGACY_BITE_CHECK || '').toLowerCase() === 'off') return;
  if (inAutoBuild(projectDir)) return;
  const outcome = biteCheckFiles(files, projectDir, runMutationOnFiles, {});
  if (!outcome.ran) return;
  for (const r of outcome.results) {
    if (r.skipped) noteSkip(`legacy-discipline bite-check (${r.lang})`, r.reason);
  }
  if (outcome.pass) return;
  const detail = (outcome.blocked || []).map((r) => renderSurvivors(r.survived)).filter(Boolean).join('\n');
  failBlock({
    id: 'legacy-discipline-proof',
    title: 'legacy-discipline bite-check (G29) — the staged evidence test does not kill mutants in the UNCOVERED file(s)',
    detail: `${detail}\n`,
    fix: 'the pin-down/sprout test must fail when this logic breaks — add an assertion on the specific behavior, then re-commit.',
    waive: 'real exception in specs/reviews/sensor-waivers.json',
    envOff: 'HARNESS_LEGACY_BITE_CHECK',
    minTier: 'standard',
  });
}

// Everything that decides whether this gate CAN run, before any expensive work.
// Returns the loaded gate module, or null when the gate should skip.
//
// The coverage-tooling check sits here, ahead of computeLegacyDisciplineInputs, which
// shells out to a full `git diff -U0`: running that only to discard the result is
// waste, and on a large commit it is what overflowed the subprocess buffer.
function resolveLegacyGate(ctx) {
  const { projectDir } = ctx;
  if (process.env.HARNESS_LEGACY_DISCIPLINE_GATE === 'off') {
    noteSkip('legacy-discipline', 'HARNESS_LEGACY_DISCIPLINE_GATE=off');
    return null;
  }
  let gate;
  try {
    gate = requireScript('legacy-discipline-gate');
  } catch (_) {
    noteSkip('legacy-discipline', 'sensor script missing or unloadable from .claude/scripts');
    return null;
  }
  const graphPath = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  if (!fs.existsSync(graphPath)) return null;
  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  } catch (_) {
    return null;
  }
  if (!gate.hasSymbolRecords(graph)) return null;

  const stagedProd = (ctx.stagedSource || []).filter((f) => gate.isSource(f) && !gate.isTestFile(f));
  if (gate.coverageToolingMissing && gate.coverageToolingMissing(projectDir, stagedProd)) {
    noteSkip('legacy-discipline', 'no coverage runner for the staged language — the required verdict cannot be produced');
    return null;
  }
  return gate;
}

function checkLegacyDisciplineGate(ctx) {
  const { projectDir, staged } = ctx;
  const gate = resolveLegacyGate(ctx);
  if (!gate) return;
  const { modified, changedRanges, mapText } = computeLegacyDisciplineInputs(projectDir, gate);
  const verdict = gate.checkLegacyDiscipline(modified, gate.readReceipts(projectDir), staged, changedRanges, mapText);
  if (!verdict.pass) { reportLegacyDisciplineFailure(verdict); return; }
  for (const n of verdict.relatednessNotes || []) process.stdout.write(`note: legacy-discipline — ${n}\n`);
  checkLegacyBiteBackstop(projectDir, (verdict.uncoveredEvidence || []).map((e) => e.file));
}

function gateAddedProdFiles(projectDir, gateModule) {
  return gitExec(projectDir)('git', ['diff', '--cached', '--name-only', '--diff-filter=A'])
    .split('\n')
    .filter(Boolean)
    .filter((f) => gateModule.isSource(f) && !gateModule.isTestFile(f));
}

function checkSproutDiffGate(ctx) {
  const { projectDir, staged } = ctx;
  if (process.env.HARNESS_SPROUT_DIFF_GATE === 'off') {
    noteSkip('sprout-diff', 'HARNESS_SPROUT_DIFF_GATE=off');
    return;
  }
  let legacyGate, sproutGate;
  try {
    legacyGate = requireScript('legacy-discipline-gate');
    sproutGate = requireScript('sprout-diff-gate');
  } catch (_) {
    noteSkip('sprout-diff', 'sensor script missing or unloadable from .claude/scripts');
    return;
  }
  const graphPath = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  if (!fs.existsSync(graphPath)) return;
  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  } catch (_) {
    return;
  }
  if (!legacyGate.hasSymbolRecords(graph)) return;

  const { modified, changedRanges, mapText } = computeLegacyDisciplineInputs(projectDir, legacyGate);
  const legacyVerdict = legacyGate.checkLegacyDiscipline(
    modified, legacyGate.readReceipts(projectDir), staged, changedRanges, mapText
  );
  const addedProdFiles = gateAddedProdFiles(projectDir, legacyGate);
  const verdict = sproutGate.checkSproutDiff(legacyVerdict.uncoveredEvidence || [], addedProdFiles, changedRanges, graph, mapText);
  if (!verdict.pass) {
    const lines = verdict.violations.map((v) => `  TOO MANY SYMBOLS TOUCHED  ${v.file} — ${v.symbols.join(', ')}`);
    failBlock({
      id: 'sprout-diff',
      title: 'sprout-diff-one-symbol (G30) — a legacy file\'s staged diff touches more symbols than sprouting-instead-of-editing allows',
      detail: `${lines.join('\n')}\n`,
      fix:
        'the Iron Law is "touch the legacy file at exactly one call line" (or the rename pair for a wrap — ' +
        'at most two symbols). Move the extra logic into the sprout\'s new unit instead of editing these symbols ' +
        'in place (.claude/skills/sprouting-instead-of-editing/SKILL.md).',
      waive: 'real exception in specs/reviews/sensor-waivers.json (sensor_id: sprout-diff-one-symbol)',
      envOff: 'HARNESS_SPROUT_DIFF_GATE',
      minTier: 'standard',
    });
    return;
  }
  for (const w of verdict.assumedWrapPairs || []) {
    process.stdout.write(
      `note: sprout-diff — ${w.file} touches 2 symbols (${w.symbols.join(', ')}) — assumed wrap-rename pair, ` +
        'not independently verified\n'
    );
  }
  for (const n of verdict.classifyNotes || []) process.stdout.write(`note: sprout-diff — ${n}\n`);
  for (const f of verdict.noSymbolRecord || []) {
    process.stdout.write(`note: sprout-diff — no per-file symbol record for ${f}\n`);
  }
  for (const f of verdict.unverifiableRanges || []) {
    process.stdout.write(`note: sprout-diff — changed-range data unavailable for ${f}\n`);
  }
}

function checkAtFirstGate(ctx) {
  const { projectDir } = ctx;
  if (process.env.HARNESS_AT_FIRST_GATE === 'off') {
    noteSkip('at-first', 'HARNESS_AT_FIRST_GATE=off');
    return;
  }
  let gate;
  try {
    gate = requireScript('at-first-gate');
  } catch (_) {
    noteSkip('at-first', 'sensor script missing or unloadable from .claude/scripts');
    return;
  }
  const mapPath = path.join(projectDir, 'specs', 'design', 'component-map.md');
  if (!fs.existsSync(mapPath)) return;
  const added = gitExec(projectDir)('git', ['diff', '--cached', '--name-only', '--diff-filter=A'])
    .split('\n')
    .filter(Boolean)
    .filter((f) => gate.isSource(f) && !gate.isTestFile(f));
  const mapText = fs.readFileSync(mapPath, 'utf8');
  const verdict = gate.checkAtFirst(projectDir, added, mapText, gate.readReceipts(projectDir));
  if (verdict.storiesChecked.length > 0 && !verdict.pass) {
    const lines = [
      ...verdict.missingAt.map((s) => `  NO ACCEPTANCE TEST FILE     ${s}`),
      ...verdict.missingReceipt.map((m) => `  NO RED RECEIPT              ${m.story} (${m.atPath})`),
    ];
    failBlock({
      id: 'at-first-gate',
      title: 'at-first-proof (G23) — writing-acceptance-tests-first was not proven for staged new file(s)',
      detail: `${lines.join('\n')}\n`,
      fix:
        'run writing-acceptance-tests-first for the story (write the AT under specs/test_artefacts/acceptance/), ' +
        'then node .claude/scripts/record-at-red.js --story <id> --at-file <path> --test-cmd "<cmd>" to confirm it fails ' +
        'and record the receipt.',
      waive: 'real exception in specs/reviews/sensor-waivers.json (sensor_id: at-first-proof)',
      envOff: 'HARNESS_AT_FIRST_GATE',
      minTier: 'standard',
    });
  }
}

module.exports = {
  checkLegacyDisciplineGate,
  checkSproutDiffGate,
  checkAtFirstGate,
};
