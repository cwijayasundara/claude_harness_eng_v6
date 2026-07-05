'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const LIB = path.join(__dirname, '..', '.claude', 'hooks', 'lib', 'naming-clusters.js');
const { stripRoleSuffix, isCandidateRoot, clusterNamingEvidence, renderCandidates } = require(LIB);

test('stripRoleSuffix removes known technical-role suffixes', () => {
  assert.strictEqual(stripRoleSuffix('AccountController'), 'Account');
  assert.strictEqual(stripRoleSuffix('AccountRepository'), 'Account');
  assert.strictEqual(stripRoleSuffix('AccountService'), 'Account');
  assert.strictEqual(stripRoleSuffix('verify_token'), 'verify_token');
});

test('isCandidateRoot requires a PascalCase-looking root of length > 1', () => {
  assert.strictEqual(isCandidateRoot('Account'), true);
  assert.strictEqual(isCandidateRoot('verify_token'), false);
  assert.strictEqual(isCandidateRoot('A'), false);
  assert.strictEqual(isCandidateRoot(''), false);
});

test('clusterNamingEvidence groups symbols by stripped root noun and sorts by count desc', () => {
  const graph = {
    nodes: [
      { id: 'py:a.py', path: 'a.py', symbols: ['AccountController', 'verify_token'] },
      { id: 'py:b.py', path: 'b.py', symbols: ['AccountRepository', 'AccountService'] },
      { id: 'py:c.py', path: 'c.py', symbols: ['UserService'] },
    ],
  };
  const clusters = clusterNamingEvidence(graph, { minCount: 2 });
  assert.deepStrictEqual(clusters.map((c) => c.term), ['Account']);
  assert.strictEqual(clusters[0].count, 3);
  assert.strictEqual(clusters[0].evidence.length, 3);
});

test('clusterNamingEvidence excludes clusters below minCount', () => {
  const graph = { nodes: [{ id: 'py:c.py', path: 'c.py', symbols: ['UserService'] }] };
  assert.deepStrictEqual(clusterNamingEvidence(graph, { minCount: 2 }), []);
});

test('clusterNamingEvidence handles an empty or malformed graph', () => {
  assert.deepStrictEqual(clusterNamingEvidence({}), []);
  assert.deepStrictEqual(clusterNamingEvidence({ nodes: [{ path: 'x.py' }] }), []);
});

test('renderCandidates lists each cluster with evidence, or a no-clusters message', () => {
  const rendered = renderCandidates([{ term: 'Account', count: 2, evidence: [{ symbol: 'AccountController', path: 'a.py' }, { symbol: 'AccountService', path: 'b.py' }] }]);
  assert.match(rendered, /Account/);
  assert.match(rendered, /AccountController/);
  assert.strictEqual(renderCandidates([]), 'No recurring domain-term clusters found (each root noun appears in fewer than 2 symbols).');
});

// --- CLI ----------------------------------------------------------------------

test('CLI: writes specs/brownfield/naming-clusters.md from code-graph.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naming-clusters-'));
  fs.mkdirSync(path.join(dir, 'specs', 'brownfield'), { recursive: true });
  const graph = { nodes: [
    { id: 'py:a.py', path: 'a.py', symbols: ['AccountController', 'AccountService'] },
  ] };
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), JSON.stringify(graph));
  const script = path.join(__dirname, '..', '.claude', 'scripts', 'naming-clusters.js');
  execFileSync(process.execPath, [script], { cwd: dir });
  const out = fs.readFileSync(path.join(dir, 'specs', 'brownfield', 'naming-clusters.md'), 'utf8');
  assert.match(out, /Account/);
});

test('CLI: exits 2 when no code-graph.json exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naming-clusters-'));
  const script = path.join(__dirname, '..', '.claude', 'scripts', 'naming-clusters.js');
  let code = 0;
  try {
    execFileSync(process.execPath, [script], { cwd: dir, stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.strictEqual(code, 2);
});
