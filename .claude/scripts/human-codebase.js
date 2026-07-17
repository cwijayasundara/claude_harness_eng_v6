#!/usr/bin/env node

'use strict';

// Human-facing homepage: docs/CODEBASE.md
// Deterministic, always regenerable from code-graph + CONTEXT + concept index.
// Designed so engineers who will not navigate src/ can still orient.
//
//   node human-codebase.js [--root <dir>] [--out docs/CODEBASE.md]

const fs = require('fs');
const path = require('path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return null;
  }
}

function firstParagraph(md, max = 600) {
  if (!md) return null;
  const cleaned = md
    .replace(/^#.+$/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .trim();
  const parts = cleaned.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!parts.length) return null;
  return parts[0].slice(0, max);
}

function loadContextBlurb(root) {
  for (const rel of ['CONTEXT.md', 'specs/brd/BRD.md', 'README.md']) {
    const text = readText(path.join(root, rel));
    const para = firstParagraph(text);
    if (para && para.length > 40) return { source: rel, text: para };
  }
  return { source: null, text: 'No CONTEXT.md / BRD blurb found yet.' };
}

function hubsFromGraph(graph) {
  const hubs = (graph.metrics && (graph.metrics.hubs || graph.metrics.unstable_hubs)) || [];
  // Sort with a stable path tiebreak BEFORE slicing, so equal-key hubs (same
  // fan_in/fan_out) render in a canonical order regardless of the graph's array
  // order — otherwise CODEBASE.md's hub table reshuffles on every re-index. Same
  // ordering convention as code_wiki/model.js's hub sort.
  return hubs
    .map((h) => {
      const id = h.id || h.path || '';
      const p = id.includes(':') ? id.split(':').slice(1).join(':') : id;
      return { path: p, fan_in: h.fan_in || h.fanIn || 0, fan_out: h.fan_out || h.fanOut || 0 };
    })
    .sort((a, b) => b.fan_in - a.fan_in || b.fan_out - a.fan_out || a.path.localeCompare(b.path))
    .slice(0, 12);
}

function entrypoints(graph) {
  const files = graph.files || [];
  const hits = [];
  for (const f of files) {
    const p = f.path || '';
    if (/(?:^|\/)(routes?|api|handlers?|middleware)(?:\/|$)/i.test(p)
      || /main\.(py|ts|js|go)$/i.test(p)
      || /app\.(py|ts|js)$/i.test(p)) {
      hits.push(p);
    }
    for (const s of f.symbols || []) {
      if (s.kind === 'route' || (s.name && /^(@app\.|router\.|app\.(get|post))/i.test(s.name))) {
        hits.push(`${p}${s.line != null ? `:${s.line}` : ''}`);
      }
    }
  }
  return [...new Set(hits)].slice(0, 20);
}

function conceptLinks(root) {
  const idx = readText(path.join(root, 'specs', 'brownfield', 'wiki', 'concepts', 'INDEX.md'));
  if (!idx) return [];
  const links = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(idx)) !== null) {
    links.push({ title: m[1], href: `specs/brownfield/wiki/concepts/${path.basename(m[2])}` });
  }
  return links.slice(0, 30);
}

function wikiPages(root) {
  const dir = path.join(root, 'specs', 'brownfield', 'wiki', 'pages');
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .slice(0, 30)
      .map((f) => ({ title: f.replace(/\.md$/, ''), href: `specs/brownfield/wiki/pages/${f}` }));
  } catch (_) {
    return [];
  }
}

function debugHints(root) {
  const hints = [];
  const obs = readJson(path.join(root, 'project-manifest.json'));
  if (obs && obs.observability) {
    hints.push(`Metrics path: \`${obs.observability.metrics_path || '/metrics'}\``);
    if (obs.observability.slo) {
      hints.push(
        `SLO: error_rate_pct≤${obs.observability.slo.error_rate_pct ?? '?'} · p95_ms≤${obs.observability.slo.p95_ms ?? '?'}`,
      );
    }
  }
  hints.push('Prefer structured logs with `request_id` / `X-Request-ID` correlation.');
  hints.push('Quality receipt after changes: `specs/reviews/quality-card.md`.');
  hints.push('Ask navigation: `npm run ask -- "where is auth validated?"`.');
  return hints;
}

