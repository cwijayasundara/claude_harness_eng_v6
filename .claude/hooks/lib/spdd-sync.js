'use strict';

// Code → structured record rewrite (SPDD /spdd-sync).
// Applies Canvas Governs/Operations stubs, story-bundle ownership, then
// re-joins specs/bundles/. Does not invent ACs — AC drift stays a hard fail.

const fs = require('fs');
const path = require('path');
const { checkCanvasSync, applyCanvasProposal } = require('./canvas-sync');
const { planProjectSync, applyStorySync } = require('./story-sync');
const { parseStoryOwnership } = require('./story-bundle');

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
  let mapText = '';
  try { mapText = fs.readFileSync(path.join(root, 'specs', 'design', 'component-map.md'), 'utf8'); } catch (_) { /* none */ }
  const ownership = parseStoryOwnership(mapText);
  return walkStoryRels(root).map((rel) => {
    const id = path.basename(rel, '.md');
    const bundlePath = path.join(root, 'specs', 'bundles', `${id}.json`);
    return {
      id,
      rel,
      markdown: fs.readFileSync(path.join(root, rel), 'utf8'),
      bundle: fs.existsSync(bundlePath) ? JSON.parse(fs.readFileSync(bundlePath, 'utf8')) : null,
      bundlePath,
      mapFiles: ownership.get(id) || [],
    };
  }).filter((s) => s.bundle);
}

function syncCanvas(root, changedFiles, write) {
  const canvasPath = path.join(root, 'specs', 'design', 'reasons-canvas.md');
  if (!fs.existsSync(canvasPath)) {
    return { skipped: true, issues: 0, written: false };
  }
  const canvasText = fs.readFileSync(canvasPath, 'utf8');
  const result = checkCanvasSync({ canvasText, changedFiles });
  const issues = result.missingFromGoverns.length + result.missingFromOperations.length;
  if (!issues || !write) return { skipped: false, issues, written: false, result };
  fs.writeFileSync(canvasPath, applyCanvasProposal(canvasText, result));
  const after = checkCanvasSync({ canvasText: fs.readFileSync(canvasPath, 'utf8'), changedFiles });
  return {
    skipped: false,
    issues: after.missingFromGoverns.length + after.missingFromOperations.length,
    written: true,
    result: after,
  };
}

function syncBundles(root, changedFiles, write, now) {
  const stories = loadStories(root);
  if (!stories.length) return { skipped: true, pass: true, errors: [], written: 0 };
  const verdict = planProjectSync({ stories, changedFiles });
  let written = 0;
  if (write && verdict.pass) {
    for (const story of stories) {
      const plan = verdict.plans.find((p) => p.story_id === story.id);
      if (!plan || !plan.added_files.length) continue;
      const next = applyStorySync(story.bundle, plan, now);
      fs.mkdirSync(path.dirname(story.bundlePath), { recursive: true });
      fs.writeFileSync(story.bundlePath, `${JSON.stringify(next, null, 2)}\n`);
      written += 1;
    }
  }
  return { skipped: false, pass: verdict.pass, errors: verdict.errors, written, added: verdict.added };
}

function runSpddSync({ root, write = false, changedFiles = [], now = new Date().toISOString() } = {}) {
  const canvas = syncCanvas(root, changedFiles, write);
  const bundles = syncBundles(root, changedFiles, write, now);
  const pass = (canvas.skipped || canvas.issues === 0) && bundles.pass;
  return { pass, canvas, bundles, written: Boolean((canvas.written) || (bundles.written > 0)) };
}

module.exports = { runSpddSync, syncCanvas, syncBundles };
