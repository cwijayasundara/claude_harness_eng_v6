#!/usr/bin/env node

'use strict';

// Deterministic lean brownfield maps from code-graph.json — no LLM.
// Used by default /brownfield so change agents get factual stubs without
// six essay generations. LLM narrative remains --full only.

const fs = require('fs');
const path = require('path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function stripId(id) {
  const s = String(id || '');
  const i = s.indexOf(':');
  return i === -1 ? s : s.slice(i + 1);
}

function isTestPath(p) {
  return /(^|\/)(tests?|__tests__|spec|e2e)(\/|$)/i.test(p) || /\.(test|spec)\./i.test(p);
}

function riskKeywords(p) {
  const s = p.toLowerCase();
  const hits = [];
  if (/auth|session|jwt|oauth|permission|rbac/.test(s)) hits.push('auth');
  if (/billing|payment|stripe|invoice/.test(s)) hits.push('billing');
  if (/migrat|schema|model|orm|sql/.test(s)) hits.push('persistence');
  if (/secret|crypto|password|token/.test(s)) hits.push('security');
  if (/upload|download|s3|blob/.test(s)) hits.push('files');
  return hits;
}

function layerGuess(p) {
  const s = p.toLowerCase();
  if (isTestPath(p)) return 'test';
  if (/\/(api|routes?|controllers?|handlers?)\//.test(s) || /route/.test(s)) return 'api';
  if (/\/(services?|domain|usecases?|application)\//.test(s)) return 'service';
  if (/\/(repo|repository|dal|db|models?)\//.test(s)) return 'data';
  if (/\/(ui|components?|pages?|views?|frontend)\//.test(s)) return 'ui';
  if (/\/(hooks|scripts|skills)\//.test(s) || p.startsWith('.claude/')) return 'tooling';
  return 'other';
}

function buildMaps({ projectDir = process.cwd(), goal = null } = {}) {
  const graphPath = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  const graph = readJson(graphPath);
  if (!graph || ((graph.files || []).length === 0 && (graph.nodes || []).length === 0)) {
    return { ok: false, reason: 'missing_or_empty_graph' };
  }

  const files = (graph.files || []).map((f) => f.path).filter(Boolean);
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const hubs = (graph.metrics && (graph.metrics.hubs || graph.metrics.unstable_hubs)) || [];
  const cycles = (graph.metrics && graph.metrics.cycles) || [];
  const unstable = (graph.metrics && graph.metrics.unstable_hubs) || hubs.filter((h) => {
    const fi = h.fan_in || h.fanIn || 0;
    const fo = h.fan_out || h.fanOut || 0;
    const inst = h.instability != null ? h.instability : (fi + fo ? fo / (fi + fo) : 0);
    return fi >= 5 && inst >= 0.8;
  });

  const byLayer = {};
  for (const p of files) {
    const L = layerGuess(p);
    if (!byLayer[L]) byLayer[L] = [];
    byLayer[L].push(p);
  }

  const languages = {};
  for (const n of nodes) {
    const lang = n.language || (n.id && n.id.split(':')[0]) || 'unknown';
    languages[lang] = (languages[lang] || 0) + 1;
  }

  const outDir = path.join(projectDir, 'specs', 'brownfield');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString();
  const goalNote = goal ? `\n> Goal-scoped lean maps for: **${goal}**\n` : '\n';

  // codebase-map.md
  const codebase = [
    '# Codebase Map',
    '',
    `> Deterministic inventory from \`code-graph.json\` (${stamp}). No LLM.`,
    goalNote,
    '## Languages / modules',
    '',
    ...Object.entries(languages).map(([k, v]) => `- ${k}: ${v} node(s)`),
    '',
    `## Scale`,
    '',
    `- Files indexed: ${files.length}`,
    `- Graph nodes: ${nodes.length}`,
    `- Edges: ${edges.length}`,
    `- Cycles: ${cycles.length}`,
    '',
    '## Layers (heuristic path buckets)',
    '',
    ...Object.entries(byLayer).map(([k, arr]) => `- **${k}**: ${arr.length} file(s) — e.g. ${arr.slice(0, 3).map((p) => `\`${p}\``).join(', ')}`),
    '',
    '## Navigation',
    '',
    '- Wiki: `specs/brownfield/wiki/WIKI.md`',
    '- Symbol map: `specs/brownfield/symbol-map.md`',
    '- Context pack: `node .claude/scripts/nav-query.js pack --budget 1600 "<goal>"`',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'codebase-map.md'), codebase);

  // architecture-map.md
  const arch = [
    '# Architecture Map',
    '',
    `> Deterministic architecture stub from the code graph (${stamp}). Cite edges before redesigning.`,
    goalNote,
    '## Major hubs (fan-in)',
    '',
    ...(hubs.slice(0, 15).map((h) => {
      const id = h.id || h.path;
      return `- \`${stripId(id)}\` — fan_in=${h.fan_in || h.fanIn || 0}, fan_out=${h.fan_out || h.fanOut || 0}`;
    }) || ['_none_']),
    '',
    '## Layer buckets',
    '',
    ...Object.entries(byLayer).filter(([k]) => k !== 'test' && k !== 'other').map(([k, arr]) => {
      return `### ${k}\n\n${arr.slice(0, 12).map((p) => `- \`${p}\``).join('\n') || '_none_'}\n`;
    }),
    '',
    '## Data flow (sample import/call edges)',
    '',
    ...edges.filter((e) => ['imports', 'calls'].includes(e.kind || e.type)).slice(0, 20).map((e) => {
      return `- \`${stripId(e.source || e.from)}\` → \`${stripId(e.target || e.to)}\` (${e.kind || e.type})`;
    }),
    '',
    '## Full graph',
    '',
    'See `dependency-graph.md` and `code-graph.json`.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'architecture-map.md'), arch);

  // test-map.md
  const testFiles = files.filter(isTestPath);
  const test = [
    '# Test Map',
    '',
    `> Deterministic test inventory from indexed paths (${stamp}).`,
    goalNote,
    `## Test files in graph: ${testFiles.length}`,
    '',
    ...testFiles.slice(0, 40).map((p) => `- \`${p}\``),
    testFiles.length > 40 ? `\n_+ ${testFiles.length - 40} more_\n` : '',
    '',
    '## Commands',
    '',
    'Discover actual commands from package manifests / CI; prefer `project-manifest` and `ci-map.md` when present.',
    '',
    '## Coverage note',
    '',
    'Run coverage tools separately. For edit preflight use `checking-coverage-before-change`.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'test-map.md'), test);

  // risk-map.md
  const domainRisks = [];
  for (const p of files) {
    const ks = riskKeywords(p);
    if (ks.length) domainRisks.push({ path: p, kinds: ks });
  }
  const risk = [
    '# Risk Map',
    '',
    `> Deterministic risk stubs from path keywords + coupling metrics (${stamp}).`,
    goalNote,
    '## Domain-sensitive paths (keyword heuristic)',
    '',
    ...(domainRisks.slice(0, 40).map((r) => `- \`${r.path}\` — ${r.kinds.join(', ')}`) || ['_none detected_']),
    '',
    '## Structural risks',
    '',
    `### Cycles (${cycles.length})`,
    '',
    ...(cycles.slice(0, 10).map((c) => `- ${(Array.isArray(c) ? c : [c]).map(stripId).join(' → ')}`) || ['_none_']),
    '',
    `### Unstable / high-fan-in hubs`,
    '',
    ...(unstable.slice(0, 15).map((h) => `- \`${stripId(h.id || h.path)}\` fan_in=${h.fan_in || h.fanIn || 0}`) || ['_none_']),
    '',
    '## Notes',
    '',
    'Keyword hits are candidates — confirm against source before treating as security scope.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'risk-map.md'), risk);

  // change-strategy.md
  const nFiles = files.length;
  const strategy = [
    '# Change Strategy',
    '',
    `> Deterministic lane guidance (${stamp}).`,
    goalNote,
    '## Recommended lanes',
    '',
    '| Lane | When |',
    '|------|------|',
    '| `/vibe` | ≤3 files, <150 lines, no auth/API/persistence |',
    '| `/change` | Single behavior change or bugfix with AC |',
    '| `/refactor` | Structure-only; tests must stay green |',
    '| `/feature` | Brownfield feature from request → PR with DeepWiki |',
    '| `/spec` → `/design` → `/auto` | Multi-story / epic |',
    '',
    '## Repo scale hint',
    '',
    nFiles < 50
      ? `- Small repo (~${nFiles} files): prefer \`/vibe\` or \`/change\`.`
      : nFiles < 500
        ? `- Medium repo (~${nFiles} files): use context-pack before edits; \`/change\` default.`
        : `- Large repo (~${nFiles} files): always \`nav-query pack\` first; epic work needs \`/feature\` or \`/auto\`.`,
    '',
    '## First safe steps',
    '',
    '1. `node .claude/scripts/nav-query.js pack --diff --budget 1600 "<goal>"`',
    '2. Read only `read_next` ranges; clarify if `confidence` is low.',
    '3. Coverage preflight on target symbols.',
    '4. Impact-scoped regression: `node .claude/scripts/local-regression-gate.js`',
    '',
    goal
      ? `## Goal\n\n${goal}\n\nRun \`/brownfield --seams "${goal.replace(/"/g, '')}"\` if cut-point ranking is needed.\n`
      : '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'change-strategy.md'), strategy);

  return {
    ok: true,
    written: [
      'codebase-map.md',
      'architecture-map.md',
      'test-map.md',
      'risk-map.md',
      'change-strategy.md',
    ],
    stats: { files: nFiles, hubs: hubs.length, cycles: cycles.length, domain_risks: domainRisks.length },
  };
}

module.exports = { buildMaps, layerGuess, riskKeywords };

if (require.main === module) {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const projectDir = rootIdx === -1 ? process.cwd() : args[rootIdx + 1];
  const goalIdx = args.indexOf('--goal');
  const goal = goalIdx === -1 ? null : args[goalIdx + 1];
  const result = buildMaps({ projectDir, goal });
  if (!result.ok) {
    process.stderr.write(`nav-brownfield-maps: ${result.reason}\n`);
    process.exit(0);
  }
  process.stdout.write(`nav-brownfield-maps: wrote ${result.written.join(', ')} (${JSON.stringify(result.stats)})\n`);
}
