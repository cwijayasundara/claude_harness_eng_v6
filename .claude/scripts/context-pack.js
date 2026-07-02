#!/usr/bin/env node

'use strict';

// Deterministic bounded context packs over the living DeepWiki/code-map. This is
// the retrieval layer for Token Usage Optimizer: return citations and exact read
// ranges first, not broad source bodies.

const fs = require('fs');
const path = require('path');

function estimateTextTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function words(text) {
  return [...String(text || '').toLowerCase().matchAll(/[a-z0-9_]+/g)].map((m) => m[0]);
}

function stripPrefix(id) {
  const s = String(id || '');
  const colon = s.indexOf(':');
  const slash = s.indexOf('/');
  return colon !== -1 && (slash === -1 || colon < slash) ? s.slice(colon + 1) : s;
}

function nodePath(nodeOrId) {
  if (nodeOrId && typeof nodeOrId === 'object') return nodeOrId.path || stripPrefix(nodeOrId.id);
  return stripPrefix(nodeOrId);
}

function graphIndexes(graph) {
  const nodesById = new Map();
  const nodeByPath = new Map();
  for (const n of graph.nodes || []) {
    nodesById.set(n.id || n.path, n);
    nodeByPath.set(nodePath(n), n);
  }
  const symbols = [];
  for (const f of graph.files || []) {
    for (const s of f.symbols || []) {
      symbols.push({
        path: f.path,
        start: s.start || s.line || 1,
        end: s.end || s.start || s.line || 1,
        symbol: s.name || null,
        kind: s.kind || 'symbol',
        signature: s.signature || null,
      });
    }
  }
  return { nodesById, nodeByPath, symbols };
}

function scoreSymbol(questionWords, record) {
  const hay = words([record.path, record.symbol, record.kind, record.signature].filter(Boolean).join(' '));
  let score = 0;
  for (const q of questionWords) {
    for (const h of hay) {
      if (h === q) score += 4;
      else if (h.includes(q) || q.includes(h)) score += 1;
    }
  }
  return score;
}

function directNeighbors(graph, hitPath, indexes) {
  const hitNode = indexes.nodeByPath.get(hitPath);
  const hitId = hitNode && (hitNode.id || hitNode.path);
  if (!hitId) return [];
  const ids = new Set();
  for (const e of graph.edges || []) {
    const from = e.from != null ? e.from : e.source;
    const to = e.to != null ? e.to : e.target;
    if (from === hitId) ids.add(to);
    if (to === hitId) ids.add(from);
  }
  return [...ids].map((id) => nodePath(indexes.nodesById.get(id) || id));
}

function makeResult(record, reason, confidence = 'medium') {
  return {
    path: record.path,
    start: record.start,
    end: record.end,
    symbol: record.symbol,
    kind: record.kind,
    reason,
    confidence,
  };
}

function firstSymbolInPath(indexes, filePath) {
  return indexes.symbols.find((s) => s.path === filePath) || null;
}

function addUnique(results, result) {
  if (!result) return;
  const key = `${result.path}:${result.start}:${result.end}:${result.symbol || ''}`;
  if (results.some((r) => `${r.path}:${r.start}:${r.end}:${r.symbol || ''}` === key)) return;
  results.push(result);
}

function estimatePackTokens(results) {
  return estimateTextTokens(JSON.stringify(results));
}

function buildContextPack({ projectDir = process.cwd(), question = '', budgetTokens = 1200 } = {}) {
  const graphPath = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  const graph = readJson(graphPath);
  if (!graph) {
    return { question, status: 'missing', budget_tokens: budgetTokens, estimated_tokens: 0, results: [], read_next: [], warnings: ['missing code-graph.json; run /code-map or /brownfield first'] };
  }
  if ((graph.meta && graph.meta.status === 'empty') || ((graph.nodes || []).length === 0 && (graph.files || []).length === 0)) {
    return { question, status: 'placeholder', budget_tokens: budgetTokens, estimated_tokens: 0, results: [], read_next: [], warnings: ['placeholder navigation: no source has been indexed yet'] };
  }

  const indexes = graphIndexes(graph);
  const qWords = words(question);
  const scored = indexes.symbols
    .map((s) => ({ ...s, score: scoreSymbol(qWords, s) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || (a.symbol || '').localeCompare(b.symbol || ''));

  const results = [];
  for (const hit of scored) {
    addUnique(results, makeResult(hit, hit.score >= 4 ? 'symbol/signature match' : 'lexical match', hit.score >= 4 ? 'high' : 'medium'));
    for (const neighborPath of directNeighbors(graph, hit.path, indexes)) {
      const neighbor = firstSymbolInPath(indexes, neighborPath);
      if (neighbor) addUnique(results, makeResult(neighbor, `direct graph neighbor of ${hit.path}`, 'medium'));
    }
    if (estimatePackTokens(results) >= budgetTokens) break;
  }

  const trimmed = [];
  for (const result of results) {
    trimmed.push(result);
    if (estimatePackTokens(trimmed) >= budgetTokens) {
      trimmed.pop();
      break;
    }
  }
  const finalResults = trimmed.length ? trimmed : results.slice(0, 1);
  return {
    question,
    status: finalResults.length ? 'ok' : 'no_match',
    budget_tokens: budgetTokens,
    estimated_tokens: estimatePackTokens(finalResults),
    results: finalResults,
    read_next: finalResults.map((r) => `Read ${r.path} lines ${r.start}-${r.end}`),
    warnings: finalResults.length ? [] : ['no matching symbols or modules found in code graph'],
  };
}

module.exports = { buildContextPack, estimateTextTokens };

if (require.main === module) {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const budgetIdx = args.indexOf('--budget');
  const projectDir = rootIdx === -1 ? process.cwd() : args[rootIdx + 1];
  const budgetTokens = budgetIdx === -1 ? 1200 : parseInt(args[budgetIdx + 1], 10) || 1200;
  const question = args.filter((a, i) => i !== rootIdx && i !== rootIdx + 1 && i !== budgetIdx && i !== budgetIdx + 1).join(' ');
  process.stdout.write(`${JSON.stringify(buildContextPack({ projectDir, question, budgetTokens }), null, 2)}\n`);
}
