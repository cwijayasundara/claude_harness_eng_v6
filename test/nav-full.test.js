'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const { buildNavIndex, loadNavIndex, cosineQuery } = require('../.claude/scripts/nav-index');
const { buildCochange, cochangeNeighbors } = require('../.claude/scripts/nav-cochange');
const { buildConceptPages } = require('../.claude/scripts/nav-concepts');
const { buildContextPack } = require('../.claude/scripts/context-pack');
const { callTool, handle } = require('../.claude/scripts/nav-mcp-server');
const { appendNavEvent, readNavTelemetrySummary } = require('../.claude/scripts/nav-telemetry');
const { cmdRefresh } = require('../.claude/scripts/nav-query');

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-full-'));
  fs.mkdirSync(path.join(dir, 'specs', 'brownfield', 'wiki', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'auth'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'billing'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
  return dir;
}

function writeGraph(dir) {
  const graph = {
    meta: { producer: 'vendored-ast', generated_at: '2026-07-11T00:00:00Z' },
    nodes: [
      { id: 'js:src/auth/session.js', kind: 'file', path: 'src/auth/session.js', symbols: ['validateSession'] },
      { id: 'js:src/auth/middleware.js', kind: 'file', path: 'src/auth/middleware.js', symbols: ['authMiddleware'] },
      { id: 'js:src/billing/invoice.js', kind: 'file', path: 'src/billing/invoice.js', symbols: ['renderInvoice'] },
    ],
    files: [
      {
        path: 'src/auth/session.js',
        symbols: [{ name: 'validateSession', kind: 'function', start: 1, end: 20, signature: 'function validateSession(token)' }],
      },
      {
        path: 'src/auth/middleware.js',
        symbols: [{ name: 'authMiddleware', kind: 'function', start: 1, end: 15, signature: 'function authMiddleware(req)' }],
      },
      {
        path: 'src/billing/invoice.js',
        symbols: [{ name: 'renderInvoice', kind: 'function', start: 1, end: 10, signature: 'function renderInvoice()' }],
      },
    ],
    edges: [
      { source: 'js:src/auth/middleware.js', target: 'js:src/auth/session.js', kind: 'calls' },
    ],
    metrics: { hubs: [{ id: 'js:src/auth/session.js', fan_in: 5, fan_out: 1 }] },
  };
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), JSON.stringify(graph, null, 2));
  fs.writeFileSync(path.join(dir, 'src', 'auth', 'session.js'), 'function validateSession(token) { return !!token; }\n');
  fs.writeFileSync(path.join(dir, 'src', 'auth', 'middleware.js'), 'function authMiddleware(req) { return validateSession(req.token); }\n');
  fs.writeFileSync(path.join(dir, 'src', 'billing', 'invoice.js'), 'function renderInvoice() { return {}; }\n');
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'wiki', 'WIKI.md'), [
    '# Wiki',
    '',
    'Session validation lives in src/auth/session.js via validateSession.',
    'Billing is separate.',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, '.harness', 'wiki.json'), JSON.stringify({
    repo_notes: [{ content: 'Auth is highest priority.' }],
    max_concept_pages: 10,
    priority_paths: ['src/auth'],
  }));
}

