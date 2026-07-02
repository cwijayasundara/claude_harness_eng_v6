#!/usr/bin/env node

'use strict';

// PreToolUse(Read|Bash) advisory token optimizer. It never blocks. It only
// points the agent at cheaper existing paths and records warning counters for
// /status and later telemetry.

const fs = require('fs');
const path = require('path');
const { resolveProjectDir, readHookInput, reportFailure, countLines } = require('./lib/common');

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function relPath(projectDir, filePath) {
  const rel = path.relative(projectDir, path.resolve(filePath)).split(path.sep).join('/');
  return rel.startsWith('..') ? filePath.split(path.sep).join('/') : rel;
}

function tokenConfig(projectDir) {
  const manifest = readJson(path.join(projectDir, 'project-manifest.json'), {});
  return {
    enabled: true,
    mode: 'advisory',
    max_source_read_lines: 300,
    compress_tool_output: false,
    ...((manifest && manifest.token_governor) || {}),
  };
}

function graphHasRange(projectDir, rel) {
  const graph = readJson(path.join(projectDir, 'specs', 'brownfield', 'code-graph.json'), {});
  return (graph.files || []).some((f) =>
    f.path === rel && (f.symbols || []).some((s) => Number.isFinite(s.start || s.line) && Number.isFinite(s.end || s.start || s.line))
  );
}

function appendWarning(projectDir, warning) {
  const stateDir = path.join(projectDir, '.claude', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.appendFileSync(path.join(stateDir, 'token-advisor.jsonl'), `${JSON.stringify({
    ts: new Date().toISOString(),
    ...warning,
  })}\n`);
}

function broadReadWarning(projectDir, ti, cfg) {
  const filePath = ti.file_path || ti.path || '';
  if (!filePath || typeof filePath !== 'string') return null;
  const abs = path.resolve(filePath);
  let text = '';
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (_) {
    return null;
  }
  const lines = countLines(text);
  if (lines < (cfg.max_source_read_lines || 300)) return null;
  const rel = relPath(projectDir, abs);
  if (!graphHasRange(projectDir, rel)) return null;
  return {
    kind: 'broad_source_read',
    tool: 'Read',
    path: rel,
    lines,
    message:
      `TOKEN ADVISORY: broad source read of ${rel} (${lines} lines). ` +
      `Use /context "<question>" or specs/brownfield/symbol-map.md to read exact line ranges first.\n`,
  };
}

function verboseCommandWarning(command, cfg) {
  if (!cfg.compress_tool_output) return null;
  const trimmed = String(command || '').trim();
  if (!trimmed) return null;
  const kind = /\b(test|pytest|vitest|jest|mocha|playwright)\b/i.test(trimmed)
    ? 'test'
    : /\b(build|compile|tsc|webpack|vite)\b/i.test(trimmed)
      ? 'build-log'
      : /\b(lint|eslint|ruff)\b/i.test(trimmed)
        ? 'lint'
        : null;
  if (!kind) return null;
  return {
    kind: 'verbose_command',
    tool: 'Bash',
    command: trimmed,
    compact_kind: kind,
    message:
      `TOKEN ADVISORY: likely verbose command. Prefer compact execution:\n` +
      `  node .claude/scripts/run-compact.js --kind ${kind} -- ${trimmed}\n`,
  };
}

function adviseTokenUsage({ projectDir, input }) {
  const cfg = tokenConfig(projectDir);
  if (!cfg.enabled || cfg.mode === 'off') return { decision: 'ok' };
  const toolName = input.tool_name || '';
  const ti = input.tool_input || {};
  let warning = null;
  if (toolName === 'Read') warning = broadReadWarning(projectDir, ti, cfg);
  if (toolName === 'Bash') warning = verboseCommandWarning(ti.command, cfg);
  if (!warning) return { decision: 'ok' };
  appendWarning(projectDir, warning);
  return { decision: 'warn', message: warning.message, warning };
}

if (require.main === module) {
  try {
    const input = readHookInput();
    const projectDir = resolveProjectDir(path.dirname(path.resolve(__filename)));
    const result = adviseTokenUsage({ projectDir, input });
    if (result.decision === 'warn') process.stdout.write(result.message);
  } catch (err) {
    reportFailure('token-advisor', err);
  }
}

module.exports = { adviseTokenUsage };
