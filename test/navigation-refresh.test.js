'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { refreshNavigation, estimateTextTokens } = require('../.claude/scripts/navigation-refresh');

const ROOT = path.join(__dirname, '..');
const CODE_MAP_SOURCE = path.join(ROOT, '.claude', 'skills', 'code-map');

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navigation-refresh-'));
  fs.mkdirSync(path.join(dir, '.claude', 'skills'), { recursive: true });
  fs.cpSync(CODE_MAP_SOURCE, path.join(dir, '.claude', 'skills', 'code-map'), { recursive: true });
  return dir;
}

test('refreshNavigation writes placeholder graph and wiki for empty greenfield repos', () => {
  const dir = tempProject();
  try {
    const status = refreshNavigation({ projectDir: dir, mode: 'scaffold' });

    assert.strictEqual(status.status, 'placeholder');
    assert.strictEqual(status.graph, 'placeholder');
    assert.strictEqual(status.wiki, 'placeholder');
    assert.strictEqual(status.source_files, 0);
    assert.ok(fs.existsSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json')));
    assert.ok(fs.existsSync(path.join(dir, 'specs', 'brownfield', 'wiki', 'WIKI.md')));
    assert.match(
      fs.readFileSync(path.join(dir, 'specs', 'brownfield', 'wiki', 'WIKI.md'), 'utf8'),
      /will update automatically as source files are created/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('refreshNavigation builds graph, symbol map, and wiki for source-bearing repos', () => {
  const dir = tempProject();
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'math.py'),
      Array.from({ length: 80 }, (_, i) =>
        `def add_${i}(a: int, b: int) -> int:\n    """Add two integers for route ${i}."""\n    return a + b\n`
      ).join('\n'));

    const status = refreshNavigation({ projectDir: dir, mode: 'scaffold' });

    assert.strictEqual(status.status, 'fresh');
    assert.strictEqual(status.mode, 'bootstrap');
    assert.ok(status.source_files >= 1, JSON.stringify(status));
    assert.ok(status.indexed_files >= 1, JSON.stringify(status));
    assert.ok(status.estimated_source_tokens > 0, JSON.stringify(status));
    assert.ok(status.estimated_context_query_tokens < status.estimated_source_tokens, JSON.stringify(status));
    assert.ok(status.estimated_tokens_saved_per_orientation > 0, JSON.stringify(status));

    const graph = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), 'utf8'));
    assert.ok(graph.files.some((file) => file.path === 'src/math.py'));
    assert.match(fs.readFileSync(path.join(dir, 'specs', 'brownfield', 'symbol-map.md'), 'utf8'), /add_0/);
    assert.match(fs.readFileSync(path.join(dir, 'specs', 'brownfield', 'wiki', 'WIKI.md'), 'utf8'), /Codebase Wiki/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('estimateTextTokens is deterministic and cheap for token-saving telemetry', () => {
  assert.strictEqual(estimateTextTokens(''), 0);
  assert.strictEqual(estimateTextTokens('one two three four'), 5);
  assert.ok(estimateTextTokens('x'.repeat(400)) >= 100);
});