test('nav-index builds TF-IDF vectors and ranks session validation', () => {
  const dir = tempProject();
  try {
    writeGraph(dir);
    const built = buildNavIndex({ projectDir: dir });
    assert.ok(built.ok, JSON.stringify(built));
    const index = loadNavIndex(dir);
    assert.ok(index.chunk_count > 0);
    const hits = cosineQuery(index, 'session validation token', { topK: 5, minScore: 0.01 });
    assert.ok(hits.length, 'expected semantic hits');
    assert.ok(hits.some((h) => h.path.includes('auth')), JSON.stringify(hits));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nav-concepts writes hash-cached concept pages and skips unchanged rebuild', () => {
  const dir = tempProject();
  try {
    writeGraph(dir);
    const first = buildConceptPages({ projectDir: dir });
    assert.ok(first.ok);
    assert.ok(first.written >= 1);
    const second = buildConceptPages({ projectDir: dir });
    assert.ok(second.ok);
    assert.strictEqual(second.written, 0);
    assert.ok(second.skipped >= 1);
    const conceptsDir = path.join(dir, 'specs', 'brownfield', 'wiki', 'concepts');
    assert.ok(fs.existsSync(path.join(conceptsDir, 'INDEX.md')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nav-cochange records neighbors from synthetic git history', () => {
  const dir = tempProject();
  try {
    writeGraph(dir);
    execFileSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
    execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
    // commit pairs together multiple times
    for (let i = 0; i < 3; i++) {
      fs.appendFileSync(path.join(dir, 'src', 'auth', 'session.js'), `// c${i}\n`);
      fs.appendFileSync(path.join(dir, 'src', 'auth', 'middleware.js'), `// c${i}\n`);
      execFileSync('git', ['add', '-A'], { cwd: dir });
      execFileSync('git', ['commit', '-m', `pair ${i}`], { cwd: dir, encoding: 'utf8' });
    }
    const built = buildCochange({ projectDir: dir, months: 12, minCount: 2 });
    assert.ok(built.ok, JSON.stringify(built));
    const nbrs = cochangeNeighbors(dir, 'src/auth/session.js', { minCount: 2 });
    assert.ok(nbrs.some((n) => n.path === 'src/auth/middleware.js'), JSON.stringify(nbrs));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context pack uses semantic index when present', () => {
  const dir = tempProject();
  try {
    writeGraph(dir);
    buildNavIndex({ projectDir: dir });
    const pack = buildContextPack({
      projectDir: dir,
      question: 'session validation',
      budgetTokens: 2000,
      writeReceipt: false,
    });
    assert.ok(pack.results.length);
    // At least one result should be able to carry semantic when index matches
    assert.ok(
      pack.results.some((r) => (r.sources || []).includes('semantic') || r.path.includes('auth')),
      JSON.stringify(pack.results),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context pack expands co-change neighbors', () => {
  const dir = tempProject();
  try {
    writeGraph(dir);
    execFileSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
    execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
    for (let i = 0; i < 3; i++) {
      fs.appendFileSync(path.join(dir, 'src', 'auth', 'session.js'), `// x${i}\n`);
      fs.appendFileSync(path.join(dir, 'src', 'auth', 'middleware.js'), `// x${i}\n`);
      execFileSync('git', ['add', '-A'], { cwd: dir });
      execFileSync('git', ['commit', '-m', `p${i}`], { cwd: dir, encoding: 'utf8' });
    }
    buildCochange({ projectDir: dir, months: 12, minCount: 2 });
    const pack = buildContextPack({
      projectDir: dir,
      question: 'validateSession',
      budgetTokens: 4000,
      writeReceipt: false,
    });
    const paths = pack.results.map((r) => r.path);
    assert.ok(paths.includes('src/auth/session.js'), JSON.stringify(paths));
    assert.ok(
      paths.includes('src/auth/middleware.js')
        || pack.results.some((r) => (r.sources || []).includes('cochange')),
      JSON.stringify(pack.results),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nav telemetry summary accumulates pack events', () => {
  const dir = tempProject();
  try {
    appendNavEvent(dir, { kind: 'context_pack', status: 'ok', semantic_hits: 2, cochange_hits: 1 });
    appendNavEvent(dir, { kind: 'context_pack', status: 'no_match' });
    appendNavEvent(dir, { kind: 'token_advisor', warning_kind: 'context_search_skipped' });
    const s = readNavTelemetrySummary(dir);
    assert.strictEqual(s.pack_requests, 2);
    assert.strictEqual(s.pack_ok, 1);
    assert.strictEqual(s.pack_no_match, 1);
    assert.strictEqual(s.advisor_context_search_skipped, 1);
    assert.strictEqual(s.semantic_hits, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nav-query refresh builds index cochange concepts', () => {
  const dir = tempProject();
  try {
    writeGraph(dir);
    execFileSync('git', ['init'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, encoding: 'utf8' });
    const r = cmdRefresh(dir);
    assert.ok(r.index.ok, JSON.stringify(r.index));
    assert.ok(r.concepts.ok, JSON.stringify(r.concepts));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nav-mcp callTool pack returns schema v2', () => {
  const dir = tempProject();
  const prev = process.env.HARNESS_PROJECT_DIR;
  try {
    writeGraph(dir);
    process.env.HARNESS_PROJECT_DIR = dir;
    const pack = callTool('nav_pack', { question: 'validateSession', budget: 1200 });
    assert.strictEqual(pack.schema_version, 2);
    assert.ok(pack.results.length, JSON.stringify(pack));
    assert.ok(Array.isArray(require('../.claude/scripts/nav-mcp-server').TOOLS));
    assert.ok(require('../.claude/scripts/nav-mcp-server').TOOLS.some((t) => t.name === 'nav_pack'));
    let out = null;
    const orig = process.stdout.write;
    process.stdout.write = (s) => { out = String(s); return true; };
    try {
      handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    } finally {
      process.stdout.write = orig;
    }
    assert.ok(out && out.includes('harness-nav'), out);
  } finally {
    if (prev === undefined) delete process.env.HARNESS_PROJECT_DIR;
    else process.env.HARNESS_PROJECT_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
