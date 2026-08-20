#!/usr/bin/env node

'use strict';

// Markdown rendering for the --plan-only skeleton: the tables and section
// scaffolding the model then fills in. Kept apart from test-plan-write.js so
// that file owns one job — deriving the machine spine (matrix rows and traces)
// from the story graph — and prose formatting cannot grow into it.

function asArray(v) { return Array.isArray(v) ? v : []; }

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

module.exports = {
  skeletonPlan, behaviorSpecSections, scenarioTable, checkTable,
  table, escapeCell, parseGwt, gwtFromAc, evaluatorKind,
};
