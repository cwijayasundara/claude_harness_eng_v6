'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { summarizeSpecs } = require('./specs-summary');

function buildFakeSpecs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specs-summary-'));
  const w = (rel, body) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  // summarizeSpecs only checks presence + parses the dependency graph and story
  // filenames — so fixtures are presence-markers, not populated payloads.
  w('specs/brd/brd.md', '# BRD\n');
  w('specs/brd/brd-requirements.json', '[]');
  w('specs/stories/dependency-graph.md', [
    '## Group A', '| E1-S1 |', '## Group B', '| E2-S1 |',
    '```mermaid', 'flowchart TD', '  E1S1[E1-S1]', '  E2S1[E2-S1]', '  E1S1 --> E2S1', '```',
  ].join('\n'));
  w('specs/stories/E1-S1.md', '# E1-S1\n');
  w('specs/stories/E1-S2.md', '# E1-S2\n');
  w('specs/stories/E2-S1.md', '# E2-S1\n');
  w('specs/design/component-map.md', '# components\n');
  w('specs/design/api-contracts.md', '# api\n');
  w('specs/test_artefacts/test-plan.md', '# test plan\n');
  return dir;
}

test('summarizeSpecs counts clusters, dependency edges, and stories', () => {
  const dir = buildFakeSpecs();
  const s = summarizeSpecs(dir);
  assert.strictEqual(s.clusters, 2, 'two Groups');
  assert.ok(s.edges >= 1, 'at least one --> edge');
  assert.strictEqual(s.stories, 3, 'three E*-S* story files');
});

test('summarizeSpecs reports which expected artifacts are present and missing', () => {
  const dir = buildFakeSpecs();
  const s = summarizeSpecs(dir);
  assert.strictEqual(s.present.brd, true);
  assert.strictEqual(s.present.dependencyGraph, true);
  assert.strictEqual(s.present.apiContracts, true);
  assert.strictEqual(s.present.testPlan, true);
  assert.deepStrictEqual(s.missing, []);
});

test('summarizeSpecs degrades gracefully on an empty project (everything missing)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specs-empty-'));
  const s = summarizeSpecs(dir);
  assert.strictEqual(s.clusters, 0);
  assert.strictEqual(s.stories, 0);
  assert.ok(s.missing.length >= 1, 'missing list is populated, not a throw');
});
