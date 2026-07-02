const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');
const { REPO_ROOT, makeHookProject, runHook } = require('./helpers/hook-fixture');

const SCRIPTS_REL = path.join('.claude', 'skills', 'code-map', 'scripts');
const INDEXER_REL = path.join(SCRIPTS_REL, 'code_index');
const WIKI_DIR_REL = path.join(SCRIPTS_REL, 'code_wiki');
const WIKI_CLI_REL = path.join(SCRIPTS_REL, 'code_wiki.js');
const fixture = path.join(__dirname, 'fixtures', 'code-index', 'sample');

function graphPath(projectDir) {
  return path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
}

function dirtyPath(projectDir) {
  return path.join(projectDir, '.claude', 'state', 'graph-dirty.jsonl');
}

function makeIndexedProject(hookNames) {
  const dir = makeHookProject(hookNames);
  fs.cpSync(fixture, dir, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, INDEXER_REL), path.join(dir, INDEXER_REL), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, WIKI_DIR_REL), path.join(dir, WIKI_DIR_REL), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, WIKI_CLI_REL), path.join(dir, WIKI_CLI_REL));
  fs.mkdirSync(path.join(dir, '.claude', 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, '.claude', 'scripts', 'navigation-refresh.js'),
    path.join(dir, '.claude', 'scripts', 'navigation-refresh.js')
  );
  const res = spawnSync('python3', [
    path.join(dir, INDEXER_REL, 'code_index.py'),
    '--root', dir, '--out', graphPath(dir),
    '--skeleton-dir', path.join(dir, 'specs', 'brownfield', 'skeletons'),
  ], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  return dir;
}

test('verify-on-save marks edited source files dirty when a graph exists', async () => {
  const dir = makeIndexedProject(['verify-on-save.js']);
  const target = path.join(dir, 'db', 'session.py');
  const result = await runHook(dir, 'verify-on-save.js', {
    tool_name: 'Edit',
    tool_input: { file_path: target },
  });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const entries = fs.readFileSync(dirtyPath(dir), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(entries.some((e) => e.file === 'db/session.py'), JSON.stringify(entries));
});

test('verify-on-save does not mark dirty when no graph has been built', async () => {
  const dir = makeHookProject(['verify-on-save.js']);
  const target = path.join(dir, 'src', 'svc.py');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'x: int = 1\n');
  const result = await runHook(dir, 'verify-on-save.js', {
    tool_name: 'Write',
    tool_input: { file_path: target },
  });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(!fs.existsSync(dirtyPath(dir)), 'no dirty list without a graph');
});

test('graph-refresh drains the dirty list, patches the graph, and re-renders the map', async () => {
  const dir = makeIndexedProject(['graph-refresh.js']);
  fs.appendFileSync(
    path.join(dir, 'db', 'session.py'),
    '\n\ndef purge_sessions():\n    return 0\n'
  );
  fs.writeFileSync(dirtyPath(dir), JSON.stringify({ file: 'db/session.py', ts: 1 }) + '\n');
  const result = await runHook(dir, 'graph-refresh.js', { hook_event_name: 'Stop' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const graph = JSON.parse(fs.readFileSync(graphPath(dir), 'utf8'));
  const rec = graph.files.find((f) => f.path === 'db/session.py');
  assert.ok(rec.symbols.some((s) => s.name === 'purge_sessions'), 'graph not patched');
  assert.strictEqual(fs.readFileSync(dirtyPath(dir), 'utf8'), '', 'dirty list not drained');
  const map = fs.readFileSync(
    path.join(dir, 'specs', 'brownfield', 'symbol-map.md'), 'utf8'
  );
  assert.ok(map.includes('purge_sessions'), 'symbol map not re-rendered');
  // The hook also re-renders the deterministic wiki off the patched graph.
  const wiki = fs.readFileSync(
    path.join(dir, 'specs', 'brownfield', 'wiki', 'WIKI.md'), 'utf8'
  );
  assert.ok(wiki.includes('Codebase Wiki'), 'wiki not re-rendered by the hook');
});

test('graph-refresh bootstraps a placeholder graph after first greenfield source write', async () => {
  const dir = makeHookProject(['graph-refresh.js']);
  fs.cpSync(path.join(REPO_ROOT, INDEXER_REL), path.join(dir, INDEXER_REL), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, WIKI_DIR_REL), path.join(dir, WIKI_DIR_REL), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, WIKI_CLI_REL), path.join(dir, WIKI_CLI_REL));
  fs.mkdirSync(path.join(dir, '.claude', 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, '.claude', 'scripts', 'navigation-refresh.js'),
    path.join(dir, '.claude', 'scripts', 'navigation-refresh.js')
  );
  fs.mkdirSync(path.join(dir, 'specs', 'brownfield', 'wiki'), { recursive: true });
  fs.writeFileSync(graphPath(dir), JSON.stringify({
    nodes: [], edges: [], files: [], metrics: {}, meta: { producer: 'none', status: 'empty' },
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.meta.json'), JSON.stringify({
    producer: 'none', status: 'empty',
  }, null, 2));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'first.py'), 'def first():\n    return 1\n');
  fs.writeFileSync(dirtyPath(dir), JSON.stringify({ file: 'src/first.py', ts: 1 }) + '\n');

  const result = await runHook(dir, 'graph-refresh.js', { hook_event_name: 'Stop' });

  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const graph = JSON.parse(fs.readFileSync(graphPath(dir), 'utf8'));
  assert.ok(graph.files.some((f) => f.path === 'src/first.py'), 'placeholder graph not bootstrapped');
  assert.strictEqual(fs.readFileSync(dirtyPath(dir), 'utf8'), '', 'dirty list not drained');
  assert.match(
    fs.readFileSync(path.join(dir, 'specs', 'brownfield', 'wiki', 'WIKI.md'), 'utf8'),
    /Codebase Wiki/
  );
});

test('graph-refresh is a silent no-op when there is nothing dirty', async () => {
  const dir = makeHookProject(['graph-refresh.js']);
  const result = await runHook(dir, 'graph-refresh.js', { hook_event_name: 'Stop' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.strictEqual(result.stdout, '', 'no chatter when idle');
});
