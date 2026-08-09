#!/usr/bin/env node

'use strict';

// Print the upstream digest a planning phase needs, instead of its full inputs.
//
// Usage:
//   node .claude/scripts/phase-digest.js --phase <spec|design|test> [--root DIR] [--json]
//
// Exit: 0 = digest printed, 1 = upstream artifacts missing, 2 = usage error.
//
// The digest is for the SHAPING session. Full artifact text belongs to the
// renderer fork — see .claude/hooks/lib/phase-digest.js for why.

const { digestFor, PHASES } = require('../hooks/lib/phase-digest.js');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 || argv[i + 1] === undefined ? fallback : argv[i + 1];
}

function line(label, value) {
  return `  ${String(label).padEnd(18)}${value}`;
}

function specLines(d) {
  const out = [];
  const r = d.requirements;
  out.push(line('REQUIREMENTS', r ? `${r.n}   ${r.first} … ${r.last}` : '(none found)'));
  if (d.taxonomy.length) out.push(line('  by taxonomy', d.taxonomy.map(([k, n]) => `${k} ${n}`).join(' · ')));
  const a = d.acceptance;
  out.push(line('ACCEPTANCE', `${a.criteria} criteria gating ${a.gated} requirement(s)`));
  if (a.uncovered) {
    out.push(line('', `⚠ ${a.uncovered} requirement(s) have NO observable criterion.`));
    out.push(line('', '  Authoring them is this phase\'s work-list; no gate will catch a miss.'));
  }
  if (d.confidence) out.push(line('CONFIDENCE', d.confidence));
  return out;
}

function itemLines(label, items, note) {
  if (!items.length) return [];
  const out = [line(label, `${items.length}${note ? `   ${note}` : ''}`)];
  for (const it of items) out.push(`      ${it.id}  ${it.text || it.done_when || ''}`);
  return out;
}

function renderSpec(d) {
  return [
    ...specLines(d),
    ...itemLines('MILESTONES', d.milestones, "← the PRD's own build order; do not re-derive"),
    ...itemLines('FORBIDDEN', d.forbidden, '← deny-list; nothing scoped may violate these'),
    ...itemLines('OPEN QUESTIONS', d.open_questions, '← each needs a decision or an explicit defer'),
    ...itemLines('HIGH RISKS', d.risks, ''),
    d.clarifications ? line('CLARIFICATIONS', `${d.clarifications.n}   ${d.clarifications.first} … ${d.clarifications.last}`) : '',
  ].filter(Boolean);
}

function renderDesign(d) {
  const s = d.stories;
  const out = [
    line('STORIES', `${s.total}   across ${s.by_epic.length} epic(s)`),
    line('  by layer', s.by_layer.map(([k, n]) => `${k} ${n}`).join(' · ') || '(unlabelled)'),
    line('CLUSTERS', `${d.clusters.count}   ${d.dependency_edges} dependency edge(s)`),
    line('FEATURES', d.features),
  ];
  if (d.needs_breakdown.length) {
    out.push(line('⚠ NEEDS BREAKDOWN', d.needs_breakdown.join(', ')));
    out.push(line('', 'Resolve before designing against them.'));
  }
  if (d.clusters.unresolved_contracts) {
    out.push(line('⚠ CONTRACTS', `${d.clusters.unresolved_contracts} unresolved interface contract(s)`));
  }
  for (const w of d.clusters.warnings) out.push(`      warn: ${w}`);
  return out;
}

function renderTest(d) {
  return [
    line('ACCEPTANCE', `${d.acceptance_criteria} criteria over ${d.stories} story/stories`),
    line('SCHEMAS', d.schemas.length ? d.schemas.join(', ') : '(none in specs/design/)'),
  ];
}

const RENDERERS = { spec: renderSpec, design: renderDesign, test: renderTest };

function render(phase, d) {
  return [
    `phase-digest: inputs for /${phase}   (source: ${d.source})`,
    '',
    ...RENDERERS[phase](d),
    '',
    `  Full text lives in ${d.full_text_for_the_renderer.join(', ')}.`,
    '  Read it only if a decision genuinely turns on the wording — the renderer',
    '  fork reads it in full, and pulling it in here is what makes the phase',
    '  expensive on every later turn.',
    '',
  ].join('\n');
}

function run(argv, cwd) {
  const phase = arg(argv, '--phase', null);
  if (!PHASES.includes(phase)) {
    process.stderr.write(`phase-digest: --phase must be one of ${PHASES.join(' | ')}\n`);
    return 2;
  }
  const root = arg(argv, '--root', cwd);
  const digest = digestFor(phase, root);
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(digest, null, 2)}\n`);
    return 0;
  }
  const text = render(phase, digest);
  process.stdout.write(text);
  const empty = phase === 'spec' ? !digest.requirements : !text.length;
  if (empty) {
    process.stderr.write(`phase-digest: no upstream artifacts under ${digest.source} — run the previous phase first.\n`);
    return 1;
  }
  return 0;
}

module.exports = { run, render };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
