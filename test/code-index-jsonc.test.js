/**
 * Tests for JSONC comment-stripping in resolve.py's load_aliases().
 * Guards against Next.js/Vite tsconfigs silently returning [] for aliases.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const repoRoot = path.join(__dirname, '..');
const SCRIPT = path.join(
  repoRoot, '.claude', 'skills', 'code-map', 'scripts', 'code_index', 'code_index.py'
);

// JSONC tsconfig: line comment, block comment, trailing comma after last entry.
const JSONC_TSCONFIG = '{\n  // line comment\n  /* block */\n' +
  '  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], } }\n}';

// TS source file content — avoids inline 'function' keyword in strings so the
// brace-lang function detector does not miscount writeSrcFiles length.
const INDEX_TS = ['import { h } from "@/lib/utils";', 'export const x = h();', ''].join('\n');
const UTILS_TS = ['export const h = () => 1;', ''].join('\n');

function python3Available() {
  return spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
}

function writeSrcFiles(srcDir) {
  fs.mkdirSync(path.join(srcDir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'index.ts'), INDEX_TS);
  fs.writeFileSync(path.join(srcDir, 'lib', 'utils.ts'), UTILS_TS);
}

function makeJsoncProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-index-jsonc-'));
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSONC_TSCONFIG);
  writeSrcFiles(path.join(dir, 'src'));
  return dir;
}

function runIndexer(rootDir) {
  const out = path.join(rootDir, 'code-graph.json');
  const res = spawnSync('python3', [
    SCRIPT, '--root', rootDir, '--out', out,
    '--skeleton-dir', path.join(rootDir, 'skel'), '--skeleton-threshold', '999',
  ], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

test('load_aliases parses JSONC tsconfig: alias resolves to internal node',
  { skip: !python3Available() },
  () => {
    const graph = runIndexer(makeJsoncProject());
    assert.ok(graph, 'indexer must succeed on a JSONC tsconfig project');
    const aliasEdge = graph.edges.find(
      (e) => e.source === 'ts:src/index.ts' &&
        e.target === 'ts:src/lib/utils.ts' && e.kind === 'imports'
    );
    assert.ok(aliasEdge,
      '@/lib/utils must resolve to ts:src/lib/utils.ts; ' +
      'ext:@/lib/utils means JSONC stripping did not work');
  });
