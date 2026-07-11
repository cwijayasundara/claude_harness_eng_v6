#!/usr/bin/env node

'use strict';

// Deterministic bounded context packs over the living DeepWiki/code-map.
// Context-first navigation (v2): lexical + wiki BM25-ish scoring, multi-hop
// graph expansion, optional git-diff boost, task_map + confidence, session receipt.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const SCHEMA_VERSION = 2;
const RECEIPT_NAME = 'context-pack-last.json';
const DEFAULT_BUDGET = 1200;
const DEFAULT_DEPTH = 2;
const MAX_NEIGHBOR_FILES = 12;
const MAX_WIKI_BYTES = 64 * 1024;
const MAX_WIKI_PAGES = 40;
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'or',
  'and', 'that', 'this', 'it', 'its', 'where', 'what', 'how', 'when',
  'who', 'which', 'do', 'does', 'did', 'can', 'could', 'should', 'would',
  'handled', 'handle', 'using', 'use', 'used', 'via', 'into', 'about',
]);

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

function queryWords(text) {
  return words(text).filter((w) => w.length > 1 && !STOPWORDS.has(w));
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

function isTestPath(p) {
  const s = String(p || '').split(path.sep).join('/');
  return /(^|\/)(tests?|__tests__|spec|e2e)(\/|$)/i.test(s)
    || /\.(test|spec)\.[a-z0-9]+$/i.test(s)
    || /(^|\/)test_[^/]+$/i.test(s);
}

function pathCluster(p) {
  const parts = String(p || '').split('/').filter(Boolean);
  if (parts.length === 0) return '(root)';
  if (parts.length === 1) return parts[0];
  // Drop a leading tests/src noise when possible for clustering
  if (parts[0] === 'src' || parts[0] === 'lib' || parts[0] === 'app' || parts[0] === 'packages') {
    return parts.slice(0, Math.min(3, parts.length)).join('/');
  }
  return parts.slice(0, 2).join('/');
}

function termFreqMap(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

/** Lightweight BM25-ish score without full corpus IDF (idf ≈ log((N-n+0.5)/(n+0.5)+1) with n≈1). */
function bm25ish(queryTokens, docTokens, { k1 = 1.2, b = 0.75, avgdl = 40 } = {}) {
  if (!queryTokens.length || !docTokens.length) return 0;
  const tf = termFreqMap(docTokens);
  const dl = docTokens.length;
  let score = 0;
  for (const q of queryTokens) {
    const f = tf.get(q) || 0;
    if (!f) {
      // soft partial: token contained in a doc token
      let partial = 0;
      for (const [tok, c] of tf) {
        if (tok.includes(q) || q.includes(tok)) partial = Math.max(partial, c * 0.35);
      }
      if (partial) score += partial;
      continue;
    }
    const idf = Math.log(1.5); // flat mild idf — ranking relative within one pack call
    const denom = f + k1 * (1 - b + b * (dl / Math.max(avgdl, 1)));
    score += idf * ((f * (k1 + 1)) / denom);
  }
  return score;
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
  // Adjacency (undirected for neighbor expansion; keep edge kind for reasons)
  const adj = new Map(); // path -> Map(neighborPath -> kinds[])
  function addEdge(a, b, kind) {
    if (!a || !b || a === b) return;
    if (!adj.has(a)) adj.set(a, new Map());
    if (!adj.has(b)) adj.set(b, new Map());
    const ka = adj.get(a).get(b) || [];
    if (!ka.includes(kind)) ka.push(kind);
    adj.get(a).set(b, ka);
    const kb = adj.get(b).get(a) || [];
    if (!kb.includes(kind)) kb.push(kind);
    adj.get(b).set(a, kb);
  }
  for (const e of graph.edges || []) {
    const from = nodePath(e.from != null ? e.from : e.source);
    const to = nodePath(e.to != null ? e.to : e.target);
    addEdge(from, to, e.kind || e.type || 'related');
  }
  return { nodesById, nodeByPath, symbols, adj };
}

function loadWikiCorpus(projectDir) {
  const wikiDir = path.join(projectDir, 'specs', 'brownfield', 'wiki');
  const byPath = new Map(); // path hint -> text; '*' = global
  let total = 0;
  const push = (key, text) => {
    if (!text || total >= MAX_WIKI_BYTES) return;
    const slice = text.slice(0, Math.max(0, MAX_WIKI_BYTES - total));
    total += slice.length;
    byPath.set(key, (byPath.get(key) || '') + `\n${slice}`);
  };
  const wikiIndex = path.join(wikiDir, 'WIKI.md');
  if (fs.existsSync(wikiIndex)) {
    try { push('*', fs.readFileSync(wikiIndex, 'utf8')); } catch (_) { /* ignore */ }
  }
  const pagesDir = path.join(wikiDir, 'pages');
  if (fs.existsSync(pagesDir)) {
    let n = 0;
    for (const name of fs.readdirSync(pagesDir).sort()) {
      if (!name.endsWith('.md') || n >= MAX_WIKI_PAGES) break;
      try {
        const text = fs.readFileSync(path.join(pagesDir, name), 'utf8');
        push('*', text);
        // Heuristic: backtick paths and bare path-like tokens
        for (const m of text.matchAll(/`?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`?/g)) {
          const p = m[1];
          if (p.includes('/')) push(p, text);
        }
        n += 1;
      } catch (_) { /* ignore */ }
    }
  }
  return byPath;
}

function loadGlossaryWords(projectDir) {
  const ctx = path.join(projectDir, 'CONTEXT.md');
  if (!fs.existsSync(ctx)) return new Set();
  try {
    const text = fs.readFileSync(ctx, 'utf8');
    const terms = new Set();
    for (const m of text.matchAll(/^###?\s+([A-Za-z][A-Za-z0-9_ -]+)/gm)) {
      for (const w of queryWords(m[1])) terms.add(w);
    }
    return terms;
  } catch (_) {
    return new Set();
  }
}

function loadDirtyPaths(projectDir) {
  const dirty = new Set();
  const dirtyLog = path.join(projectDir, '.claude', 'state', 'graph-dirty.jsonl');
  if (fs.existsSync(dirtyLog)) {
    try {
      for (const line of fs.readFileSync(dirtyLog, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          const p = row.path || row.file || row.rel;
          if (p) dirty.add(String(p).split(path.sep).join('/'));
        } catch (_) { /* skip bad line */ }
      }
    } catch (_) { /* ignore */ }
  }
  try {
    const out = execSync('git status --porcelain -uall', {
      cwd: projectDir,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of out.split('\n')) {
      if (!line || line.length < 4) continue;
      // " M path" or "?? path" or "R  old -> new"
      let p = line.slice(3).trim();
      if (p.includes(' -> ')) p = p.split(' -> ').pop().trim();
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
      if (p) dirty.add(p.split(path.sep).join('/'));
    }
  } catch (_) {
    // not a git repo or git unavailable — ignore
  }
  return dirty;
}

function wikiTextForPath(wikiByPath, filePath) {
  const parts = [];
  if (wikiByPath.has('*')) parts.push(wikiByPath.get('*'));
  if (wikiByPath.has(filePath)) parts.push(wikiByPath.get(filePath));
  // also match basename mentions in global
  const base = path.basename(filePath);
  const global = wikiByPath.get('*') || '';
  if (base && global.includes(base)) {
    // already in global; keep single copy
  }
  return parts.join('\n');
}

function scoreSymbol(qWords, record, wikiByPath, glossaryWords, dirtySet, semanticBoost = 0) {
  const sources = [];
  let score = 0;
  const pathTokens = words(record.path);
  const sym = (record.symbol || '').toLowerCase();
  const sigTokens = words(record.signature || '');
  const hayTokens = [...pathTokens, ...words(record.symbol), ...words(record.kind), ...sigTokens];

  for (const q of qWords) {
    if (sym && sym === q) {
      score += 4.0;
      sources.push('exact_symbol');
    } else if (sym && (sym.includes(q) || q.includes(sym))) {
      score += 2.0;
      sources.push('symbol_partial');
    }
    if (pathTokens.includes(q)) {
      score += 1.5;
      sources.push('path');
    }
  }

  const lex = bm25ish(qWords, hayTokens);
  if (lex > 0) {
    score += 2.0 * lex;
    sources.push('lexical');
  }

  const wikiText = wikiTextForPath(wikiByPath, record.path);
  const wikiScore = bm25ish(qWords, words(wikiText));
  if (wikiScore > 0) {
    // Stronger weight so wiki-only domain language can surface
    score += 1.5 * wikiScore;
    sources.push('wiki');
  }

  let glossHits = 0;
  for (const q of qWords) {
    if (glossaryWords.has(q)) glossHits += 1;
  }
  if (glossHits) {
    score += 1.0 * glossHits;
    sources.push('glossary');
  }

  if (semanticBoost > 0) {
    score += semanticBoost;
    sources.push('semantic');
  }

  if (dirtySet && dirtySet.has(record.path)) {
    score += 1.2;
    sources.push('git_diff');
  }

  if (isTestPath(record.path) && score > 0) {
    score += 0.6;
    sources.push('test_proximity');
  }

  // Unique sources
  const uniq = [...new Set(sources)];
  return { score, sources: uniq };
}

function tryLoadNavHelpers() {
  try {
    return {
      loadNavIndex: require('./nav-index').loadNavIndex,
      scoreSymbolFromIndex: require('./nav-index').scoreSymbolFromIndex,
      cochangeNeighbors: require('./nav-cochange').cochangeNeighbors,
      appendNavEvent: require('./nav-telemetry').appendNavEvent,
      computeImpactScope: require('../hooks/lib/impact-scope').computeImpactScope,
    };
  } catch (_) {
    return null;
  }
}

function firstSymbolInPath(indexes, filePath) {
  return indexes.symbols.find((s) => s.path === filePath) || {
    path: filePath,
    start: 1,
    end: 1,
    symbol: null,
    kind: 'file',
    signature: null,
  };
}

function neighborsAtDepth(indexes, startPath, maxDepth, maxFiles) {
  const found = new Map(); // path -> { depth, kinds }
  const queue = [{ path: startPath, depth: 0 }];
  const seen = new Set([startPath]);
  while (queue.length && found.size < maxFiles) {
    const { path: cur, depth } = queue.shift();
    if (depth >= maxDepth) continue;
    const edges = indexes.adj.get(cur);
    if (!edges) continue;
    for (const [nbr, kinds] of edges) {
      if (seen.has(nbr)) continue;
      seen.add(nbr);
      found.set(nbr, { depth: depth + 1, kinds });
      queue.push({ path: nbr, depth: depth + 1 });
      if (found.size >= maxFiles) break;
    }
  }
  return found;
}

function makeResult(record, reason, confidence, score, sources) {
  return {
    path: record.path,
    start: record.start,
    end: record.end,
    symbol: record.symbol,
    kind: record.kind,
    reason,
    confidence,
    score: Math.round(score * 100) / 100,
    sources: sources || [],
  };
}

function addUnique(results, result) {
  if (!result) return;
  const key = `${result.path}:${result.start}:${result.end}:${result.symbol || ''}`;
  if (results.some((r) => `${r.path}:${r.start}:${r.end}:${r.symbol || ''}` === key)) return;
  results.push(result);
}

function estimatePackTokens(packLike) {
  return estimateTextTokens(JSON.stringify(packLike));
}

function confidenceOf(results, clusters) {
  const reasons = [];
  if (!results.length) return { confidence: 'low', reasons: ['no_results'] };

  const top = results[0];
  const hasExact = (top.sources || []).includes('exact_symbol') || /symbol/i.test(top.reason || '');
  const hasWiki = (top.sources || []).includes('wiki');
  const highScore = (top.score || 0) >= 4;

  if (hasExact) reasons.push('exact_symbol_match');
  if (hasWiki) reasons.push('wiki_heading_hit');
  if (clusters.length === 1) reasons.push('single_cluster');

  // Multi-cluster ambiguity
  if (clusters.length >= 2) {
    const a = clusters[0].score || 0;
    const b = clusters[1].score || 0;
    if (a > 0 && b / a >= 0.8) {
      reasons.push('multi_cluster');
      return { confidence: 'low', reasons };
    }
  }

  if (hasExact || (highScore && (hasWiki || clusters.length === 1))) {
    return { confidence: 'high', reasons: reasons.length ? reasons : ['strong_match'] };
  }
  if ((top.score || 0) >= 1.5) {
    return { confidence: 'medium', reasons: reasons.length ? reasons : ['lexical_or_wiki'] };
  }
  return { confidence: 'low', reasons: reasons.length ? reasons : ['weak_score'] };
}

function buildClusters(results) {
  const by = new Map();
  for (const r of results) {
    const id = pathCluster(r.path);
    if (!by.has(id)) by.set(id, { id, paths: new Set(), score: 0, symbols: [] });
    const c = by.get(id);
    c.paths.add(r.path);
    c.score += r.score || 0;
    if (r.symbol) c.symbols.push(r.symbol);
  }
  return [...by.values()]
    .map((c) => ({
      id: c.id,
      paths: [...c.paths],
      score: Math.round(c.score * 100) / 100,
      symbols: [...new Set(c.symbols)].slice(0, 8),
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function buildTaskMap(results, clusters, confidence, projectDir = null) {
  const edit_candidates = [];
  const must_not_break = [];
  const entrypoints = [];
  const tests_to_run = [];
  const seenEdit = new Set();
  const seenTest = new Set();

  for (const r of results) {
    const ref = {
      path: r.path,
      symbol: r.symbol,
      start: r.start,
      end: r.end,
      why: r.reason,
    };
    if (isTestPath(r.path)) {
      must_not_break.push({ ...ref, why: r.reason || 'related test' });
      if (!seenTest.has(r.path)) {
        seenTest.add(r.path);
        tests_to_run.push({ kind: 'symbol_test', path: r.path });
      }
    } else {
      if (!seenEdit.has(`${r.path}:${r.symbol || ''}`)) {
        seenEdit.add(`${r.path}:${r.symbol || ''}`);
        edit_candidates.push(ref);
      }
      if ((r.sources || []).includes('graph_neighbor') || /neighbor|caller|entrypoint/i.test(r.reason || '')) {
        entrypoints.push(ref);
      }
    }
  }

  if (results.length && !tests_to_run.some((t) => t.kind === 'impact_hint')) {
    tests_to_run.push({
      kind: 'impact_hint',
      command: 'node .claude/scripts/local-regression-gate.js',
    });
  }

  // Impact-scoped tests from verification matrix when available
  if (projectDir && edit_candidates.length) {
    try {
      const helpers = tryLoadNavHelpers();
      if (helpers && helpers.computeImpactScope) {
        const impact = helpers.computeImpactScope({
          root: projectDir,
          changedFiles: edit_candidates.slice(0, 8).map((c) => c.path),
          graphPath: path.join('specs', 'brownfield', 'code-graph.json'),
          matrixPath: path.join('specs', 'test_artefacts', 'verification-matrix.json'),
          componentMapPath: path.join('specs', 'design', 'component-map.md'),
          e2eDir: 'e2e',
          contractsDir: 'sprint-contracts',
        });
        for (const spec of impact.specs || []) {
          const p = typeof spec === 'string' ? spec : (spec.path || spec.file);
          if (p && !seenTest.has(p)) {
            seenTest.add(p);
            tests_to_run.push({ kind: 'impact_spec', path: p });
          }
        }
        for (const c of impact.contracts || []) {
          const p = typeof c === 'string' ? c : (c.path || c.file);
          if (p) tests_to_run.push({ kind: 'impact_contract', path: p });
        }
      }
    } catch (_) { /* fail open */ }
  }

  const clarify_options = [];
  if (confidence === 'low' && clusters.length >= 2) {
    for (const c of clusters.slice(0, 3)) {
      clarify_options.push({
        label: c.id,
        paths: c.paths.slice(0, 6),
        symbols: c.symbols.slice(0, 6),
        score: c.score,
      });
    }
  }

  return {
    entrypoints: entrypoints.slice(0, 8),
    edit_candidates: edit_candidates.slice(0, 10),
    must_not_break: must_not_break.slice(0, 10),
    tests_to_run,
    clusters,
    clarify_options,
  };
}

function writeReceipt(projectDir, pack) {
  const stateDir = path.join(projectDir, '.claude', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const receipt = {
    ts: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    question: pack.question,
    question_hash: crypto.createHash('sha256').update(String(pack.question || '')).digest('hex').slice(0, 16),
    status: pack.status,
    confidence: pack.confidence,
    estimated_tokens: pack.estimated_tokens,
    result_count: (pack.results || []).length,
  };
  fs.writeFileSync(path.join(stateDir, RECEIPT_NAME), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

function emptyPack(base) {
  return {
    schema_version: SCHEMA_VERSION,
    question: base.question || '',
    status: base.status,
    budget_tokens: base.budgetTokens,
    estimated_tokens: 0,
    confidence: base.confidence || 'low',
    confidence_reasons: base.confidence_reasons || [],
    results: [],
    read_next: [],
    task_map: {
      entrypoints: [],
      edit_candidates: [],
      must_not_break: [],
      tests_to_run: [],
      clusters: [],
      clarify_options: [],
    },
    graph_queries_used: [],
    fallback: {
      allowed: true,
      when: 'status is no_match or confidence is low',
      suggest: [
        "rg -n '<keyword>' --glob '!node_modules' --glob '!.git'",
        'refresh /code-map if source found outside index',
      ],
    },
    warnings: base.warnings || [],
  };
}

function buildContextPack({
  projectDir = process.cwd(),
  question = '',
  budgetTokens = DEFAULT_BUDGET,
  depth = DEFAULT_DEPTH,
  useDiff = false,
  writeReceipt: doWriteReceipt = true,
  maxNeighborFiles = MAX_NEIGHBOR_FILES,
} = {}) {
  const graphPath = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  const graph = readJson(graphPath);
  if (!graph) {
    const pack = emptyPack({
      question,
      status: 'missing',
      budgetTokens,
      warnings: ['missing code-graph.json; run /code-map or /brownfield first'],
    });
    if (doWriteReceipt) writeReceipt(projectDir, pack);
    return pack;
  }
  if ((graph.meta && graph.meta.status === 'empty')
    || ((graph.nodes || []).length === 0 && (graph.files || []).length === 0)) {
    const pack = emptyPack({
      question,
      status: 'placeholder',
      budgetTokens,
      warnings: ['placeholder navigation: no source has been indexed yet'],
    });
    if (doWriteReceipt) writeReceipt(projectDir, pack);
    return pack;
  }

  const indexes = graphIndexes(graph);
  const qWords = queryWords(question);
  const wikiByPath = loadWikiCorpus(projectDir);
  const glossaryWords = loadGlossaryWords(projectDir);
  const dirtySet = useDiff ? loadDirtyPaths(projectDir) : new Set();
  const graphQueriesUsed = [];
  const helpers = tryLoadNavHelpers();
  let navIndex = null;
  let semanticHitCount = 0;
  let cochangeHitCount = 0;
  if (helpers && helpers.loadNavIndex) {
    try { navIndex = helpers.loadNavIndex(projectDir); } catch (_) { navIndex = null; }
  }

  // Score all symbols (lexical + wiki + optional TF-IDF semantic)
  const scored = indexes.symbols.map((s) => {
    let semanticBoost = 0;
    if (navIndex && helpers.scoreSymbolFromIndex && question) {
      semanticBoost = helpers.scoreSymbolFromIndex(navIndex, question, s) || 0;
      if (semanticBoost > 0) semanticHitCount += 1;
    }
    const { score, sources } = scoreSymbol(qWords, s, wikiByPath, glossaryWords, dirtySet, semanticBoost);
    return { ...s, score, sources };
  }).filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score
      || a.path.localeCompare(b.path)
      || (a.symbol || '').localeCompare(b.symbol || ''));

  // Wiki-only path hits: if wiki scores a path but no symbol scored well, add file-level hits
  if (wikiByPath.has('*') && qWords.length) {
    const global = wikiByPath.get('*');
    const pathMentions = new Set();
    for (const m of global.matchAll(/`?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`?/g)) {
      if (m[1].includes('/')) pathMentions.add(m[1]);
    }
    for (const f of graph.files || []) {
      const already = scored.some((s) => s.path === f.path);
      if (already) continue;
      const wText = wikiTextForPath(wikiByPath, f.path);
      const wScore = 1.5 * bm25ish(qWords, words(wText));
      if (wScore <= 0 && !pathMentions.has(f.path)) continue;
      if (wScore <= 0) continue;
      const sym = firstSymbolInPath(indexes, f.path);
      scored.push({
        ...sym,
        score: wScore + (dirtySet.has(f.path) ? 1.2 : 0),
        sources: ['wiki'],
      });
    }
    scored.sort((a, b) => b.score - a.score
      || a.path.localeCompare(b.path)
      || (a.symbol || '').localeCompare(b.symbol || ''));
  }

  const results = [];
  const seedPaths = [];

  for (const hit of scored) {
    const conf = hit.score >= 4 ? 'high' : hit.score >= 1.5 ? 'medium' : 'low';
    const reason = hit.sources.includes('exact_symbol')
      ? 'symbol/signature match'
      : hit.sources.includes('semantic') && !hit.sources.includes('lexical') && !hit.sources.includes('wiki')
        ? 'semantic index match'
        : hit.sources.includes('wiki') && !hit.sources.includes('lexical')
          ? 'wiki text match'
          : hit.sources.includes('wiki')
            ? 'lexical + wiki match'
            : 'lexical match';
    addUnique(results, makeResult(hit, reason, conf, hit.score, hit.sources));
    seedPaths.push(hit.path);
    if (estimatePackTokens(results) >= budgetTokens) break;
  }

  // Multi-hop expansion from top seeds
  const expandFrom = seedPaths.slice(0, 5);
  for (const seed of expandFrom) {
    graphQueriesUsed.push({ op: 'neighbors', arg: seed, depth });
    const nbrs = neighborsAtDepth(indexes, seed, depth, maxNeighborFiles);
    for (const [nbrPath, meta] of nbrs) {
      const neighbor = firstSymbolInPath(indexes, nbrPath);
      const depthBoost = meta.depth === 1 ? 0.8 : 0.4;
      let nScore = depthBoost;
      if (dirtySet.has(nbrPath)) nScore += 1.2;
      if (isTestPath(nbrPath)) nScore += 0.6;
      const kinds = (meta.kinds || []).join('|') || 'related';
      const conf = meta.depth === 1 ? 'medium' : 'low';
      addUnique(
        results,
        makeResult(
          neighbor,
          `graph neighbor depth=${meta.depth} of ${seed} (${kinds})`,
          conf,
          nScore,
          ['graph_neighbor', meta.depth === 1 ? 'depth1' : 'depth2'],
        ),
      );
      if (estimatePackTokens(results) >= budgetTokens) break;
    }
    if (estimatePackTokens(results) >= budgetTokens) break;
  }

  // Co-change expansion (files that often commit together)
  if (helpers && helpers.cochangeNeighbors) {
    for (const seed of expandFrom.slice(0, 5)) {
      const cos = helpers.cochangeNeighbors(projectDir, seed, { limit: 6 });
      if (!cos.length) continue;
      graphQueriesUsed.push({ op: 'cochange', arg: seed });
      for (const n of cos) {
        const neighbor = firstSymbolInPath(indexes, n.path);
        const nScore = 0.5 + Math.min(1.0, (n.count || 1) / 10);
        cochangeHitCount += 1;
        addUnique(
          results,
          makeResult(
            neighbor,
            `co-change with ${seed} (count=${n.count})`,
            'medium',
            nScore,
            ['cochange'],
          ),
        );
        if (estimatePackTokens(results) >= budgetTokens) break;
      }
      if (estimatePackTokens(results) >= budgetTokens) break;
    }
  }

  // Prefer higher scores when trimming
  results.sort((a, b) => (b.score || 0) - (a.score || 0)
    || a.path.localeCompare(b.path)
    || (a.symbol || '').localeCompare(b.symbol || ''));

  const trimmed = [];
  for (const result of results) {
    trimmed.push(result);
    if (estimatePackTokens(trimmed) >= budgetTokens) {
      trimmed.pop();
      break;
    }
  }
  const finalResults = trimmed.length ? trimmed : results.slice(0, 1);

  const clusters = buildClusters(finalResults);
  const { confidence, reasons: confidence_reasons } = confidenceOf(finalResults, clusters);
  const task_map = buildTaskMap(finalResults, clusters, confidence, projectDir);

  let status = 'no_match';
  if (finalResults.length) {
    status = confidence === 'low' && (clusters.length >= 2 || (finalResults[0].score || 0) < 1.5)
      ? 'low_confidence'
      : 'ok';
  }

  const pack = {
    schema_version: SCHEMA_VERSION,
    question,
    status: finalResults.length ? status : 'no_match',
    budget_tokens: budgetTokens,
    estimated_tokens: estimatePackTokens(finalResults),
    confidence: finalResults.length ? confidence : 'low',
    confidence_reasons: finalResults.length ? confidence_reasons : ['no_results'],
    results: finalResults,
    read_next: finalResults.map((r) => `Read ${r.path} lines ${r.start}-${r.end}`),
    task_map,
    graph_queries_used: graphQueriesUsed,
    fallback: {
      allowed: true,
      when: 'status is no_match or confidence is low',
      suggest: [
        "rg -n '<keyword>' --glob '!node_modules' --glob '!.git'",
        'refresh /code-map if source found outside index',
        'node .claude/scripts/nav-query.js refresh  # rebuild semantic + cochange + concepts',
      ],
    },
    warnings: finalResults.length ? [] : ['no matching symbols or modules found in code graph'],
  };

  // Recompute estimated_tokens including task_map roughly (still citation-first)
  pack.estimated_tokens = estimatePackTokens({
    results: pack.results,
    task_map: pack.task_map,
    read_next: pack.read_next,
  });

  if (doWriteReceipt) writeReceipt(projectDir, pack);
  if (helpers && helpers.appendNavEvent) {
    helpers.appendNavEvent(projectDir, {
      kind: 'context_pack',
      status: pack.status,
      confidence: pack.confidence,
      result_count: pack.results.length,
      estimated_tokens: pack.estimated_tokens,
      semantic_hits: semanticHitCount,
      cochange_hits: cochangeHitCount,
    });
  }
  return pack;
}

module.exports = {
  buildContextPack,
  estimateTextTokens,
  writeReceipt,
  RECEIPT_NAME,
  queryWords,
  bm25ish,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i === -1) return null;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const has = (flag) => {
    const i = args.indexOf(flag);
    if (i === -1) return false;
    args.splice(i, 1);
    return true;
  };

  const projectDir = take('--root') || process.cwd();
  const budgetTokens = parseInt(take('--budget') || String(DEFAULT_BUDGET), 10) || DEFAULT_BUDGET;
  const depth = parseInt(take('--depth') || String(DEFAULT_DEPTH), 10) || DEFAULT_DEPTH;
  const jsonOut = take('--json-out');
  const useDiff = has('--diff');
  const noReceipt = has('--no-receipt');
  const question = args.join(' ').trim();

  const pack = buildContextPack({
    projectDir,
    question,
    budgetTokens,
    depth,
    useDiff,
    writeReceipt: !noReceipt,
  });
  const text = `${JSON.stringify(pack, null, 2)}\n`;
  if (jsonOut) {
    fs.mkdirSync(path.dirname(path.resolve(projectDir, jsonOut)), { recursive: true });
    fs.writeFileSync(path.resolve(projectDir, jsonOut), text);
  }
  process.stdout.write(text);
}
