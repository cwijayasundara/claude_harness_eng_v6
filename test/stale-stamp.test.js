'use strict';

// graph-refresh.js patches code-graph.json + symbol-map.md incrementally, but
// dependency-graph.md and coupling-report.md are only rebuilt by a full
// /code-map run. Without a visible stamp they silently lie to the next
// planning step; stampDerived marks them STALE the moment the graph moves on.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { stampDerived, STALE_MARK } = require(
  path.join(__dirname, '..', '.claude', 'hooks', 'lib', 'stale-stamp')
);

function makeProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-stamp-'));
  const bf = path.join(dir, 'specs', 'brownfield');
  fs.mkdirSync(bf, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(bf, name), content);
  }
  return dir;
}

test('stamps both derived artifacts with a STALE banner', () => {
  const dir = makeProject({
    'dependency-graph.md': '# Dependency Graph\n\ngraph TD\n',
    'coupling-report.md': '# Coupling Report\n\n| file | fan-in |\n',
  });
  stampDerived(dir, ['src/a.js', 'src/b.js']);
  for (const name of ['dependency-graph.md', 'coupling-report.md']) {
    const content = fs.readFileSync(path.join(dir, 'specs', 'brownfield', name), 'utf8');
    assert.ok(content.startsWith(STALE_MARK), `${name} not stamped: ${content.slice(0, 80)}`);
    assert.ok(content.includes('2 file(s)'), content.split('\n')[0]);
    assert.ok(content.includes('# '), 'original content lost');
  }
});

test('re-stamping replaces the banner instead of stacking banners', () => {
  const dir = makeProject({ 'dependency-graph.md': '# Dependency Graph\noriginal body\n' });
  stampDerived(dir, ['src/a.js']);
  stampDerived(dir, ['src/a.js', 'src/b.js', 'src/c.js']);
  const content = fs.readFileSync(path.join(dir, 'specs', 'brownfield', 'dependency-graph.md'), 'utf8');
  const banners = content.split('\n').filter((l) => l.startsWith(STALE_MARK));
  assert.strictEqual(banners.length, 1, content);
  assert.ok(banners[0].includes('3 file(s)'), banners[0]);
  assert.ok(content.includes('original body'), content);
});

test('missing artifacts are skipped without error', () => {
  const dir = makeProject({});
  assert.doesNotThrow(() => stampDerived(dir, ['src/a.js']));
});
