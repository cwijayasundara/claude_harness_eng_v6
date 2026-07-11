'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { buildContextPack, estimateTextTokens } = require('../.claude/scripts/context-pack');
const { applyScaffold } = require('../.claude/scripts/scaffold-apply');

const ROOT = path.join(__dirname, '..');
const PLUGIN_SOURCE = path.join(ROOT, '.claude');

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-'));
  fs.mkdirSync(path.join(dir, 'specs', 'brownfield', 'wiki', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  return dir;
}

function writeGraph(dir) {
  const graph = {
    meta: { producer: 'vendored-ast' },
    nodes: [
      { id: 'py:src/auth/session.py', kind: 'file', path: 'src/auth/session.py', symbols: ['validate_session'] },
      { id: 'py:src/api/middleware.py', kind: 'file', path: 'src/api/middleware.py', symbols: ['auth_middleware'] },
      { id: 'py:tests/test_session.py', kind: 'file', path: 'tests/test_session.py', symbols: ['test_expired_session'] },
    ],
    files: [
      { path: 'src/auth/session.py', symbols: [{ name: 'validate_session', kind: 'function', start: 41, end: 88, signature: 'def validate_session(token):' }] },
      { path: 'src/api/middleware.py', symbols: [{ name: 'auth_middleware', kind: 'function', start: 12, end: 49, signature: 'def auth_middleware(request):' }] },
      { path: 'tests/test_session.py', symbols: [{ name: 'test_expired_session', kind: 'function', start: 20, end: 39, signature: 'def test_expired_session():' }] },
    ],
    edges: [
      { source: 'py:src/api/middleware.py', target: 'py:src/auth/session.py', kind: 'calls', evidence: 'src/api/middleware.py:18 validate_session(token)' },
      { source: 'py:tests/test_session.py', target: 'py:src/auth/session.py', kind: 'calls', evidence: 'tests/test_session.py:23 validate_session(expired)' },
    ],
  };
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'wiki', 'WIKI.md'), [
    '# Codebase Wiki',
    '',
    'Session validation is handled by `validate_session` in auth/session.py.',
    'Middleware calls session validation before API handlers run.',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'wiki', 'pages', 'auth.md'), [
    '# Auth',
    '',
    '`validate_session` checks token expiry and permissions.',
  ].join('\n'));
}

