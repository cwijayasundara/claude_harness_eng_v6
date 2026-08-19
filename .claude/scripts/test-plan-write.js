#!/usr/bin/env node

'use strict';

// Deterministic --plan-only spine. One process writes the matrix, traces, and
// a skeleton test-plan.md from story-traces.json. The model only fills seams
// and the untested table — it does not invent VM rows or a case catalog.

const fs = require('fs');
const path = require('path');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function asArray(v) { return Array.isArray(v) ? v : []; }

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 || argv[i + 1] === undefined ? fallback : argv[i + 1];
}

function layerFor(story) {
  const layer = String(story && story.layer || '').toLowerCase();
  if (layer === 'ui') return 'e2e';
  if (layer === 'config' || layer === 'types') return 'unit';
  return 'api';
}

function pad(n) {
  return `VM-${String(n).padStart(3, '0')}`;
}

function buildPlan({ traces, stories, acceptance }) {
  const storyById = new Map(asArray(stories).map((s) => [s.id, s]));
  const acText = new Map();
  for (const row of asArray(acceptance)) {
    if (row && row.id) acText.set(row.id, row.text || row.then || '');
  }

  const requirements = [];
  const testTraces = [];
  let n = 0;
  for (const story of asArray(traces)) {
    const meta = storyById.get(story.id) || {};
    const layer = layerFor(meta);
    const brdId = asArray(story.traces)[0] || null;
    for (const acId of asArray(story.acs)) {
      n += 1;
      const id = pad(n);
      const text = acText.get(acId) || acId;
      requirements.push({
        id,
        ac_id: acId,
        story_id: story.id,
        brd_id: brdId,
        group: meta.group || 'A',
        required_layers: [layer],
        implementation_paths: [],
        checks: [{
          id: `CHK-${id}-${layer}`,
          layer,
          description: `Verify ${acId}${text ? `: ${String(text).slice(0, 160)}` : ''}`,
        }],
      });
      const tracesOut = [acId];
      if (brdId) tracesOut.push(brdId);
      testTraces.push({ id, text: text || acId, traces: tracesOut, matrix_id: id });
    }
  }
  return { requirements, testTraces };
}

function skeletonPlan({ traces, stories, requirements }) {
  const storyById = new Map(asArray(stories).map((s) => [s.id, s]));
  const rows = asArray(traces).map((s) => {
    const title = (storyById.get(s.id) || {}).title || s.text || '';
    return `| ${s.id} | | | ${(s.acs || []).length} |`;
  }).join('\n');
  return [
    '# Test Plan',
    '',
    `Scope: ${asArray(traces).length} stories, ${requirements.length} acceptance criteria.`,
    'Machine spine: `verification-matrix.json` (one row per AC). Do not add a prose case catalog.',
    '',
    '## Named Seams (Ports-and-Adapters)',
    '',
    '| Story | Seam (port) | Real adapter | Test-double adapter |',
    '|---|---|---|---|',
    rows,
    '',
    '## What Is Explicitly Untested (and why)',
    '',
    '| Area | Reason |',
    '|---|---|',
    '| (fill) | |',
    '',
    '## Test Levels',
    '',
    '- **unit** / **api** / **e2e** as tagged on each matrix row.',
    '',
  ].join('\n');
}

function writePlan(root, { force } = {}) {
  const traces = readJson(path.join(root, 'specs', 'stories', 'story-traces.json'), null);
  if (!asArray(traces).length) {
    return { ok: false, error: 'specs/stories/story-traces.json missing or empty — run /spec first' };
  }
  const stories = readJson(path.join(root, 'specs', 'stories', 'stories.json'), []);
  const acceptance = readJson(path.join(root, 'specs', 'stories', 'acceptance-criteria.json'), []);
  const { requirements, testTraces } = buildPlan({ traces, stories, acceptance });

  const dir = path.join(root, 'specs', 'test_artefacts');
  fs.mkdirSync(dir, { recursive: true });
  const matrixPath = path.join(dir, 'verification-matrix.json');
  const tracesPath = path.join(dir, 'test-traces.json');
  const planPath = path.join(dir, 'test-plan.md');

  const existed = fs.existsSync(matrixPath);
  if (existed && !force) {
    return {
      ok: true, skipped: true, rows: requirements.length, stories: asArray(traces).length,
      message: 'verification-matrix.json exists — not overwritten (pass --force to rebuild)',
    };
  }

  writeJson(matrixPath, { version: 1, requirements });
  writeJson(tracesPath, testTraces);
  if (!fs.existsSync(planPath) || force) {
    fs.writeFileSync(planPath, `${skeletonPlan({ traces, stories, requirements })}\n`);
  }
  return { ok: true, skipped: false, rows: requirements.length, stories: asArray(traces).length };
}

function run(argv, cwd) {
  const root = path.resolve(arg(argv, '--root', cwd) || cwd);
  const result = writePlan(root, { force: argv.includes('--force') });
  if (!result.ok) {
    process.stderr.write(`test-plan-write: ${result.error}\n`);
    return 1;
  }
  process.stdout.write(
    `test-plan-write: ${result.skipped ? 'kept' : 'wrote'} ${result.rows} matrix rows`
    + ` over ${result.stories} stories`
    + `${result.message ? ` — ${result.message}` : ''}\n`,
  );
  return 0;
}

module.exports = { writePlan, buildPlan, layerFor, run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
