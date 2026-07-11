#!/usr/bin/env node

'use strict';

// Minimal MCP stdio server for context-first navigation tools.
// Same JSON contracts as nav-query.js. Opt-in via .mcp.json:
//   { "mcpServers": { "harness-nav": { "command": "node", "args": [".claude/scripts/nav-mcp-server.js"] } } }
//
// Protocol: JSON-RPC 2.0 over newline-delimited stdin/stdout (MCP subset).

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildContextPack } = require('./context-pack');
const { cosineQuery, loadNavIndex, buildNavIndex } = require('./nav-index');
const { cochangeNeighbors } = require('./nav-cochange');
const { computeImpactScope } = require('../hooks/lib/impact-scope');

function projectRoot() {
  return process.env.HARNESS_PROJECT_DIR || process.cwd();
}

function codeWikiQuery(extraArgs) {
  const root = projectRoot();
  const script = path.join(root, '.claude', 'skills', 'code-map', 'scripts', 'code_wiki.js');
  const alt = path.join(__dirname, '..', 'skills', 'code-map', 'scripts', 'code_wiki.js');
  const bin = fs.existsSync(script) ? script : alt;
  const graph = path.join(root, 'specs', 'brownfield', 'code-graph.json');
  const r = spawnSync('node', [bin, 'query', '--graph', graph, ...extraArgs], {
    encoding: 'utf8',
    timeout: 15000,
  });
  if (r.status !== 0) return { error: (r.stderr || r.stdout || 'code_wiki failed').trim() };
  try {
    return JSON.parse(r.stdout);
  } catch (_) {
    return { raw: r.stdout };
  }
}

const TOOLS = [
  {
    name: 'nav_pack',
    description: 'Bounded context pack: citations, task_map, confidence from DeepWiki/code-graph',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        budget: { type: 'number' },
        diff: { type: 'boolean' },
      },
      required: ['question'],
    },
  },
  {
    name: 'nav_symbol',
    description: 'Find symbol definitions in the code graph',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'nav_callers',
    description: 'Who calls / depends on a graph node id',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'nav_impact',
    description: 'Test impact analysis for changed files',
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' } },
      },
      required: ['files'],
    },
  },
  {
    name: 'nav_cochange',
    description: 'Files that frequently commit together with the given path',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'nav_semantic',
    description: 'TF-IDF semantic search over symbol/wiki index',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
    },
  },
];

function callTool(name, args = {}) {
  const root = projectRoot();
  switch (name) {
    case 'nav_pack':
      return buildContextPack({
        projectDir: root,
        question: args.question || '',
        budgetTokens: args.budget || 1600,
        useDiff: args.diff !== false,
        writeReceipt: true,
      });
    case 'nav_symbol':
      return codeWikiQuery(['--symbol', args.name || '']);
    case 'nav_callers':
      return codeWikiQuery(['--callers', args.id || '']);
    case 'nav_impact':
      return computeImpactScope({
        root,
        changedFiles: args.files || [],
        graphPath: path.join('specs', 'brownfield', 'code-graph.json'),
        matrixPath: path.join('specs', 'test_artefacts', 'verification-matrix.json'),
        componentMapPath: path.join('specs', 'design', 'component-map.md'),
        e2eDir: 'e2e',
        contractsDir: 'sprint-contracts',
      });
    case 'nav_cochange':
      return { path: args.path, neighbors: cochangeNeighbors(root, args.path || '') };
    case 'nav_semantic': {
      let index = loadNavIndex(root);
      if (!index) {
        buildNavIndex({ projectDir: root });
        index = loadNavIndex(root);
      }
      return { results: cosineQuery(index, args.question || '') };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

function respond(id, result) {
  const msg = { jsonrpc: '2.0', id, result };
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function respondError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return;
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return respond(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'harness-nav', version: '1.0.0' },
    });
  }
  if (method === 'notifications/initialized' || method === 'initialized') {
    return;
  }
  if (method === 'tools/list') {
    return respond(id, { tools: TOOLS });
  }
  if (method === 'tools/call') {
    try {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      const result = callTool(name, args);
      return respond(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      });
    } catch (err) {
      return respondError(id, -32000, err.message || String(err));
    }
  }
  if (method === 'ping') {
    return respond(id, {});
  }
  if (id !== undefined) respondError(id, -32601, `Method not found: ${method}`);
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      handle(JSON.parse(line));
    } catch (err) {
      process.stderr.write(`nav-mcp: parse error ${err.message}\n`);
    }
  });
}

if (require.main === module) main();

module.exports = { callTool, TOOLS, handle };