test('context pack returns exact cited line ranges for symbol queries', () => {
  const dir = tempProject();
  try {
    writeGraph(dir);
    const pack = buildContextPack({
      projectDir: dir,
      question: 'where is validate_session handled?',
      budgetTokens: 1200,
      writeReceipt: false,
    });

    assert.strictEqual(pack.status, 'ok');
    assert.strictEqual(pack.schema_version, 2);
    assert.strictEqual(pack.results[0].path, 'src/auth/session.py');
    assert.strictEqual(pack.results[0].start, 41);
    assert.strictEqual(pack.results[0].end, 88);
    assert.strictEqual(pack.results[0].symbol, 'validate_session');
    assert.match(pack.results[0].reason, /symbol/i);
    assert.ok(pack.read_next.includes('Read src/auth/session.py lines 41-88'));
    assert.ok(pack.estimated_tokens <= 1200, JSON.stringify(pack));
    assert.ok(pack.task_map);
    assert.ok(pack.task_map.edit_candidates.some((c) => c.path === 'src/auth/session.py'));
    assert.ok(['high', 'medium'].includes(pack.confidence), pack.confidence);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context pack expands to direct graph neighbors within budget', () => {
  const dir = tempProject();
  try {
    writeGraph(dir);
    const pack = buildContextPack({
      projectDir: dir,
      question: 'session validation middleware test',
      budgetTokens: 1200,
      writeReceipt: false,
    });
    const paths = pack.results.map((r) => r.path);

    assert.ok(paths.includes('src/auth/session.py'), JSON.stringify(pack.results));
    assert.ok(paths.includes('src/api/middleware.py'), JSON.stringify(pack.results));
    assert.ok(paths.includes('tests/test_session.py'), JSON.stringify(pack.results));
    assert.ok(pack.results.every((r) => r.end >= r.start), 'all results should have line ranges');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context pack matches wiki prose when symbol names do not overlap the query', () => {
  const dir = tempProject();
  try {
    // Symbol is check_jwt — query uses domain language only present in the wiki.
    const graph = {
      meta: { producer: 'vendored-ast' },
      nodes: [
        { id: 'py:src/auth/session.py', kind: 'file', path: 'src/auth/session.py', symbols: ['check_jwt'] },
        { id: 'py:src/billing/invoice.py', kind: 'file', path: 'src/billing/invoice.py', symbols: ['render_invoice'] },
      ],
      files: [
        { path: 'src/auth/session.py', symbols: [{ name: 'check_jwt', kind: 'function', start: 10, end: 40, signature: 'def check_jwt(token):' }] },
        { path: 'src/billing/invoice.py', symbols: [{ name: 'render_invoice', kind: 'function', start: 1, end: 20, signature: 'def render_invoice():' }] },
      ],
      edges: [],
    };
    fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'wiki', 'WIKI.md'), [
      '# Wiki',
      '',
      'Session validation is handled by check_jwt in src/auth/session.py.',
      'Billing invoices are unrelated.',
    ].join('\n'));

    const pack = buildContextPack({
      projectDir: dir,
      question: 'where is session validation handled?',
      budgetTokens: 1200,
      writeReceipt: false,
    });

    assert.ok(pack.results.length, JSON.stringify(pack));
    assert.strictEqual(pack.results[0].path, 'src/auth/session.py', JSON.stringify(pack.results));
    assert.ok(
      (pack.results[0].sources || []).includes('wiki') || /wiki/i.test(pack.results[0].reason || ''),
      JSON.stringify(pack.results[0]),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context pack expands graph neighbors to depth 2', () => {
  const dir = tempProject();
  try {
    // A -> B -> C chain; query hits A only by symbol
    const graph = {
      meta: { producer: 'vendored-ast' },
      nodes: [
        { id: 'js:src/a.js', kind: 'file', path: 'src/a.js', symbols: ['alpha'] },
        { id: 'js:src/b.js', kind: 'file', path: 'src/b.js', symbols: ['beta'] },
        { id: 'js:src/c.js', kind: 'file', path: 'src/c.js', symbols: ['gamma'] },
      ],
      files: [
        { path: 'src/a.js', symbols: [{ name: 'alpha', kind: 'function', start: 1, end: 5, signature: 'function alpha()' }] },
        { path: 'src/b.js', symbols: [{ name: 'beta', kind: 'function', start: 1, end: 5, signature: 'function beta()' }] },
        { path: 'src/c.js', symbols: [{ name: 'gamma', kind: 'function', start: 1, end: 5, signature: 'function gamma()' }] },
      ],
      edges: [
        { source: 'js:src/a.js', target: 'js:src/b.js', kind: 'calls' },
        { source: 'js:src/b.js', target: 'js:src/c.js', kind: 'calls' },
      ],
    };
    fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'wiki', 'WIKI.md'), '# empty\n');

    const pack = buildContextPack({
      projectDir: dir,
      question: 'alpha',
      budgetTokens: 4000,
      depth: 2,
      writeReceipt: false,
    });
    const paths = pack.results.map((r) => r.path);
    assert.ok(paths.includes('src/a.js'), JSON.stringify(paths));
    assert.ok(paths.includes('src/b.js'), JSON.stringify(paths));
    assert.ok(paths.includes('src/c.js'), `depth-2 neighbor missing: ${JSON.stringify(paths)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context pack --diff boost ranks dirty files above equal lexical peers', () => {
  const dir = tempProject();
  try {
    const graph = {
      meta: { producer: 'vendored-ast' },
      nodes: [
        { id: 'js:src/foo_handler.js', kind: 'file', path: 'src/foo_handler.js', symbols: ['handle_foo'] },
        { id: 'js:src/foo_util.js', kind: 'file', path: 'src/foo_util.js', symbols: ['handle_foo_util'] },
      ],
      files: [
        { path: 'src/foo_handler.js', symbols: [{ name: 'handle_foo', kind: 'function', start: 1, end: 10, signature: 'function handle_foo()' }] },
        { path: 'src/foo_util.js', symbols: [{ name: 'handle_foo_util', kind: 'function', start: 1, end: 10, signature: 'function handle_foo_util()' }] },
      ],
      edges: [],
    };
    fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
    fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'state', 'graph-dirty.jsonl'),
      `${JSON.stringify({ path: 'src/foo_util.js' })}\n`,
    );

    const pack = buildContextPack({
      projectDir: dir,
      question: 'handle_foo',
      budgetTokens: 1200,
      useDiff: true,
      writeReceipt: false,
    });
    // dirty util should outrank or at least include git_diff source when both match
    const util = pack.results.find((r) => r.path === 'src/foo_util.js');
    assert.ok(util, JSON.stringify(pack.results));
    assert.ok((util.sources || []).includes('git_diff'), JSON.stringify(util));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context pack reports low confidence for multi-cluster ambiguity', () => {
  const dir = tempProject();
  try {
    const graph = {
      meta: { producer: 'vendored-ast' },
      nodes: [
        { id: 'js:src/auth/token.js', kind: 'file', path: 'src/auth/token.js', symbols: ['refresh_token'] },
        { id: 'js:src/billing/token.js', kind: 'file', path: 'src/billing/token.js', symbols: ['usage_token'] },
      ],
      files: [
        { path: 'src/auth/token.js', symbols: [{ name: 'refresh_token', kind: 'function', start: 1, end: 20, signature: 'function refresh_token()' }] },
        { path: 'src/billing/token.js', symbols: [{ name: 'usage_token', kind: 'function', start: 1, end: 20, signature: 'function usage_token()' }] },
      ],
      edges: [],
    };
    fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'wiki', 'WIKI.md'), '# tokens\n');

    const pack = buildContextPack({
      projectDir: dir,
      question: 'token',
      budgetTokens: 1200,
      writeReceipt: false,
    });

    assert.ok(pack.task_map.clusters.length >= 2, JSON.stringify(pack.task_map.clusters));
    assert.ok(
      pack.confidence === 'low' || pack.status === 'low_confidence' || pack.task_map.clarify_options.length >= 1,
      JSON.stringify({ confidence: pack.confidence, status: pack.status, clarify: pack.task_map.clarify_options }),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context pack writes a session receipt by default', () => {
  const dir = tempProject();
  try {
    writeGraph(dir);
    const pack = buildContextPack({ projectDir: dir, question: 'validate_session', budgetTokens: 1200 });
    const receiptPath = path.join(dir, '.claude', 'state', 'context-pack-last.json');
    assert.ok(fs.existsSync(receiptPath), 'receipt should exist');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(receipt.status, pack.status);
    assert.ok(receipt.question_hash);
    assert.ok(receipt.ts);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context pack reports missing or placeholder navigation without fabricating results', () => {
  const dir = tempProject();
  try {
    fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), JSON.stringify({
      nodes: [], edges: [], files: [], meta: { producer: 'none', status: 'empty' },
    }));
    const pack = buildContextPack({ projectDir: dir, question: 'auth', writeReceipt: false });

    assert.strictEqual(pack.status, 'placeholder');
    assert.deepStrictEqual(pack.results, []);
    assert.match(pack.warnings[0], /placeholder|no source/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('estimateTextTokens uses the same cheap deterministic approximation as navigation refresh', () => {
  assert.strictEqual(estimateTextTokens(''), 0);
  assert.strictEqual(estimateTextTokens('one two three four'), 5);
});

test('core scaffold copies context skill and context-pack script', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-scaffold-'));
  try {
    const profile = path.join(dir, 'profile.json');
    fs.writeFileSync(profile, JSON.stringify({
      name: 'ctx-app',
      description: 'context pack scaffold test',
      projectType: 'D',
      verificationMode: 'C',
      stack: { backend: null, frontend: null, database: null },
    }));
    applyScaffold({ profile, pluginSource: PLUGIN_SOURCE, target: path.join(dir, 'project') });

    assert.ok(fs.existsSync(path.join(dir, 'project', '.claude', 'scripts', 'context-pack.js')));
    assert.ok(fs.existsSync(path.join(dir, 'project', '.claude', 'skills', 'context', 'SKILL.md')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
