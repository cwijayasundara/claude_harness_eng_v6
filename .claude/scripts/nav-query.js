#!/usr/bin/env node

'use strict';

// Single facade for context-first navigation:
//   node nav-query.js pack --budget 1600 "question"
//   node nav-query.js symbol <name>
//   node nav-query.js callers <id>
//   node nav-query.js calls <id>
//   node nav-query.js module <id>
//   node nav-query.js hubs | cycles
//   node nav-query.js impact --files a.js,b.js
//   node nav-query.js cochange <path>
//   node nav-query.js semantic "question"
//   node nav-query.js refresh   # index + cochange + concepts

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildContextPack } = require('./context-pack');
const { computeImpactScope } = require('../hooks/lib/impact-scope');
const { cosineQuery, loadNavIndex, buildNavIndex } = require('./nav-index');
const { cochangeNeighbors, buildCochange } = require('./nav-cochange');
const { buildConceptPages } = require('./nav-concepts');
const { buildGraphIndex, lookupSymbol } = require('./nav-graph-index');
const { buildMaps } = require('./nav-brownfield-maps');
const { runBench } = require('./nav-bench');

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out.flags[key] = next;
        i += 1;
      } else {
        out.flags[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function graphPath(root) {
  return path.join(root, 'specs', 'brownfield', 'code-graph.json');
}

function runCodeWiki(root, extraArgs) {
  const script = path.join(root, '.claude', 'skills', 'code-map', 'scripts', 'code_wiki.js');
  // Fallback: relative to this package when skills live beside scripts
  const alt = path.join(__dirname, '..', 'skills', 'code-map', 'scripts', 'code_wiki.js');
  const bin = fs.existsSync(script) ? script : alt;
  const r = spawnSync('node', [bin, 'query', '--graph', graphPath(root), ...extraArgs], {
    encoding: 'utf8',
    timeout: 15000,
  });
  if (r.status !== 0) {
    return { error: (r.stderr || r.stdout || 'code_wiki failed').trim(), exit: r.status };
  }
  try {
    return JSON.parse(r.stdout);
  } catch (_) {
    return { raw: r.stdout };
  }
}

function cmdPack(root, args, flags) {
  const question = args.join(' ') || String(flags.question || '');
  return buildContextPack({
    projectDir: root,
    question,
    budgetTokens: parseInt(flags.budget || '1600', 10) || 1600,
    depth: parseInt(flags.depth || '2', 10) || 2,
    useDiff: Boolean(flags.diff) || flags.diff === true || flags.diff === 'true' || args.length >= 0,
    writeReceipt: !flags['no-receipt'],
  });
}

function cmdImpact(root, flags) {
  const files = String(flags.files || flags.file || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return computeImpactScope({
    root,
    changedFiles: files,
    graphPath: path.relative(root, graphPath(root)),
    matrixPath: path.join('specs', 'test_artefacts', 'verification-matrix.json'),
    componentMapPath: path.join('specs', 'design', 'component-map.md'),
    e2eDir: 'e2e',
    contractsDir: 'sprint-contracts',
  });
}

function cmdSemantic(root, args) {
  let index = loadNavIndex(root);
  if (!index) {
    buildNavIndex({ projectDir: root });
    index = loadNavIndex(root);
  }
  return {
    query: args.join(' '),
    results: cosineQuery(index, args.join(' '), { topK: 20 }),
    index_chunks: index ? index.chunk_count : 0,
  };
}

function cmdRefresh(root) {
  return {
    index: buildNavIndex({ projectDir: root }),
    graph_index: buildGraphIndex({ projectDir: root }),
    cochange: buildCochange({ projectDir: root }),
    concepts: buildConceptPages({ projectDir: root }),
    lean_maps: buildMaps({ projectDir: root }),
  };
}

function run(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const root = parsed.flags.root || process.cwd();
  const cmd = parsed._[0] || 'help';
  const rest = parsed._.slice(1);
  const flags = parsed.flags;

  let result;
  switch (cmd) {
    case 'pack':
      // default --diff on for pack facade
      if (flags.diff === undefined) flags.diff = true;
      result = buildContextPack({
        projectDir: root,
        question: rest.join(' ') || String(flags.question || ''),
        budgetTokens: parseInt(flags.budget || '1600', 10) || 1600,
        depth: parseInt(flags.depth || '2', 10) || 2,
        useDiff: flags.diff === true || flags.diff === 'true' || flags.diff === undefined,
        writeReceipt: !flags['no-receipt'],
      });
      break;
    case 'symbol':
      result = runCodeWiki(root, ['--symbol', rest[0] || '']);
      break;
    case 'callers':
      result = runCodeWiki(root, ['--callers', rest[0] || '']);
      break;
    case 'calls':
      result = runCodeWiki(root, ['--calls', rest[0] || '']);
      break;
    case 'module':
      result = runCodeWiki(root, ['--module', rest[0] || '']);
      break;
    case 'hubs':
      result = runCodeWiki(root, ['--hubs']);
      break;
    case 'cycles':
      result = runCodeWiki(root, ['--cycles']);
      break;
    case 'impact':
      result = cmdImpact(root, flags);
      break;
    case 'cochange':
      result = {
        path: rest[0],
        neighbors: cochangeNeighbors(root, rest[0] || '', { limit: parseInt(flags.limit || '12', 10) || 12 }),
      };
      break;
    case 'semantic':
      result = cmdSemantic(root, rest);
      break;
    case 'refresh':
      result = cmdRefresh(root);
      break;
    case 'lookup':
      result = { name: rest[0], hits: lookupSymbol(root, rest[0] || '') };
      break;
    case 'lean-maps':
      result = buildMaps({ projectDir: root, goal: rest.join(' ') || flags.goal || null });
      break;
    case 'bench':
      result = runBench({
        projectDir: root,
        goldenPath: flags.golden || null,
        budgetTokens: parseInt(flags.budget || '1600', 10) || 1600,
      });
      break;
    case 'clarify': {
      const pack = buildContextPack({
        projectDir: root,
        question: rest.join(' '),
        budgetTokens: parseInt(flags.budget || '1600', 10) || 1600,
        useDiff: true,
        writeReceipt: true,
      });
      result = {
        question: pack.question,
        status: pack.status,
        confidence: pack.confidence,
        clusters: pack.task_map && pack.task_map.clusters,
        clarify_options: pack.task_map && pack.task_map.clarify_options,
        should_ask: pack.confidence === 'low' && (pack.task_map.clarify_options || []).length >= 2,
      };
      break;
    }
    case 'help':
    default:
      result = {
        usage: [
          'nav-query.js pack [--diff] [--budget N] "question"',
          'nav-query.js symbol <name> | lookup <name>',
          'nav-query.js callers|calls|module <id>',
          'nav-query.js hubs|cycles',
          'nav-query.js impact --files a,b',
          'nav-query.js cochange <path>',
          'nav-query.js semantic "question"',
          'nav-query.js clarify "ambiguous question"',
          'nav-query.js lean-maps [--goal "..."]',
          'nav-query.js bench [--golden path]',
          'nav-query.js refresh',
        ],
      };
      break;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

module.exports = { run, cmdPack, cmdImpact, cmdSemantic, cmdRefresh };

if (require.main === module) {
  process.exit(run());
}
