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
const { resolveProjectDir, readHookInput, reportFailure } = require('./lib/common');
const { checkContentViolations, loadLayerConfig } = require('./lib/layers');
const { checkContextContent, loadContextConfig } = require('./lib/contexts');
const { output, shouldBlock, detectCwd, localBinArgv, runLocalFirst } = require('./lib/toolchain');
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

// Project-local tool locations, preferred over the uv-run/npx wrappers.
const PY_BIN = path.join('.venv', 'bin');
const NODE_BIN = path.join('node_modules', '.bin');
const JS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

// verify-on-save is fast per-save feedback, not the enforcing checkpoint — the
// commit gate re-runs lint/type. Projects that want saves non-blocking set
// quality.verify_on_save = "advisory" (or HARNESS_VERIFY_ADVISORY=1); default
// stays blocking. Architecture (layer/context) checks are never downgraded.
function resolveAdvisory(manifest, env) {
  if (/^(1|true|on)$/i.test(env.HARNESS_VERIFY_ADVISORY || '')) return true;
  return !!(manifest && manifest.quality
    && String(manifest.quality.verify_on_save).toLowerCase() === 'advisory');
}

// In blocking mode a genuine tool failure stops the write (exit 2); in advisory
// mode it is surfaced on stderr only so the save stays fast.
function emit(kind, filePath, res, advisory, fix) {
  const body = `${kind} in ${filePath}:\n${output(res)}\n${fix}${enrich(output(res))}\n`;
  if (advisory) { process.stderr.write(`verify-on-save (advisory): ${body}`); return; }
  block(`BLOCKED: ${body}`);
}

// The .venv/bin binary matches `uv run` only for uv's DEFAULT environment; when
// UV_PROJECT_ENVIRONMENT points elsewhere the on-disk .venv can be a different
// version, so defer to the wrapper (return null → fall back) in that case.
function pyLocal(cwd, tool, args) {
  if (process.env.UV_PROJECT_ENVIRONMENT) return null;
  return localBinArgv(cwd, PY_BIN, tool, args);
}

// Python tools get 12s each so ruff + mypy together stay inside the 30s hook
// timeout (settings.json). A tool killed at the cap fails open via shouldBlock.
function checkPython(manifest, cwd, filePath, advisory) {
  if (((manifest && manifest.linter) || 'ruff') === 'ruff') {
    const res = runLocalFirst(pyLocal(cwd, 'ruff', ['check', filePath]),
      ['uv', 'run', 'ruff', 'check', filePath], cwd, 12000);
    if (shouldBlock(res)) emit('lint errors', filePath, res, advisory, 'Fix: resolve the lint errors above.');
  }
  if (((manifest && manifest.typechecker) || 'mypy') === 'mypy') {
    const res = runLocalFirst(pyLocal(cwd, 'mypy', [filePath]),
      ['uv', 'run', 'mypy', filePath], cwd, 12000);
    if (shouldBlock(res)) emit('type errors', filePath, res, advisory, 'Fix: Add type annotations or fix the type mismatch shown above.');
  }
}

function checkJs(manifest, cwd, filePath, advisory) {
  if (((manifest && manifest.linter) || 'eslint') !== 'eslint') return;
  const res = runLocalFirst(localBinArgv(cwd, NODE_BIN, 'eslint', [filePath]),
    ['npx', '--no-install', 'eslint', filePath], cwd, 25000);
  if (shouldBlock(res)) emit('lint errors', filePath, res, advisory, 'Fix: resolve the lint errors above.');
  // tsc is project-scoped — handled once per commit by the pre-commit gate.
}

function checkToolchain(projectDir, filePath, ext) {
  const manifest = readManifest(projectDir);
  const cwd = detectCwd(filePath, projectDir);
  const advisory = resolveAdvisory(manifest, process.env);
  if (ext === '.py') checkPython(manifest, cwd, filePath, advisory);
  else if (JS_EXTS.has(ext)) checkJs(manifest, cwd, filePath, advisory);
}

function main() {
  try {
    const input = readHookInput();
    const filePath = (input.tool_input && input.tool_input.file_path) || '';
    if (!filePath) process.exit(0);

    const projectDir = resolveProjectDir(path.dirname(path.resolve(__filename)));
    const n = filePath.replace(/\\/g, '/');
    const ext = path.extname(n).toLowerCase();

    markGraphDirty(projectDir, filePath, n, ext);
    if (!inSkippedDir(n)) {
      checkLayers(projectDir, filePath, n, ext);
      checkToolchain(projectDir, filePath, ext);
    }
  } catch (err) {
    reportFailure('verify-on-save', err);
  }
  process.exit(0);
}

// Guard so the hook body runs only when spawned (as Claude Code does), letting
// tests require this module to unit-test its pure helpers without reading stdin.
if (require.main === module) main();

module.exports = { resolveAdvisory };
