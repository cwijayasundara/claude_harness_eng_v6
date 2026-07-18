'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const GRAPH_SCRIPT = pathToFileURL(path.join(ROOT, 'open_wiki', 'scripts', 'generate-context-graph.mjs')).href;

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'openwiki-context-graph-'));
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test('context graph includes linked wiki concepts and verified repository sources', async () => {
  const repositoryRoot = tempDirectory();
  const bundleRoot = path.join(repositoryRoot, 'open_wiki', 'wiki');
  write(repositoryRoot, 'README.md', '# Repository\n');
  write(repositoryRoot, 'src/engine.js', 'export const engine = true;\n');
  write(bundleRoot, 'index.md', '# Index\n');
  write(bundleRoot, 'quickstart.md', `---
type: Guide
title: Quickstart
description: Start here.
resource: README.md
tags: [entry, runtime]
---
# Quickstart
Read [the engine](architecture/engine.md), then inspect \`src/engine.js\`.
`);
  write(bundleRoot, 'architecture/engine.md', `---
type: Architecture
title: Engine
description: Runtime engine.
tags: [runtime]
---
# Engine
Return to [Quickstart](../quickstart.md). Do not create \`missing/file.js\`.
`);

  const { generateContextGraph } = await import(GRAPH_SCRIPT);
  const outPath = path.join(bundleRoot, 'context-graph.html');
  const result = await generateContextGraph({ bundleRoot, repositoryRoot, outPath, name: 'Fixture graph' });
  const html = fs.readFileSync(outPath, 'utf8');

  assert.deepStrictEqual(result, { documents: 2, sources: 2, relationships: 4, outPath });
  assert.match(html, /Fixture graph — context graph/);
  assert.match(html, /"id":"quickstart"/);
  assert.match(html, /"id":"architecture\/engine"/);
  assert.match(html, /"id":"source:README\.md"/);
  assert.match(html, /"id":"source:src\/engine\.js"/);
  assert.doesNotMatch(html, /missing\/file\.js/);
  assert.match(html, /"relationship":"links to"/);
  assert.match(html, /"relationship":"references"/);
});
