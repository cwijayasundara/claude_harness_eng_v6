#!/usr/bin/env node

'use strict';

// Deterministic --plan-only spine. One process writes the matrix, traces, and
// a skeleton test-plan.md from story-traces.json. The model fills seams, empty
// Given/When/Then cells, Observe on proposed evaluator checks, and the untested
// table — it does not invent VM rows, Cucumber, AT source, or Playwright files.

const fs = require('fs');
const path = require('path');
const { layerFor, enrichPlan, persistRow, mergeReviewed } = require('./test-plan-enrich');
const { extractObligations, obligationIndex } = require('./constraints-extract');

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

function pad(n) {
  return `VM-${String(n).padStart(3, '0')}`;
}

function escapeCell(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function table(headers, bodyRows) {
  const head = `| ${headers.join(' | ')} |`;
  const rule = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = asArray(bodyRows).map((r) => `| ${r.map(escapeCell).join(' | ')} |`).join('\n');
  return `${head}\n${rule}\n${body}`;
}

function parseGwt(raw) {
  const text = String(raw || '').trim();
  const m = text.match(/^given\s+(.+?)(?:,\s*|\s+)when\s+(.+?)(?:,\s*|\s+)then\s+(.+)$/i);
  if (m) return { given: m[1].trim(), when: m[2].trim(), then: m[3].trim() };
  return { given: '', when: '', then: text };
}

function gwtFromAc(row) {
  if (!row || typeof row !== 'object') return parseGwt('');
  if (row.given || row.when) {
    return {
      given: String(row.given || ''),
      when: String(row.when || ''),
      then: String(row.then || ''),
    };
  }
  return parseGwt(row.text || row.then || '');
}

function evaluatorKind(layers) {
  const list = asArray(layers);
  if (list.includes('e2e')) return 'playwright';
  if (list.includes('api')) return 'api';
  return null;
}

function scenarioTable(requirements, acceptance) {
  const byId = new Map(asArray(acceptance).map((r) => [r.id, r]));
  const rows = asArray(requirements).map((r) => {
    const g = gwtFromAc(byId.get(r.ac_id));
    return [r.ac_id, r.id, g.given || '(fill)', g.when || '(fill)', g.then || '(fill)'];
  });
  return table(
    ['AC', 'Matrix', 'Given', 'When', 'Then'],
    rows.length ? rows : [['(none)', '', '', '', '']],
  );
}

function checkTable(requirements) {
  const rows = [];
  for (const r of asArray(requirements)) {
    const kind = evaluatorKind(r.required_layers);
    if (!kind) continue;
    rows.push([r.group || 'A', `QA-${r.id}`, kind, r.id, '(fill)']);
  }
  return table(
    ['Group', 'Check id', 'Kind', 'Matrix ids', 'Observe'],
    rows.length ? rows : [['', '', '', '', '(none — unit/seam only)']],
  );
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

function behaviorSpecSections(plan) {
  return [
    '## Behavior scenarios (Given / When / Then)',
    '',
    'Human-reviewed behavior spec. Implement-time ATs match this wording. Do not write `.feature` or AT source here.',
    '',
    scenarioTable(plan.requirements, plan.acceptance),
    '',
    '## Proposed sprint-contract checks',
    '',
    'Evaluator QA procedure (`api` / `playwright`). Fill Observe (method/path or UI steps). Do not write `sprint-contracts/*.json` or Playwright files in this phase.',
    '',
    checkTable(plan.requirements),
    '',
    '## What Is Explicitly Untested (and why)',
    '',
    table(['Area', 'Reason'], [['(fill)', '']]),
    '',
    '## Test Levels',
    '',
    '- **unit** / **api** / **e2e** as tagged on each matrix row. Unit rows stay on the seam; they are not evaluator checks.',
    '',
  ].join('\n');
}

function skeletonPlan(plan) {
  const traces = asArray(plan.traces);
  const n = asArray(plan.requirements).length;
  const seamRows = traces.map((s) => [s.id, '', '', String((s.acs || []).length)]);
  return [
    '# Test Plan',
    '',
    `Scope: ${traces.length} stories, ${n} acceptance criteria.`,
    'Machine spine: `verification-matrix.json` (one row per AC). Behavior scenarios are that list in Given/When/Then — not extra cases, not Cucumber, not AT source.',
    '',
    '## Named Seams (Ports-and-Adapters)',
    '',
    table(['Story', 'Seam (port)', 'Real adapter', 'Test-double adapter'], seamRows),
    '',
    behaviorSpecSections(plan),
  ].join('\n');
}

function schemaSources(root) {
  const files = [
    path.join(root, 'specs', 'design', 'data-models.schema.json'),
    path.join(root, 'specs', 'design', 'api-contracts.schema.json'),
  ];
  const sources = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    try {
      sources.push({ label: path.relative(root, file), schema: JSON.parse(fs.readFileSync(file, 'utf8')) });
    } catch (_) { /* skip invalid schema */ }
  }
  return sources;
}

function loadObligations(root) {
  const sources = schemaSources(root);
  if (!sources.length) return { obligations: [], index: [], generated_from: [] };
  const extracted = extractObligations(sources);
  return { ...extracted, index: obligationIndex(extracted) };
}

function assemblePlan(root) {
  const traces = readJson(path.join(root, 'specs', 'stories', 'story-traces.json'), null);
  if (!asArray(traces).length) {
    return { ok: false, error: 'specs/stories/story-traces.json missing or empty — run /spec first' };
  }
  const stories = readJson(path.join(root, 'specs', 'stories', 'stories.json'), []);
  const acceptance = readJson(path.join(root, 'specs', 'stories', 'acceptance-criteria.json'), []);
  const { requirements, testTraces } = buildPlan({ traces, stories, acceptance });
  const extracted = loadObligations(root);
  const designTraces = readJson(path.join(root, 'specs', 'design', 'design-traces.json'), []);
  const attached = enrichPlan({
    requirements, testTraces, stories, acceptance,
    designTraces, obligations: extracted.obligations,
  });
  return { ok: true, traces, stories, acceptance, requirements, testTraces, extracted, attached };
}

function writeArtifacts(root, plan, resetPlan) {
  const dir = path.join(root, 'specs', 'test_artefacts');
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, 'verification-matrix.json'), {
    version: 1, requirements: plan.requirements.map(persistRow),
  });
  writeJson(path.join(dir, 'test-traces.json'), plan.testTraces);
  if (plan.extracted.obligations.length) {
    writeJson(path.join(dir, 'constraint-obligations.json'), {
      generated_from: plan.extracted.generated_from, obligations: plan.extracted.obligations,
    });
    writeJson(path.join(dir, 'obligation-index.json'), plan.extracted.index);
  }
  const planPath = path.join(dir, 'test-plan.md');
  if (!fs.existsSync(planPath) || resetPlan) {
    fs.writeFileSync(planPath, `${skeletonPlan(plan)}\n`);
  }
}

