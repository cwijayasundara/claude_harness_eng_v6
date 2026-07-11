#!/usr/bin/env node

'use strict';

// PreToolUse(Read|Bash) token optimizer.
// mode=advisory (default): warn + jsonl; never blocks.
// mode=enforced: same predicates → decision=block + exit 2 when a deterministic
// alternative exists. Fail open when graph/ranges are missing.

const fs = require('fs');
const path = require('path');
const { resolveProjectDir, readHookInput, reportFailure, countLines } = require('./lib/common');

const RECEIPT_NAME = 'context-pack-last.json';
const DEFAULT_RECEIPT_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

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
    context_search_required: false,
    context_pack_receipt_max_age_ms: DEFAULT_RECEIPT_MAX_AGE_MS,
    ...((manifest && manifest.token_governor) || {}),
  };
}

function graphMeta(projectDir) {
  const graph = readJson(path.join(projectDir, 'specs', 'brownfield', 'code-graph.json'), null);
  if (!graph) return { exists: false, real: false, hasRanges: false, graph };
  const empty = (graph.meta && graph.meta.status === 'empty')
    || ((graph.nodes || []).length === 0 && (graph.files || []).length === 0);
  const hasRanges = (graph.files || []).some((f) =>
    (f.symbols || []).some((s) => Number.isFinite(s.start || s.line) && Number.isFinite(s.end || s.start || s.line)));
  return { exists: true, real: !empty, hasRanges, graph };
}

