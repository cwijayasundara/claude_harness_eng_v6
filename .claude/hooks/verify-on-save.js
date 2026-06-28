#!/usr/bin/env node

'use strict';

// PostToolUse(Write|Edit|MultiEdit) — post-save verification.
// The only legitimately post-write work: queue the file for end-of-turn review
// (consumed by review-on-stop.js, silently — no per-write chatter), then run
// the layer check and the project toolchain (lint + typecheck) on the saved
// file. Tools run WITHOUT --fix so files are never mutated behind the model's
// back, and `npx --no-install` so an unprovisioned project skips instead of
// downloading. TypeScript typechecking is deferred to the commit gate — there
// is no reliable per-file tsc invocation.

const fs = require('fs');
const path = require('path');
const { TRACKED_EXTS, resolveProjectDir, readHookInput, reportFailure } = require('./lib/common');
const { isTestFile } = require('./lib/tdd');
const { checkContentViolations, loadLayerConfig } = require('./lib/layers');
const { checkContextContent, loadContextConfig } = require('./lib/contexts');
const { run, output, shouldBlock, detectCwd } = require('./lib/toolchain');
const { enrich } = require('./lib/sensor-guidance');

const QUEUE_SKIP_DIRS = new Set([
  'migrations', 'fixtures', 'node_modules', 'dist', 'build',
  '.next', '.venv', 'venv', '.claude',
]);

// Extensions the AST indexer covers — edits to these mark the code graph dirty
// so the Stop/SubagentStop graph-refresh hook can patch it incrementally.
const INDEX_EXTS = new Set(['.py', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);

function block(message) {
  process.stdout.write(message);
  process.stderr.write(message);
  process.exit(2);
}

function inSkippedDir(n) {
  return n.split('/').some((p) => QUEUE_SKIP_DIRS.has(p));
}

function queueForReview(projectDir, filePath, n, ext) {
  if (!TRACKED_EXTS.has(ext)) return;
  if (isTestFile(n)) return;
  if (inSkippedDir(n)) return;
  const stateDir = path.join(projectDir, '.claude', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.appendFileSync(
    path.join(stateDir, 'pending-reviews.jsonl'),
    JSON.stringify({ file: filePath, ts: Date.now() }) + '\n'
  );
}

function markGraphDirty(projectDir, filePath, n, ext) {
  if (!INDEX_EXTS.has(ext) || inSkippedDir(n)) return;
  const graph = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  if (!fs.existsSync(graph)) return;
  const rel = path.relative(projectDir, path.resolve(filePath)).split(path.sep).join('/');
  if (rel.startsWith('..')) return;
  const stateDir = path.join(projectDir, '.claude', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.appendFileSync(
    path.join(stateDir, 'graph-dirty.jsonl'),
    JSON.stringify({ file: rel, ts: Date.now() }) + '\n'
  );
}

const LAYER_EXTS = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function checkLayers(projectDir, filePath, n, ext) {
  if (!LAYER_EXTS.has(ext)) return;
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return;
  }
  const violations = checkContentViolations(n, content, loadLayerConfig(projectDir));
  if (violations.length > 0) {
    const lines = violations.map((v) =>
      `BLOCKED: Architecture violation in ${filePath}:${v.line} — ${v.layer} cannot import from ${v.imported}`
    );
    block(lines.join('\n') + '\nFix: Move the import to the correct layer, or extract the shared type to src/types/.\n');
  }
  // Vertical bounded-context rules (gap G8) — opt-in; a no-op unless the project
  // declares architecture.contexts. Runs after the layer check (which exits on a
  // violation), so layer issues surface first.
  const ctxViolations = checkContextContent(n, content, loadContextConfig(projectDir));
  if (ctxViolations.length === 0) return;
  const ctxLines = ctxViolations.map((v) =>
    `BLOCKED: Bounded-context violation in ${filePath}:${v.line} — "${v.from}" reaches into "${v.to}" internals (${v.importPath})`
  );
  block(ctxLines.join('\n') + '\nFix: import the other context only through its public surface (root/index), or add the edge to architecture.contexts.allow in project-manifest.json.\n');
}

function readManifest(projectDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, 'project-manifest.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

// Python tools get 12s each so ruff + mypy together stay inside the 30s hook
// timeout (settings.json). A tool killed at the cap fails open via shouldBlock.
function checkToolchain(projectDir, filePath, ext) {
  const manifest = readManifest(projectDir);
  const cwd = detectCwd(filePath, projectDir);
  if (ext === '.py') {
    const linter = (manifest && manifest.linter) || 'ruff';
    if (linter === 'ruff') {
      const res = run(['uv', 'run', 'ruff', 'check', filePath], cwd, 12000);
      if (shouldBlock(res)) {
        block(`BLOCKED: lint errors in ${filePath}:\n${output(res)}\nFix: resolve the lint errors above.${enrich(output(res))}\n`);
      }
    }
    const typechecker = (manifest && manifest.typechecker) || 'mypy';
    if (typechecker === 'mypy') {
      const res = run(['uv', 'run', 'mypy', filePath], cwd, 12000);
      if (shouldBlock(res)) {
        block(`BLOCKED: type errors in ${filePath}:\n${output(res)}\nFix: Add type annotations or fix the type mismatch shown above.${enrich(output(res))}\n`);
      }
    }
  } else if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
    const linter = (manifest && manifest.linter) || 'eslint';
    if (linter === 'eslint') {
      const res = run(['npx', '--no-install', 'eslint', filePath], cwd, 25000);
      if (shouldBlock(res)) {
        block(`BLOCKED: lint errors in ${filePath}:\n${output(res)}\nFix: resolve the lint errors above.${enrich(output(res))}\n`);
      }
    }
    // tsc is project-scoped — handled once per commit by the pre-commit gate.
  }
}

try {
  const input = readHookInput();
  const filePath = (input.tool_input && input.tool_input.file_path) || '';
  if (!filePath) process.exit(0);

  const projectDir = resolveProjectDir(path.dirname(path.resolve(__filename)));
  const n = filePath.replace(/\\/g, '/');
  const ext = path.extname(n).toLowerCase();

  queueForReview(projectDir, filePath, n, ext);
  markGraphDirty(projectDir, filePath, n, ext);
  if (!inSkippedDir(n)) {
    checkLayers(projectDir, filePath, n, ext);
    checkToolchain(projectDir, filePath, ext);
  }
} catch (err) {
  reportFailure('verify-on-save', err);
}

process.exit(0);
