'use strict';

// Java/C#/Go AST indexing via tree-sitter wheels — symbol records with line
// ranges plus package-aware import resolution (fq types for Java, namespaces
// for C#, module-relative package dirs for Go). Skips when wheels are absent.

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
const fixture = path.join(__dirname, 'fixtures', 'code-index', 'enterprise');

const probe = spawnSync('python3', ['-c', 'import tree_sitter_java, tree_sitter_c_sharp, tree_sitter_go'], { encoding: 'utf8' });
const WHEELS = probe.status === 0;
const skipNote = 'tree-sitter-java/c-sharp/go wheels not installed';

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-index-ent-'));
  fs.cpSync(fixture, dir, { recursive: true });
  return dir;
}

function runIndex(rootDir, extraArgs = []) {
  const out = path.join(rootDir, 'specs', 'brownfield', 'code-graph.json');
  const res = spawnSync('python3', [script, '--root', rootDir, '--out', out, ...extraArgs], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  return { graph: JSON.parse(fs.readFileSync(out, 'utf8')), out };
}

function fileRecord(graph, relPath) {
  const rec = graph.files.find((f) => f.path === relPath);
  assert.ok(rec, `missing files record for ${relPath}`);
  return rec;
}

function edge(graph, source, target) {
  return graph.edges.find((e) => e.source === source && e.target === target);
}

test('indexes Java/C#/Go files as language-prefixed nodes', { skip: !WHEELS && skipNote }, () => {
  const { graph } = runIndex(makeProject());
  const ids = graph.nodes.map((n) => n.id);
  assert.ok(ids.includes('java:src/main/java/com/acme/App.java'), ids.join(','));
  assert.ok(ids.includes('cs:web/App.cs'), ids.join(','));
  assert.ok(ids.includes('go:main.go'), ids.join(','));
  assert.strictEqual(graph.meta.languages.java, 2);
  assert.strictEqual(graph.meta.languages.csharp, 2);
  assert.strictEqual(graph.meta.languages.go, 2);
});

test('Java: class symbols with method children and line ranges', { skip: !WHEELS && skipNote }, () => {
  const { graph } = runIndex(makeProject());
  const rec = fileRecord(graph, 'src/main/java/com/acme/App.java');
  assert.strictEqual(rec.package, 'com.acme');
  const app = rec.symbols.find((s) => s.name === 'App');
  assert.ok(app, JSON.stringify(rec.symbols));
  assert.strictEqual(app.kind, 'class');
  assert.ok(app.start >= 1 && app.end > app.start);
  const methods = (app.children || []).map((c) => c.name).sort();
  assert.deepStrictEqual(methods, ['count', 'run']);
});

test('Java: exact-type import resolves to the declaring file', { skip: !WHEELS && skipNote }, () => {
  const { graph } = runIndex(makeProject());
  const e = edge(graph, 'java:src/main/java/com/acme/App.java', 'java:src/main/java/com/acme/util/Helper.java');
  assert.ok(e, JSON.stringify(graph.edges.filter((x) => x.source.startsWith('java:'))));
  assert.strictEqual(e.kind, 'imports');
});

test('C#: using resolves to every file declaring the namespace', { skip: !WHEELS && skipNote }, () => {
  const { graph } = runIndex(makeProject());
  const e = edge(graph, 'cs:web/App.cs', 'cs:core/Service.cs');
  assert.ok(e, JSON.stringify(graph.edges.filter((x) => x.source.startsWith('cs:'))));
  const svc = fileRecord(graph, 'core/Service.cs');
  assert.strictEqual(svc.package, 'Acme.Core');
  const cls = svc.symbols.find((s) => s.name === 'Service');
  assert.ok(cls && cls.kind === 'class');
  assert.deepStrictEqual((cls.children || []).map((c) => c.name), ['Do']);
});

test('Go: module-relative import resolves to the package directory files', { skip: !WHEELS && skipNote }, () => {
  const { graph } = runIndex(makeProject());
  const e = edge(graph, 'go:main.go', 'go:internal/auth/auth.go');
  assert.ok(e, JSON.stringify(graph.edges.filter((x) => x.source.startsWith('go:'))));
  const auth = fileRecord(graph, 'internal/auth/auth.go');
  assert.strictEqual(auth.package, 'auth');
  const names = auth.symbols.map((s) => `${s.kind}:${s.name}`).sort();
  assert.deepStrictEqual(names, ['function:Login', 'method:Valid', 'type:Session']);
  const login = auth.symbols.find((s) => s.name === 'Login');
  assert.ok(login.start >= 1 && login.end >= login.start);
});

test('stdlib and external imports stay ext: edges', { skip: !WHEELS && skipNote }, () => {
  const { graph } = runIndex(makeProject());
  const fmt = edge(graph, 'go:main.go', 'ext:fmt');
  assert.ok(fmt, 'fmt should be an ext edge');
});

test('--files incremental patch re-resolves enterprise-language imports', { skip: !WHEELS && skipNote }, () => {
  const dir = makeProject();
  const { out } = runIndex(dir);
  // Append a method to Service.cs and patch only that file.
  const svcPath = path.join(dir, 'core', 'Service.cs');
  fs.writeFileSync(svcPath, fs.readFileSync(svcPath, 'utf8').replace(
    '    public void Do()\n    {\n    }',
    '    public void Do()\n    {\n    }\n\n    public void Undo()\n    {\n    }'
  ));
  const res = spawnSync('python3', [script, '--root', dir, '--out', out, '--files', 'core/Service.cs'], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const graph = JSON.parse(fs.readFileSync(out, 'utf8'));
  const cls = fileRecord(graph, 'core/Service.cs').symbols.find((s) => s.name === 'Service');
  assert.deepStrictEqual((cls.children || []).map((c) => c.name).sort(), ['Do', 'Undo']);
  // The inbound using-edge from App.cs must survive the patch.
  assert.ok(edge(graph, 'cs:web/App.cs', 'cs:core/Service.cs'), 'inbound cs edge lost by patch');
});

test('a malformed go.mod (bare module line) degrades instead of aborting the run', { skip: !WHEELS && skipNote }, () => {
  const dir = makeProject();
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module\n');
  const { graph } = runIndex(dir); // must not crash
  assert.ok(edge(graph, 'go:main.go', 'ext:example.com/acme/internal/auth'), 'unresolvable import becomes ext:');
});