function graphHasRange(projectDir, rel) {
  const { graph } = graphMeta(projectDir);
  if (!graph) return false;
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

function isSkippableNavPath(rel) {
  const s = String(rel || '');
  return (
    s.startsWith('specs/')
    || s.startsWith('.claude/')
    || s.startsWith('docs/')
    || s.startsWith('node_modules/')
    || s.startsWith('wiki/')
    || /(^|\/)(tests?|__tests__|e2e)(\/|$)/i.test(s)
    || /\.(md|json|yml|yaml|lock)$/i.test(s)
  );
}

function looksLikeSource(rel) {
  const s = String(rel || '');
  if (isSkippableNavPath(s)) return false;
  return (
    /^(src|lib|app|backend|frontend|server|client|packages|services)\//i.test(s)
    || /\.(py|js|jsx|ts|tsx|go|java|cs|rb|rs|php|kt|swift)$/i.test(s)
  );
}

function hasFreshContextPackReceipt(projectDir, maxAgeMs) {
  const receiptPath = path.join(projectDir, '.claude', 'state', RECEIPT_NAME);
  if (!fs.existsSync(receiptPath)) return false;
  try {
    const st = fs.statSync(receiptPath);
    const age = Date.now() - st.mtimeMs;
    if (age > (maxAgeMs || DEFAULT_RECEIPT_MAX_AGE_MS)) return false;
    const receipt = readJson(receiptPath, null);
    if (!receipt) return true; // mtime-only freshness if unreadable JSON
    // Any recent pack run counts — including no_match (agent still used the path)
    return true;
  } catch (_) {
    return false;
  }
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

function contextSearchWarning(projectDir, ti, cfg) {
  if (!cfg.context_search_required) return null;
  const filePath = ti.file_path || ti.path || '';
  if (!filePath || typeof filePath !== 'string') return null;

  const meta = graphMeta(projectDir);
  // Fail open: no graph, placeholder, or no symbol ranges
  if (!meta.real || !meta.hasRanges) return null;

  const abs = path.resolve(filePath);
  const rel = relPath(projectDir, abs);
  if (isSkippableNavPath(rel)) return null;
  if (!looksLikeSource(rel) && !graphHasRange(projectDir, rel)) return null;

  // Slice reads (offset provided) still require a pack once, but are fine after receipt
  if (hasFreshContextPackReceipt(projectDir, cfg.context_pack_receipt_max_age_ms)) return null;

  return {
    kind: 'context_search_skipped',
    tool: 'Read',
    path: rel,
    message:
      `TOKEN ADVISORY: source read of ${rel} without a recent context pack. ` +
      `token_governor.context_search_required is true — run first:\n` +
      `  node .claude/scripts/context-pack.js --diff --budget 1600 "<your question>"\n` +
      `  (or /context "<question>") then Read only the returned line ranges.\n`,
  };
}

function verboseCommandWarning(command, cfg) {
  if (!cfg.compress_tool_output) return null;
  const trimmed = String(command || '').trim();
  if (!trimmed) return null;
  // Already compacted — do not warn/block.
  if (/run-compact\.js/.test(trimmed)) return null;
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

/** Unconstrained repo-wide search when a real graph exists — prefer context-pack. */
function unconstrainedSearchWarning(projectDir, command, cfg) {
  const trimmed = String(command || '').trim();
  if (!trimmed) return null;
  // Only rg/find/grep style discovery
  if (!/\b(rg|grep|find|ag|ack)\b/.test(trimmed)) return null;
  // Already path-scoped or using compact search
  if (/search-compact\.js/.test(trimmed)) return null;
  if (/--glob\s| -g\s| --path\s| --type\s| \.\/src| src\/| backend\/| packages\//.test(trimmed)) return null;
  // find with maxdepth or path after find
  if (/\bfind\b/.test(trimmed) && !/\bfind\s+(\.|\"\.\"|'\\.')(\s|$)/.test(trimmed) && !/\bfind\s+\//.test(trimmed)) {
    // find with explicit subdir — ok
    if (!/\bfind\s+\.\s/.test(trimmed) && !/\bfind\s+\.\//.test(trimmed)) return null;
  }

  const meta = graphMeta(projectDir);
  if (!meta.real || !meta.hasRanges) return null;
  if (hasFreshContextPackReceipt(projectDir, cfg.context_pack_receipt_max_age_ms)) return null;

  return {
    kind: 'unconstrained_search',
    tool: 'Bash',
    command: trimmed,
    message:
      `TOKEN ADVISORY: unconstrained repo search without a recent context pack.\n` +
      `  Prefer: node .claude/scripts/context-pack.js --diff --budget 1600 "<question>"\n` +
      `  Then narrow rg to pack paths (e.g. rg pattern src/auth). Or use search-compact.js.\n`,
  };
}

function adviseTokenUsage({ projectDir, input }) {
  if (process.env.HARNESS_TOKEN_GOVERNOR === 'off') return { decision: 'ok' };
  const cfg = tokenConfig(projectDir);
  if (!cfg.enabled || cfg.mode === 'off') return { decision: 'ok' };
  const toolName = input.tool_name || '';
  const ti = input.tool_input || {};

  // Prefer the more specific context-search warning when both could apply
  let warning = null;
  if (toolName === 'Read') {
    warning = contextSearchWarning(projectDir, ti, cfg) || broadReadWarning(projectDir, ti, cfg);
  }
  if (toolName === 'Bash') {
    warning = unconstrainedSearchWarning(projectDir, ti.command, cfg)
      || verboseCommandWarning(ti.command, cfg);
  }
  if (!warning) return { decision: 'ok' };
  appendWarning(projectDir, warning);
  try {
    const { appendNavEvent } = require('../scripts/nav-telemetry');
    appendNavEvent(projectDir, {
      kind: 'token_advisor',
      warning_kind: warning.kind,
      tool: warning.tool,
      path: warning.path || null,
    });
  } catch (_) { /* fail open */ }
  const enforced = cfg.mode === 'enforced' || cfg.mode === 'enforce';
  if (enforced) {
    const blockMsg = warning.message
      .replace(/TOKEN ADVISORY:/g, 'TOKEN GOVERNOR (enforced):')
      .replace(/Prefer compact execution:/, 'Blocked — use compact execution:');
    return { decision: 'block', message: blockMsg, warning };
  }
  return { decision: 'warn', message: warning.message, warning };
}

if (require.main === module) {
  try {
    const input = readHookInput();
    const projectDir = resolveProjectDir(path.dirname(path.resolve(__filename)));
    const result = adviseTokenUsage({ projectDir, input });
    if (result.decision === 'warn' || result.decision === 'block') {
      process.stdout.write(result.message);
    }
    if (result.decision === 'block') process.exit(2);
  } catch (err) {
    reportFailure('token-advisor', err);
  }
}

module.exports = {
  adviseTokenUsage,
  hasFreshContextPackReceipt,
  contextSearchWarning,
  RECEIPT_NAME,
};
