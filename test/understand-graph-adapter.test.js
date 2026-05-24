const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const repoRoot = path.join(__dirname, '..');
const script = path.join(repoRoot, '.claude', 'skills', 'code-map', 'scripts', 'import_understand_graph.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'understand-adapter-'));
}

test('imports Understand-Anything knowledge graph into harness code-graph schema', () => {
  const dir = tmpDir();
  const input = path.join(dir, 'knowledge-graph.json');
  const out = path.join(dir, 'specs', 'brownfield', 'code-graph.json');

  fs.writeFileSync(input, JSON.stringify({
    version: '2.7.4',
    project: { name: 'demo', root: dir, languages: ['typescript'] },
    nodes: [
      {
        id: 'file:src/routes/auth.ts',
        type: 'file',
        name: 'auth.ts',
        filePath: 'src/routes/auth.ts',
        summary: 'HTTP auth routes',
        tags: ['api'],
        complexity: 'moderate',
      },
      {
        id: 'class:src/services/UserService.ts:UserService',
        type: 'class',
        name: 'UserService',
        filePath: 'src/services/UserService.ts',
        lineRange: [1, 80],
        summary: 'User operations',
        tags: ['service'],
        complexity: 'moderate',
      },
      {
        id: 'func:src/services/UserService.ts:createUser',
        type: 'function',
        name: 'createUser',
        filePath: 'src/services/UserService.ts',
        lineRange: [20, 45],
        summary: 'Creates a user',
        tags: ['service'],
        complexity: 'simple',
      },
      {
        id: 'file:src/db.ts',
        type: 'file',
        name: 'db.ts',
        filePath: 'src/db.ts',
        summary: 'Database client',
        tags: ['data'],
        complexity: 'simple',
      },
    ],
    edges: [
      {
        source: 'file:src/routes/auth.ts',
        target: 'class:src/services/UserService.ts:UserService',
        type: 'imports',
        description: 'Route imports service',
      },
      {
        source: 'file:src/routes/auth.ts',
        target: 'func:src/services/UserService.ts:createUser',
        type: 'calls',
        description: 'Route calls createUser',
      },
      {
        source: 'class:src/services/UserService.ts:UserService',
        target: 'file:src/db.ts',
        type: 'depends_on',
        description: 'Service uses database',
      },
      {
        source: 'file:src/routes/auth.ts',
        target: 'ext:express',
        type: 'imports',
        description: 'Express route',
      },
    ],
    layers: [],
    tour: [],
  }, null, 2));

  const result = spawnSync(process.execPath, [script, '--in', input, '--out', out], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const graph = JSON.parse(fs.readFileSync(out, 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.meta.json'), 'utf8'));

  assert.equal(graph.meta.producer, 'understand-anything');
  assert.equal(meta.producer, 'understand-anything');
  assert.deepEqual(graph.meta.understand_anything.version, '2.7.4');
  assert.deepEqual(graph.meta.languages, { typescript: 3 });

  const nodeByPath = new Map(graph.nodes.map((n) => [n.path, n]));
  assert.deepEqual(nodeByPath.get('src/services/UserService.ts').symbols, ['UserService', 'createUser']);

  assert.ok(graph.edges.some((e) =>
    e.source.endsWith('src/routes/auth.ts') &&
    e.target.endsWith('src/services/UserService.ts') &&
    e.kind === 'calls' &&
    e.evidence.includes('Route calls createUser')
  ));
  assert.ok(graph.edges.some((e) => e.target === 'ext:express'));
  assert.equal(graph.metrics.files, 3);
  assert.equal(graph.metrics.edges, 3);
  assert.equal(graph.metrics.external_imports, 1);
});
