const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const repoRoot = path.join(__dirname, '..');
const script = path.join(
  repoRoot, '.claude', 'skills', 'code-map', 'scripts', 'code_index', 'code_index.py'
);
const fixture = path.join(__dirname, 'fixtures', 'code-index', 'sample');

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-index-'));
  fs.cpSync(fixture, dir, { recursive: true });
  return dir;
}

function runIndex(rootDir, extraArgs = []) {
  const out = path.join(rootDir, 'specs', 'brownfield', 'code-graph.json');
  const skel = path.join(rootDir, 'specs', 'brownfield', 'skeletons');
  const res = spawnSync('python3', [
    script, '--root', rootDir, '--out', out,
    '--skeleton-dir', skel, '--skeleton-threshold', '40',
    ...extraArgs,
  ], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  return { graph: JSON.parse(fs.readFileSync(out, 'utf8')), out, skel };
}

function fileRecord(graph, relPath) {
  const rec = graph.files.find((f) => f.path === relPath);
  assert.ok(rec, `missing files record for ${relPath}`);
  return rec;
}

test('emits backward-compatible graph schema with ast producer', () => {
  const dir = makeProject();
  const { graph } = runIndex(dir);
  assert.ok(Array.isArray(graph.nodes) && graph.nodes.length >= 6);
  assert.ok(Array.isArray(graph.edges));
  assert.ok(Array.isArray(graph.files));
  for (const n of graph.nodes) {
    assert.ok(n.id && n.kind === 'file' && n.language && n.path);
    assert.ok(Array.isArray(n.symbols));
  }
  assert.ok(graph.meta.producer.includes('ast'), graph.meta.producer);
  assert.ok(graph.meta.languages.python >= 3);
  assert.ok(graph.meta.generated_at);
  assert.strictEqual(graph.metrics.files, graph.nodes.length);
});

test('extracts python symbols with line ranges, signatures, and nesting', () => {
  const dir = makeProject();
  const { graph } = runIndex(dir);
  const rec = fileRecord(graph, 'api/users.py');
  assert.ok(rec.hash && rec.loc > 0);
  const cls = rec.symbols.find((s) => s.name === 'UserService');
  assert.ok(cls, 'UserService symbol missing');
  assert.strictEqual(cls.kind, 'class');
  assert.ok(cls.start > 0 && cls.end > cls.start);
  assert.ok(cls.signature.startsWith('class UserService'));
  assert.strictEqual(cls.doc, 'Manages user lifecycle.');
  const method = (cls.children || []).find((s) => s.name === 'create_user');
  assert.ok(method, 'create_user child missing');
  assert.ok(method.signature.includes('def create_user(self, name)'));
  const node = graph.nodes.find((n) => n.id === 'py:api/users.py');
  assert.ok(node.symbols.includes('UserService'));
});

test('extracts fastapi route handlers from decorators', () => {
  const dir = makeProject();
  const { graph } = runIndex(dir);
  const rec = fileRecord(graph, 'api/users.py');
  const handler = rec.symbols.find((s) => s.name === 'get_user');
  assert.ok(handler, 'get_user symbol missing');
  assert.deepStrictEqual(handler.route, { method: 'GET', path: '/users/{user_id}' });
});

test('resolves multiline python from-imports to internal edges', () => {
  const dir = makeProject();
  const { graph } = runIndex(dir);
  const edge = graph.edges.find(
    (e) => e.source === 'py:api/users.py' && e.target === 'py:db/session.py' && e.kind === 'imports'
  );
  assert.ok(edge, 'internal import edge missing');
});

test('emits confidence-tagged cross-file call edges without builtin noise', () => {
  const dir = makeProject();
  const { graph } = runIndex(dir);
  const call = graph.edges.find(
    (e) => e.kind === 'calls' && e.source === 'py:api/users.py' &&
      e.target === 'py:db/session.py' && e.symbol_to === 'get_session'
  );
  assert.ok(call, 'cross-file call edge missing');
  assert.ok(['extracted', 'inferred'].includes(call.confidence));
  assert.ok(!graph.edges.some((e) => e.kind === 'calls' && e.symbol_to === 'print'),
    'builtin calls must not produce edges');
});

test('extracts react components and the hooks they use', () => {
  const dir = makeProject();
  const { graph } = runIndex(dir);
  const rec = fileRecord(graph, 'src/App.jsx');
  const app = rec.symbols.find((s) => s.name === 'App');
  assert.ok(app, 'App component missing');
  assert.strictEqual(app.kind, 'component');
  assert.deepStrictEqual([...app.hooks].sort(), ['useEffect', 'useState']);
  assert.ok(rec.symbols.some((s) => s.name === 'Toolbar' && s.kind === 'component'));
  const users = fileRecord(graph, 'src/Users.jsx');
  assert.ok(users.symbols.some((s) => s.name === 'Users' && s.kind === 'component'));
});

test('emits renders edges and react-router route mappings', () => {
  const dir = makeProject();
  const { graph } = runIndex(dir);
  const renders = graph.edges.find(
    (e) => e.kind === 'renders' && e.source === 'js:src/App.jsx' &&
      e.target === 'ts:src/components/Button.tsx'
  );
  assert.ok(renders, 'renders edge App -> Button missing');
  const rec = fileRecord(graph, 'src/App.jsx');
  assert.deepStrictEqual(rec.routes, [{ path: '/users', component: 'Users' }]);
});

test('resolves tsconfig path aliases and flags type-only imports', () => {
  const dir = makeProject();
  const { graph } = runIndex(dir);
  const alias = graph.edges.find(
    (e) => e.source === 'ts:src/components/Button.tsx' &&
      e.target === 'ts:src/lib/utils.ts' && e.kind === 'imports'
  );
  assert.ok(alias, '@/lib/utils alias did not resolve to internal node');
  const typeOnly = graph.edges.find(
    (e) => e.source === 'ts:src/components/Button.tsx' && e.import_kind === 'type'
  );
  assert.ok(typeOnly, 'import type edge not flagged');
  const expected = graph.edges.filter(
    (e) => !e.target.startsWith('ext:') && e.import_kind !== 'type'
  ).length;
  assert.strictEqual(graph.metrics.edges, expected,
    'type-only imports must be excluded from coupling metrics');
});

test('writes skeleton files for sources over the loc threshold', () => {
  const dir = makeProject();
  const { graph, skel } = runIndex(dir);
  const rec = fileRecord(graph, 'big_service.py');
  assert.ok(rec.loc >= 40);
  assert.strictEqual(rec.skeleton, 'skeletons/big_service.py.skel.md');
  const content = fs.readFileSync(path.join(skel, 'big_service.py.skel.md'), 'utf8');
  assert.ok(content.includes('def fn_01'), 'skeleton missing signatures');
  assert.ok(/L\d+-L\d+/.test(content), 'skeleton missing line anchors');
  const small = fileRecord(graph, 'db/session.py');
  assert.strictEqual(small.skeleton, undefined, 'small files get no skeleton');
});

function renderMap(rootDir, out, budget) {
  const mapPath = path.join(rootDir, 'specs', 'brownfield', 'codebase-map.md');
  const res = spawnSync('python3', [
    script, '--render-map', out, '--out', mapPath, '--map-budget', String(budget),
  ], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  return fs.readFileSync(mapPath, 'utf8');
}

test('renders a codebase map with real signatures ranked by fan-in', () => {
  const dir = makeProject();
  const { out } = runIndex(dir);
  const map = renderMap(dir, out, 4000);
  assert.ok(map.includes('db/session.py'), 'imported module missing from map');
  assert.ok(map.includes('def get_session()'), 'real signature missing');
  assert.ok(map.includes('class UserService'), 'class signature missing');
  assert.ok(/L\d+-L\d+/.test(map), 'line anchors missing');
  assert.ok(map.includes('skeletons/big_service.py.skel.md'),
    'god-file skeleton pointer missing');
  const ranked = map.indexOf('## db/session.py');
  const unranked = map.indexOf('## big_service.py');
  assert.ok(ranked !== -1 && unranked !== -1 && ranked < unranked,
    'fan-in ranked files must come before orphans');
});

test('enforces the map token budget and reports omissions', () => {
  const dir = makeProject();
  const { out } = runIndex(dir);
  const map = renderMap(dir, out, 150);
  assert.ok(map.length <= 150 * 4 + 200, `map too large for budget: ${map.length} chars`);
  assert.ok(/omitted/.test(map), 'omission footer missing when budget truncates');
});

test('--files patches a single file record without touching others', () => {
  const dir = makeProject();
  const first = runIndex(dir);
  const beforeUsers = fileRecord(first.graph, 'api/users.py');
  fs.appendFileSync(
    path.join(dir, 'db', 'session.py'),
    '\n\ndef purge_sessions():\n    return 0\n'
  );
  const second = runIndex(dir, ['--files', 'db/session.py']);
  const session = fileRecord(second.graph, 'db/session.py');
  assert.ok(session.symbols.some((s) => s.name === 'purge_sessions'), 'patched symbol missing');
  const node = second.graph.nodes.find((n) => n.id === 'py:db/session.py');
  assert.ok(node.symbols.includes('purge_sessions'));
  const afterUsers = fileRecord(second.graph, 'api/users.py');
  assert.strictEqual(afterUsers.hash, beforeUsers.hash, 'untouched records must be preserved');
  assert.ok(second.graph.meta.generated_at, 'meta must be restamped');
});