function writePlan(root, { force, resetPlan } = {}) {
  const plan = assemblePlan(root);
  if (!plan.ok) return plan;
  const summary = {
    ok: true, rows: plan.requirements.length, stories: asArray(plan.traces).length,
    obligations: plan.attached.attached, unmatched: plan.attached.unmatched.length,
    dropped: 0,
  };
  const matrixPath = path.join(root, 'specs', 'test_artefacts', 'verification-matrix.json');
  const existing = readJson(matrixPath, null);
  if (existing && !force) {
    return {
      ...summary, skipped: true,
      message: 'verification-matrix.json exists — not overwritten (pass --force to rebuild)',
    };
  }
  if (existing) {
    const merged = mergeReviewed(
      asArray(existing.requirements), plan.requirements, plan.testTraces,
    );
    summary.dropped = merged.dropped.length;
  }
  writeArtifacts(root, plan, resetPlan);
  return { ...summary, skipped: false };
}

function run(argv, cwd) {
  const root = path.resolve(arg(argv, '--root', cwd) || cwd);
  const result = writePlan(root, {
    force: argv.includes('--force'),
    resetPlan: argv.includes('--reset-plan'),
  });
  if (!result.ok) {
    process.stderr.write(`test-plan-write: ${result.error}\n`);
    return 1;
  }
  const obl = result.obligations ? `; ${result.obligations} obligations attached` : '';
  const unmatched = result.unmatched ? ` (${result.unmatched} unmatched)` : '';
  const dropped = result.dropped ? `; ${result.dropped} reviewed row(s) dropped (AC gone)` : '';
  process.stdout.write(
    `test-plan-write: ${result.skipped ? 'kept' : 'wrote'} ${result.rows} matrix rows`
    + ` over ${result.stories} stories${obl}${unmatched}${dropped}`
    + `${result.message ? ` — ${result.message}` : ''}\n`,
  );
  return 0;
}

module.exports = { writePlan, buildPlan, layerFor, parseGwt, gwtFromAc, evaluatorKind, run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
