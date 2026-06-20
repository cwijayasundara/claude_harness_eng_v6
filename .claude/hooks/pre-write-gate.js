#!/usr/bin/env node

'use strict';

// PreToolUse(Write|Edit|MultiEdit) — the single pre-write gate.
// Consolidates scope, env protection, secret scan, custom security patterns,
// file/function length, and the TDD test-first check into one process. Every
// check runs BEFORE anything lands on disk; the first failure blocks (exit 2).
// Secret/pattern scans see only the content this tool call introduces, so
// pre-existing on-disk strings can never block an unrelated edit.
// Escape hatches: HARNESS_TDD_GATE=off, HARNESS_PATTERN_BLOCK=off.

const path = require('path');
const { TRACKED_EXTS, resolveProjectDir, readHookInput, isSkippedPath, countLines, realResolve, reportFailure, isWriteInScope } =
  require('./lib/common');
const { finalContent, insertedContent } = require('./lib/simulate');
const { scanSecrets, secretScanExempt, isProtectedEnvFile } = require('./lib/secrets');
const { blockingHits } = require('./lib/security-patterns');
const { FILE_HARD_LIMIT, FUNC_HARD_LIMIT, oversizedFunctions } = require('./lib/length');
const { missingTest } = require('./lib/tdd');
const { isHarnessRepo, machineryViolation } = require('./lib/trust-boundary');
const { coveragePreflight } = require('./lib/coverage-preflight');

function block(message) {
  process.stdout.write(message);
  process.stderr.write(message); // exit-2 feedback channel for Claude Code
  process.exit(2);
}

function checkScope(projectDir, filePath) {
  // Symlinks are resolved on both sides (and on /tmp) inside isWriteInScope —
  // a bare startsWith('/tmp') would treat siblings like /tmpevil as inside and
  // would let /tmp/link -> /etc escape. The same rule guards the Bash gate.
  const resolved = realResolve(filePath);
  if (isWriteInScope(projectDir, resolved)) return;
  block(`BLOCKED: Write outside project directory: ${resolved}\nFix: Move the file to a location within the project directory or use .claude/ for scaffold files.\n`);
}

function checkTrustBoundary(projectDir, filePath) {
  if ((process.env.HARNESS_PROTECT || '').toLowerCase() === 'off') return;
  const rel = machineryViolation(projectDir, filePath);
  if (!rel) return;
  if (isHarnessRepo(projectDir)) return; // harness self-development edits its own hooks
  block(
    `BLOCKED: ${rel} is harness machinery — a quality gate, its wiring, or its state.\n` +
    `Agents may not modify the gates that verify their own work.\n` +
    `Fix: if this change is genuinely intended, a human applies it (HARNESS_PROTECT=off) or it lands in the harness repo and is re-scaffolded.\n`
  );
}

function checkSecrets(filePath, inserted, projectDir) {
  if (secretScanExempt(filePath, projectDir)) return;
  const findings = scanSecrets(inserted);
  if (findings.length === 0) return;
  const lines = [`BLOCKED: Potential secrets detected in ${filePath}:`];
  for (const { label, value } of findings) lines.push(`  - ${label}: ${value}`);
  lines.push('Fix: Move secrets to .env and reference via os.environ.get(). Never hardcode credentials.');
  block(lines.join('\n') + '\n');
}

function checkPatterns(projectDir, file, inserted) {
  if ((process.env.HARNESS_PATTERN_BLOCK || '').toLowerCase() === 'off') return;
  let hits;
  try {
    hits = blockingHits(projectDir, file, inserted);
  } catch (e) {
    // Fail open: a malformed pattern file must not block all edits.
    process.stdout.write(`[pre-write-gate] could not parse security-patterns file (${e.message}); pattern blocking disabled. Use security-patterns.json for reliable parsing.\n`);
    return;
  }
  if (hits.length === 0) return;
  const lines = hits.map((r) =>
    `BLOCKED by security-patterns (${r.rule_name || 'rule'}): ${r.reminder || 'matched a blocking security pattern'}\nFix the flagged pattern, or set block:false to downgrade to an advisory warning.`
  );
  block(lines.join('\n') + '\n');
}

function checkLength(toolName, ti, filePath, ext) {
  if (!TRACKED_EXTS.has(ext) || isSkippedPath(filePath)) return;
  const final = finalContent(toolName, ti, filePath);
  if (final === null) return; // the tool call will fail on its own
  const count = countLines(final);
  if (count >= FILE_HARD_LIMIT) {
    block(`BLOCKED: ${toolName} on ${filePath} would produce ${count} lines (hard limit ${FILE_HARD_LIMIT}).\nFix: Split the file into modules by responsibility BEFORE writing. One file, one responsibility (SRP).\n`);
  }
  for (const f of oversizedFunctions(final, ext)) {
    block(`BLOCKED: Function ${f.name} in ${filePath}:${f.startLine + 1} would be ${f.length} lines (limit ${FUNC_HARD_LIMIT}).\nFix: Decompose into named sub-functions. Each should be testable in isolation.\n`);
  }
}

function checkTdd(projectDir, filePath) {
  if ((process.env.HARNESS_TDD_GATE || '').toLowerCase() === 'off') return;
  const missing = missingTest(projectDir, filePath.replace(/\\/g, '/'));
  if (!missing) return;
  const shown = missing.slice(0, 4).map((p) => '  - ' + path.relative(projectDir, p)).join('\n');
  block(
    `BLOCKED: test-first gate — no test found for ${filePath}.\n` +
      `Write the failing test FIRST (TDD red), then implement. Looked for e.g.:\n${shown}\n` +
      `(Enforces test existence; pair with tdd-guard for red-green ordering. Bypass for legacy: HARNESS_TDD_GATE=off.)\n`
  );
}

try {
  const input = readHookInput();
  const toolName = input.tool_name || '';
  const ti = input.tool_input || {};
  const filePath = ti.file_path || '';
  if (typeof filePath !== 'string' || !filePath) process.exit(0);

  const projectDir = resolveProjectDir(path.dirname(path.resolve(__filename)));
  const ext = path.extname(filePath).toLowerCase();
  const inserted = insertedContent(toolName, ti);

  checkScope(projectDir, path.resolve(filePath));
  checkTrustBoundary(realResolve(projectDir), realResolve(filePath));
  if (isProtectedEnvFile(filePath)) {
    block(`BLOCKED: Cannot modify ${path.basename(filePath)} — environment files contain real secrets. Edit manually.\nFix: Edit .env.example instead for documentation, or edit .env manually outside Claude.\n`);
  }
  if (inserted) {
    checkSecrets(filePath, inserted, projectDir);
    checkPatterns(projectDir, filePath.replace(/\\/g, '/'), inserted);
  }
  checkLength(toolName, ti, filePath, ext);
  checkTdd(projectDir, filePath);
  if (TRACKED_EXTS.has(ext) && !isSkippedPath(filePath)) {
    const pf = coveragePreflight(projectDir, toolName, ti, path.resolve(filePath));
    if (pf.decision === 'block') block(pf.message);
    if (pf.decision === 'note') process.stdout.write(pf.message);
  }
} catch (err) {
  reportFailure('pre-write-gate', err);
}

process.exit(0);
