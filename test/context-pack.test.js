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
    const pack = buildContextPack({ projectDir: dir, question: 'where is validate_session handled?', budgetTokens: 1200 });

    assert.strictEqual(pack.status, 'ok');
    assert.strictEqual(pack.results[0].path, 'src/auth/session.py');
    assert.strictEqual(pack.results[0].start, 41);
    assert.strictEqual(pack.results[0].end, 88);
    assert.strictEqual(pack.results[0].symbol, 'validate_session');
    assert.match(pack.results[0].reason, /symbol/i);
    assert.ok(pack.read_next.includes('Read src/auth/session.py lines 41-88'));
    assert.ok(pack.estimated_tokens <= 1200, JSON.stringify(pack));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('context pack expands to direct graph neighbors within budget', () => {
  const dir = tempProject();
  try {
    writeGraph(dir);
    const pack = buildContextPack({ projectDir: dir, question: 'session validation middleware test', budgetTokens: 1200 });
    const paths = pack.results.map((r) => r.path);

    assert.ok(paths.includes('src/auth/session.py'), JSON.stringify(pack.results));
    assert.ok(paths.includes('src/api/middleware.py'), JSON.stringify(pack.results));
    assert.ok(paths.includes('tests/test_session.py'), JSON.stringify(pack.results));
    assert.ok(pack.results.every((r) => r.end >= r.start), 'all results should have line ranges');
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
    const pack = buildContextPack({ projectDir: dir, question: 'auth' });

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