function buildHomepage({ root = process.cwd() } = {}) {
  const graph = readJson(path.join(root, 'specs', 'brownfield', 'code-graph.json')) || {
    files: [],
    edges: [],
    metrics: {},
  };
  const blurb = loadContextBlurb(root);
  const hubs = hubsFromGraph(graph);
  const entries = entrypoints(graph);
  const concepts = conceptLinks(root);
  const pages = wikiPages(root);
  const fileCount = (graph.files || []).length || (graph.metrics && graph.metrics.files) || 0;
  const edgeCount = (graph.edges || []).length || (graph.metrics && graph.metrics.edges) || 0;

  const md = [
    '# Codebase map (human homepage)',
    '',
    '> Living orientation document. Deterministically rendered from the code-graph + CONTEXT.',
    '> Prefer this page + concept wiki over opening the whole tree.',
    '',
    '## What this system is',
    '',
    blurb.text,
    blurb.source ? `` : '',
    blurb.source ? `_Source: \`${blurb.source}\`_` : '',
    '',
    '## At a glance',
    '',
    `| Metric | Value |`,
    `|---|---|`,
    `| Indexed files | ${fileCount} |`,
    `| Graph edges | ${edgeCount} |`,
    `| Concept pages | ${concepts.length} |`,
    `| Wiki cluster pages | ${pages.length} |`,
    '',
    '## How to run / test / gate',
    '',
    '```bash',
    '# project-specific — see README / init.sh',
    './init.sh                 # or docker compose up',
    'npm test                 # or pytest / vitest',
    '/gate                    # pre-merge quality gate',
    'npm run quality-card     # trust receipt',
    'npm run ask -- "..."     # ask the codebase',
    '```',
    '',
    '## Architecture (hub modules)',
    '',
    hubs.length
      ? ['| Module | fan-in | fan-out |', '|---|---|---|',
        ...hubs.map((h) => `| \`${h.path}\` | ${h.fan_in} | ${h.fan_out} |`)].join('\n')
      : '_No hubs yet — run `/code-map` or wait for graph-refresh._',
    '',
    '## Entry points',
    '',
    entries.length
      ? entries.map((e) => `- \`${e}\``).join('\n')
      : '_No route/main entrypoints detected in the graph._',
    '',
    '## Concept pages (clusters)',
    '',
    concepts.length
      ? concepts.map((c) => `- [${c.title}](${c.href})`).join('\n')
      : '_Run `node .claude/scripts/nav-concepts.js` or `nav-query.js refresh`._',
    '',
    '## DeepWiki cluster pages',
    '',
    pages.length
      ? pages.map((p) => `- [${p.title}](${p.href})`).join('\n')
      : '_Run `/code-map` to render `specs/brownfield/wiki/`._',
    '',
    '## Critical paths & debugging',
    '',
    ...debugHints(root).map((h) => `- ${h}`),
    '',
    '## If X breaks, start here',
    '',
    '| Symptom | Start |',
    '|---|---|',
    '| Auth / session failures | concept or entry modules matching `auth` / `session` |',
    '| Slow API | quality-card perf + `/metrics` + N+1 smells (`npm run perf-smell`) |',
    '| Silent failures | structured logs + `request_id`; observability gate |',
    '| Merge confidence | `specs/reviews/quality-card.md` + `walkthrough.md` |',
    '| "Where is X?" | `npm run ask -- "X"` |',
    '',
    '## Machine-readable companions',
    '',
    '- `specs/brownfield/code-graph.json` — dependency DAG (agents + tools)',
    '- `specs/brownfield/symbol-map.md` — symbols with line ranges',
    '- `specs/brownfield/wiki/WIKI.md` — deterministic DeepWiki index',
    '- `.harness/wiki.json` — steer wiki priorities (Devin `.devin/wiki.json` analogue)',
    '',
  ].join('\n');

  return {
    md,
    meta: {
      generated_at: new Date().toISOString(),
      files: fileCount,
      edges: edgeCount,
      concepts: concepts.length,
      pages: pages.length,
    },
  };
}

function writeHomepage(root, outRel, { md, meta }) {
  const out = path.join(root, outRel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md.endsWith('\n') ? md : `${md}\n`);
  fs.mkdirSync(path.join(root, '.claude', 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude', 'state', 'human-codebase.json'),
    `${JSON.stringify({ ...meta, out: outRel }, null, 2)}\n`,
  );
}

function arg(argv, name, fb) {
  const i = argv.indexOf(name);
  return i === -1 ? fb : argv[i + 1];
}

function main(argv = process.argv.slice(2)) {
  const root = arg(argv, '--root', process.cwd());
  const out = arg(argv, '--out', 'docs/CODEBASE.md');
  const built = buildHomepage({ root });
  writeHomepage(root, out, built);
  process.stdout.write(`human-codebase: ${out} (${built.meta.files} files, ${built.meta.concepts} concepts)\n`);
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    process.stderr.write(`human-codebase: ${e.message}\n`);
    process.exit(2);
  }
}

module.exports = { buildHomepage, writeHomepage, main, hubsFromGraph, entrypoints };
