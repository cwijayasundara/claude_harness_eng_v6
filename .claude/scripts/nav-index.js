#!/usr/bin/env node

'use strict';

// Offline TF-IDF "semantic" nav index over code-graph symbols + wiki text.
// Zero external deps. Fail-open when missing. Stored under .claude/state/nav-index/.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INDEX_DIR = path.join('.claude', 'state', 'nav-index');
const INDEX_FILE = 'index.json';

function words(text) {
  return [...String(text || '').toLowerCase().matchAll(/[a-z0-9_]{2,}/g)].map((m) => m[0]);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function indexDir(projectDir) {
  return path.join(projectDir, INDEX_DIR);
}

function indexPath(projectDir) {
  return path.join(indexDir(projectDir), INDEX_FILE);
}

function loadWikiTexts(projectDir, maxBytes = 64 * 1024) {
  const out = [];
  let total = 0;
  const wikiDir = path.join(projectDir, 'specs', 'brownfield', 'wiki');
  const files = [];
  const root = path.join(wikiDir, 'WIKI.md');
  if (fs.existsSync(root)) files.push({ path: 'wiki/WIKI.md', abs: root });
  const pages = path.join(wikiDir, 'pages');
  if (fs.existsSync(pages)) {
    for (const name of fs.readdirSync(pages).sort().slice(0, 40)) {
      if (name.endsWith('.md')) files.push({ path: `wiki/pages/${name}`, abs: path.join(pages, name) });
    }
  }
  for (const f of files) {
    if (total >= maxBytes) break;
    try {
      const text = fs.readFileSync(f.abs, 'utf8').slice(0, maxBytes - total);
      total += text.length;
      out.push({ path: f.path, text, kind: 'wiki' });
    } catch (_) { /* skip */ }
  }
  return out;
}

function collectChunks(projectDir, graph) {
  const chunks = [];
  for (const f of graph.files || []) {
    for (const s of f.symbols || []) {
      const name = s.name || '';
      const sig = s.signature || '';
      const text = [name, sig, f.path, s.kind || ''].filter(Boolean).join(' ');
      chunks.push({
        id: `${f.path}:${name || 'anon'}:${s.start || s.line || 1}`,
        path: f.path,
        start: s.start || s.line || 1,
        end: s.end || s.start || s.line || 1,
        symbol: name || null,
        kind: s.kind || 'symbol',
        text,
      });
    }
  }
  for (const w of loadWikiTexts(projectDir)) {
    chunks.push({
      id: `wiki:${w.path}`,
      path: w.path,
      start: 1,
      end: 1,
      symbol: null,
      kind: 'wiki',
      text: w.text.slice(0, 4000),
    });
  }
  return chunks;
}

function buildTfIdf(chunks) {
  const N = Math.max(chunks.length, 1);
  const df = new Map();
  const docs = chunks.map((c) => {
    const toks = words(c.text);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return { chunk: c, tf, len: toks.length || 1 };
  });

  const idf = {};
  for (const [t, d] of df) {
    idf[t] = Math.log((N + 1) / (d + 0.5)) + 1;
  }

  const vectors = docs.map((d) => {
    const vec = {};
    let norm = 0;
    for (const [t, f] of d.tf) {
      const w = (f / d.len) * (idf[t] || 0);
      if (w > 0) {
        vec[t] = Math.round(w * 1e6) / 1e6;
        norm += w * w;
      }
    }
    return {
      id: d.chunk.id,
      path: d.chunk.path,
      start: d.chunk.start,
      end: d.chunk.end,
      symbol: d.chunk.symbol,
      kind: d.chunk.kind,
      vec,
      norm: Math.sqrt(norm) || 1,
    };
  });

  return { idf, vectors, chunk_count: chunks.length };
}

function graphFingerprint(graph) {
  const meta = (graph && graph.meta) || {};
  const n = (graph.files || []).length;
  const e = (graph.edges || []).length;
  const h = crypto.createHash('sha256')
    .update(String(meta.generated_at || ''))
    .update(`:${n}:${e}`)
    .digest('hex')
    .slice(0, 16);
  return h;
}

function buildNavIndex({ projectDir = process.cwd(), graphPath } = {}) {
  const gPath = graphPath || path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  const graph = readJson(gPath);
  if (!graph || ((graph.nodes || []).length === 0 && (graph.files || []).length === 0)) {
    return { ok: false, reason: 'missing_or_empty_graph' };
  }
  const chunks = collectChunks(projectDir, graph);
  const { idf, vectors, chunk_count } = buildTfIdf(chunks);
  const index = {
    schema_version: 1,
    model: 'tfidf-local',
    built_at: new Date().toISOString(),
    graph_fingerprint: graphFingerprint(graph),
    graph_meta_generated_at: (graph.meta && graph.meta.generated_at) || null,
    chunk_count,
    idf,
    vectors,
  };
  const dir = indexDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(indexPath(projectDir), `${JSON.stringify(index)}\n`);
  return { ok: true, chunk_count, path: indexPath(projectDir) };
}

function loadNavIndex(projectDir) {
  return readJson(indexPath(projectDir));
}

function cosineQuery(index, question, { topK = 20, minScore = 0.05 } = {}) {
  if (!index || !index.vectors || !index.idf) return [];
  const toks = words(question);
  if (!toks.length) return [];
  const qtf = new Map();
  for (const t of toks) qtf.set(t, (qtf.get(t) || 0) + 1);
  const qvec = {};
  let qnorm = 0;
  for (const [t, f] of qtf) {
    const w = (f / toks.length) * (index.idf[t] || 0);
    if (w > 0) {
      qvec[t] = w;
      qnorm += w * w;
    }
  }
  qnorm = Math.sqrt(qnorm) || 1;
  const hits = [];
  for (const v of index.vectors) {
    if (v.kind === 'wiki') continue; // rank source symbols primarily
    let dot = 0;
    for (const [t, w] of Object.entries(qvec)) {
      if (v.vec[t]) dot += w * v.vec[t];
    }
    const score = dot / (qnorm * (v.norm || 1));
    if (score >= minScore) {
      hits.push({
        path: v.path,
        start: v.start,
        end: v.end,
        symbol: v.symbol,
        kind: v.kind,
        score,
        source: 'semantic',
      });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, topK);
}

function scoreSymbolFromIndex(index, question, record) {
  if (!index) return 0;
  const hits = cosineQuery(index, question, { topK: 50, minScore: 0.03 });
  const hit = hits.find((h) =>
    h.path === record.path
    && (!record.symbol || !h.symbol || h.symbol === record.symbol));
  if (!hit) {
    const pathHit = hits.find((h) => h.path === record.path);
    return pathHit ? pathHit.score * 2.0 : 0;
  }
  return hit.score * 3.0;
}

module.exports = {
  buildNavIndex,
  loadNavIndex,
  cosineQuery,
  scoreSymbolFromIndex,
  indexPath,
  graphFingerprint,
  words,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const projectDir = rootIdx === -1 ? process.cwd() : args[rootIdx + 1];
  const result = buildNavIndex({ projectDir });
  if (!result.ok) {
    process.stderr.write(`nav-index: ${result.reason}\n`);
    process.exit(0); // fail open
  }
  process.stdout.write(`nav-index: built ${result.chunk_count} chunks → ${result.path}\n`);
}
