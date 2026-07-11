#!/usr/bin/env node
'use strict';

// code_wiki — a deterministic, always-current code-analysis wiki + query layer
// over code-graph.json (the DeepWiki-grade narrative layer, minus the LLM cost).
//
//   node code_wiki.js render --graph <code-graph.json> --out <dir> [--max-pages N]
//   node code_wiki.js query  --graph <code-graph.json> [--callers ID | --calls ID
//                              | --symbol NAME | --module ID | --hubs | --cycles]
//
// Pure stdlib: instant, no LLM, no network. Re-render on graph change to stay current.

const fs = require('fs');
const path = require('path');
const model = require('./code_wiki/model');
const render = require('./code_wiki/render');
const query = require('./code_wiki/query');

function parseArgs(argv) {
  const out = { _: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; } else { out[key] = true; }
  }
  return out;
}

function loadModel(graphPath) {
  try {
    return model.build(model.load(graphPath));
  } catch (err) {
    process.stderr.write(`code_wiki: cannot read graph '${graphPath}': ${err.message}\n`);
    process.exit(2);
  }
}

function maxPagesOf(args) {
  const n = Number(args['max-pages']);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

function cmdRender(args) {
  const m = loadModel(args.graph);
  const outDir = args.out || path.join(path.dirname(args.graph), 'wiki');
  const wiki = render.renderWiki(m, { maxPages: maxPagesOf(args), outDir });
  const pagesDir = path.join(outDir, 'pages');
  fs.rmSync(pagesDir, { recursive: true, force: true }); // drop stale pages so the wiki stays current
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, wiki.index.name), wiki.index.md);
  for (const p of wiki.pages) fs.writeFileSync(path.join(outDir, 'pages', p.name), p.md);
  process.stdout.write(`wiki: ${path.join(outDir, 'WIKI.md')} (${wiki.pages.length} page(s), ${m.nodes.length} modules, ${m.edges.length} edges)\n`);
}

function cmdQuery(args) {
  const m = loadModel(args.graph);
  process.stdout.write(JSON.stringify(query.run(m, args), null, 2) + '\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.graph) { process.stderr.write('usage: code_wiki.js <render|query> --graph <code-graph.json> ...\n'); process.exit(2); }
  if (args._ === 'render') return cmdRender(args);
  if (args._ === 'query') return cmdQuery(args);
  process.stderr.write(`unknown command: ${args._}\n`); process.exit(2);
}

if (require.main === module) main();
module.exports = { parseArgs, cmdRender, cmdQuery };
