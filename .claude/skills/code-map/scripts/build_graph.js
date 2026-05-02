#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { DEFAULT_EXCLUDES, buildGraph } = require('./graph');
const { renderMermaid, renderCouplingReport } = require('./render');

function parseArgs(argv) {
  const args = {
    root: '.',
    out: 'specs/brownfield/code-graph.json',
    exclude: [],
    renderMermaid: null,
    couplingReport: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--root') args.root = next();
    else if (a === '--out') args.out = next();
    else if (a === '--exclude') args.exclude.push(next());
    else if (a === '--render-mermaid') args.renderMermaid = next();
    else if (a === '--coupling-report') args.couplingReport = next();
    else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
  }
  return args;
}

function printUsage() {
  process.stderr.write(
    'Usage: build_graph.js [--root .] [--out path] [--exclude name]...\n' +
    '       build_graph.js --render-mermaid graph.json --out file.md\n' +
    '       build_graph.js --coupling-report graph.json --out file.md\n'
  );
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.renderMermaid) {
    const graph = JSON.parse(fs.readFileSync(args.renderMermaid, 'utf8'));
    ensureDir(args.out);
    fs.writeFileSync(args.out, renderMermaid(graph));
    process.stderr.write(`Wrote ${args.out}\n`);
    return 0;
  }

  if (args.couplingReport) {
    const graph = JSON.parse(fs.readFileSync(args.couplingReport, 'utf8'));
    ensureDir(args.out);
    fs.writeFileSync(args.out, renderCouplingReport(graph));
    process.stderr.write(`Wrote ${args.out}\n`);
    return 0;
  }

  const excludes = new Set([...DEFAULT_EXCLUDES, ...args.exclude]);
  const graph = buildGraph(args.root, excludes);

  ensureDir(args.out);
  fs.writeFileSync(args.out, JSON.stringify(graph, null, 2));

  const meta = path.join(
    path.dirname(args.out),
    path.basename(args.out, path.extname(args.out)) + '.meta.json'
  );
  fs.writeFileSync(meta, JSON.stringify(graph.meta, null, 2));

  const cycles = graph.metrics.cycles.length;
  process.stderr.write(
    `Wrote ${args.out} (${graph.nodes.length} nodes, ${graph.metrics.edges} internal edges, ${cycles} cycles)\n`
  );
  if (graph.meta.warnings.length) {
    process.stderr.write(`  ${graph.meta.warnings.length} warning(s) — see meta.json\n`);
  }
  return 0;
}

process.exit(main());
