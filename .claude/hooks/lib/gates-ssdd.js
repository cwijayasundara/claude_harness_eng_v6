'use strict';

// SSDD join sensors at commit time. PLANNING pack: they only bite when a
// story graph exists. An agent that skips /auto SECTION 5 still hits these
// through GATE_CATALOG / the git hook.

const fs = require('fs');
const path = require('path');
const { validateGenerationContract } = require('./generation-contract');
const { checkProject, listStoryFiles } = require('./story-bundle');
const { checkCanvasSync } = require('./canvas-sync');
const { failBlock, noteSkip } = require('./pre-commit-util');
const { isTestFile } = require('./tdd');

function walkStoryRels(root) {
  const storiesRoot = path.join(root, 'specs', 'stories');
  const found = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/^E\d+-S\d+\.md$/.test(name)) {
        found.push(path.relative(root, full).replace(/\\/g, '/'));
      }
    }
  }
  walk(storiesRoot);
  return found;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function loadStories(root) {
  return listStoryFiles(walkStoryRels(root)).map((f) => {
    const markdown = fs.readFileSync(path.join(root, f.path), 'utf8');
    const readiness = /Readiness:\s*needs_breakdown/i.test(markdown) ? 'needs_breakdown' : 'ready';
    return {
      id: f.id,
      path: f.path,
      markdown,
      readiness,
      bundle: readJson(path.join(root, 'specs', 'bundles', `${f.id}.json`), null),
    };
  });
}

function productionSource(ctx) {
  return (ctx.stagedSource || []).filter((f) => {
    if (isTestFile(f)) return false;
    if (f.startsWith('specs/') || f.startsWith('.claude/')) return false;
    return true;
  });
}

function checkGenerationContract(ctx) {
  const { projectDir } = ctx;
  if (!productionSource(ctx).length) return;
  const stories = loadStories(projectDir).filter((s) => s.readiness !== 'needs_breakdown');
  if (!stories.length) {
    noteSkip('generation-contract', 'no ready stories');
    return;
  }
  const errors = [];
  for (const story of stories) {
    const v = validateGenerationContract(story.markdown, { mode: 'implementable' });
    for (const err of v.errors) errors.push(`${story.id}: ${err}`);
  }
  if (!errors.length) return;
  failBlock({
    id: 'generation-contract',
    title: `Generation Contract is not implementable — ${errors.length} issue(s)`,
    detail: `${errors.slice(0, 12).map((e) => `  - ${e}`).join('\n')}\n`,
    fix: 'fill Operations with repo-relative file paths, then node .claude/scripts/bundle-write.js (or node .claude/scripts/spdd-sync.js --write).',
    minTier: 'minimal',
  });
}

function checkStoryBundle(ctx) {
  const { projectDir } = ctx;
  if (!productionSource(ctx).length) return;
  const stories = loadStories(projectDir);
  const verdict = checkProject({
    stories,
    matrixPresent: fs.existsSync(path.join(projectDir, 'specs', 'test_artefacts', 'verification-matrix.json')),
    mapPresent: fs.existsSync(path.join(projectDir, 'specs', 'design', 'component-map.md')),
    brdAcceptance: readJson(path.join(projectDir, 'specs', 'brd', 'brd-acceptance.json'), []),
    testTraces: readJson(path.join(projectDir, 'specs', 'test_artefacts', 'test-traces.json'), []),
    safeguards: readJson(path.join(projectDir, 'specs', 'brd', 'brd-safeguards.json'), []),
  }, { mode: 'implementable' });
  if (verdict.dormant) {
    noteSkip('story-bundle-check', 'no ready stories');
    return;
  }
  if (verdict.pass) return;
  failBlock({
    id: 'story-bundle-check',
    title: `story bundle is not implementable — ${verdict.errors.length} issue(s)`,
    detail: `${verdict.errors.slice(0, 12).map((e) => `  - ${e}`).join('\n')}\n`,
    fix: 'node .claude/scripts/bundle-write.js then node .claude/scripts/bundle-check.js --mode implementable.',
    minTier: 'minimal',
  });
}

function checkCanvasSyncGate(ctx) {
  const { projectDir } = ctx;
  const canvasPath = path.join(projectDir, 'specs', 'design', 'reasons-canvas.md');
  if (!fs.existsSync(canvasPath)) {
    noteSkip('canvas-sync-check', 'no reasons-canvas.md');
    return;
  }
  const files = productionSource(ctx);
  if (!files.length) return;
  const result = checkCanvasSync({
    canvasText: fs.readFileSync(canvasPath, 'utf8'),
    changedFiles: files,
  });
  const issues = result.missingFromGoverns.length + result.missingFromOperations.length;
  if (!issues) return;
  failBlock({
    id: 'canvas-sync-check',
    title: `REASONS Canvas is missing ${issues} changed path(s)`,
    detail: [
      ...result.missingFromGoverns.map((f) => `  - Governs: ${f}`),
      ...result.missingFromOperations.map((f) => `  - Operations: ${f}`),
    ].join('\n') + '\n',
    fix: 'node .claude/scripts/spdd-sync.js --write (applies Governs + Operations stubs and re-joins bundles).',
    minTier: 'minimal',
  });
}

module.exports = {
  checkGenerationContract,
  checkStoryBundle,
  checkCanvasSyncGate,
  productionSource,
  loadStories,
};
