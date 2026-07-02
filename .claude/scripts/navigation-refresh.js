#!/usr/bin/env node

'use strict';

// Living navigation for greenfield and brownfield repos. This owns the cheap
// DeepWiki/code-map lifecycle: placeholder when no source exists, full bootstrap
// when source appears, and status/token estimates for /status and telemetry.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SOURCE_EXTS = new Set([
  '.py', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.go', '.rs',
  '.java', '.cs', '.php', '.rb', '.swift', '.kt', '.dart',
]);
const SKIP_DIRS = new Set([
  '.git', '.claude', 'node_modules', '.venv', 'venv', 'dist', 'build',
  'target', 'vendor', 'coverage', 'specs', 'e2e',
]);

function estimateTextTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

function ensureDirs(projectDir) {
  for (const rel of [
    'specs/brownfield/wiki/pages',
    'specs/brownfield/skeletons',
    '.claude/state',
  ]) fs.mkdirSync(path.join(projectDir, rel), { recursive: true });
}

function walkSourceFiles(projectDir) {
  const files = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(projectDir, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (SOURCE_EXTS.has(path.extname(entry.name).toLowerCase())) {
        files.push(rel);
      }
    }
  }
  walk(projectDir);
  return files.sort();
}

function sumTokens(projectDir, rels) {
  let total = 0;
  for (const rel of rels) {
    try {
      total += estimateTextTokens(fs.readFileSync(path.join(projectDir, rel), 'utf8'));
    } catch (_) {}
  }
  return total;
}

function writePlaceholder(projectDir, sourceCount = 0) {
  ensureDirs(projectDir);
  const generatedAt = new Date().toISOString();
  const graph = {
    nodes: [],
    edges: [],
    files: [],
    metrics: { files: 0, edges: 0, cycles: [], hubs: [] },
    meta: {
      producer: 'none',
      status: 'empty',
      reason: sourceCount ? 'source index unavailable' : 'no source files',
      generated_at: generatedAt,
    },
  };
  fs.writeFileSync(path.join(projectDir, 'specs/brownfield/code-graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
  fs.writeFileSync(path.join(projectDir, 'specs/brownfield/code-graph.meta.json'), `${JSON.stringify(graph.meta, null, 2)}\n`);
  fs.writeFileSync(path.join(projectDir, 'specs/brownfield/symbol-map.md'),
    '# Symbol Map\n\nNo source symbols have been indexed yet.\n');
  fs.writeFileSync(path.join(projectDir, 'specs/brownfield/wiki/WIKI.md'), [
    '# Codebase Wiki',
    '',
    'No source code has been created yet.',
    '',
    'This wiki will update automatically as source files are created and edited.',
    '',
  ].join('\n'));
  return writeStatus(projectDir, {
    status: 'placeholder',
    mode: 'placeholder',
    graph: 'placeholder',
    wiki: 'placeholder',
    source_files: sourceCount,
    indexed_files: 0,
    dirty_files: 0,
    estimated_source_tokens: 0,
    estimated_navigation_tokens: estimateTextTokens('No source code has been created yet.'),
  });
}

function runIndexer(projectDir) {
  const indexer = path.join(projectDir, '.claude/skills/code-map/scripts/code_index/code_index.py');
  const graph = path.join(projectDir, 'specs/brownfield/code-graph.json');
  if (!fs.existsSync(indexer)) return { ok: false, error: 'missing code_index.py' };
  const res = spawnSync('python3', [
    indexer, '--root', projectDir, '--out', graph,
    '--skeleton-dir', path.join(projectDir, 'specs/brownfield/skeletons'),
  ], { encoding: 'utf8', timeout: 30000 });
  if (res.status !== 0) return { ok: false, error: (res.stderr || res.stdout || '').trim() };
  spawnSync('python3', [
    indexer, '--render-map', graph,
    '--out', path.join(projectDir, 'specs/brownfield/symbol-map.md'),
  ], { encoding: 'utf8', timeout: 30000 });
  const wiki = spawnSync('node', [
    path.join(projectDir, '.claude/skills/code-map/scripts/code_wiki.js'),
    'render', '--graph', graph, '--out', path.join(projectDir, 'specs/brownfield/wiki'),
  ], { encoding: 'utf8', timeout: 30000 });
  if (wiki.status !== 0) return { ok: false, error: (wiki.stderr || wiki.stdout || '').trim() };
  return { ok: true };
}

function countIndexedFiles(projectDir) {
  try {
    const graph = JSON.parse(fs.readFileSync(path.join(projectDir, 'specs/brownfield/code-graph.json'), 'utf8'));
    return Array.isArray(graph.files) ? graph.files.length : 0;
  } catch (_) {
    return 0;
  }
}

function navTokens(projectDir) {
  const rels = [
    'specs/brownfield/symbol-map.md',
    'specs/brownfield/wiki/WIKI.md',
  ];
  let total = sumTokens(projectDir, rels);
  const pages = path.join(projectDir, 'specs/brownfield/wiki/pages');
  try {
    for (const f of fs.readdirSync(pages)) {
      if (f.endsWith('.md')) total += sumTokens(projectDir, [`specs/brownfield/wiki/pages/${f}`]);
    }
  } catch (_) {}
  return total;
}

function writeStatus(projectDir, status) {
  const full = {
    ...status,
    last_refresh: new Date().toISOString(),
  };
  fs.mkdirSync(path.join(projectDir, '.claude/state'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.claude/state/navigation-status.json'), `${JSON.stringify(full, null, 2)}\n`);
  return full;
}

function refreshNavigation({ projectDir = process.cwd(), mode = 'scaffold' } = {}) {
  ensureDirs(projectDir);
  const sources = walkSourceFiles(projectDir);
  if (sources.length === 0) return writePlaceholder(projectDir, 0);

  const indexed = runIndexer(projectDir);
  if (!indexed.ok) {
    const status = writePlaceholder(projectDir, sources.length);
    status.status = 'failed';
    status.error = indexed.error;
    fs.writeFileSync(path.join(projectDir, '.claude/state/navigation-status.json'), `${JSON.stringify(status, null, 2)}\n`);
    return status;
  }
  const sourceTokens = sumTokens(projectDir, sources);
  const navigationTokens = navTokens(projectDir);
  return writeStatus(projectDir, {
    status: 'fresh',
    mode: mode === 'scaffold' ? 'bootstrap' : mode,
    graph: 'fresh',
    wiki: 'fresh',
    source_files: sources.length,
    indexed_files: countIndexedFiles(projectDir),
    dirty_files: 0,
    estimated_source_tokens: sourceTokens,
    estimated_navigation_tokens: navigationTokens,
    estimated_context_query_tokens: Math.min(navigationTokens, 800),
    estimated_tokens_saved_per_orientation: Math.max(0, sourceTokens - Math.min(navigationTokens, 800)),
  });
}

module.exports = { refreshNavigation, estimateTextTokens, walkSourceFiles };

if (require.main === module) {
  const args = process.argv.slice(2);
  const projectDir = args.includes('--root') ? args[args.indexOf('--root') + 1] : process.cwd();
  const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'manual';
  const status = refreshNavigation({ projectDir, mode });
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
}
