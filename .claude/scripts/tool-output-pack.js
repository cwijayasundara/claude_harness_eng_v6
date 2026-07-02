#!/usr/bin/env node

'use strict';

// Compact command output for agent consumption while preserving the raw log on
// disk. This is intentionally conservative: never hide failures, paths, line
// numbers, exit codes, or commands.

const fs = require('fs');
const path = require('path');

function estimateTextTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

function safeStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureRawDir(projectDir) {
  const dir = path.join(projectDir, '.claude', 'state', 'tool-output');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function detectFailures(raw) {
  const lines = String(raw || '').split('\n');
  const failures = [];
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const failFile = line.match(/\bFAIL\s+([^\s:]+)(?::(\d+))?/);
    if (failFile) {
      current = { name: null, path: failFile[1], line: failFile[2] ? parseInt(failFile[2], 10) : null, message: line.trim() };
      failures.push(current);
      continue;
    }
    const at = line.match(/\bat\s+([^:\s]+):(\d+):(\d+)/);
    if (at) {
      const target = current || { name: null, path: at[1], line: parseInt(at[2], 10), message: line.trim() };
      target.path = target.path || at[1];
      target.line = target.line || parseInt(at[2], 10);
      if (!current) failures.push(target);
      continue;
    }
    if (current && !current.name && /^\s{2,}\S/.test(line) && !/AssertionError|Error:/.test(line)) {
      current.name = line.trim();
      continue;
    }
    if (current && /AssertionError|Error:|Expected|expected|Received|got/.test(line)) {
      current.message = line.trim();
    }
  }
  return failures;
}

function summarize(raw, failures, exit) {
  const lines = String(raw || '').split('\n').filter(Boolean);
  const summaryLine = [...lines].reverse().find((l) => /Tests?:|fail|pass|passed|failed|error/i.test(l));
  if (failures.length) return `${failures.length} failure(s) detected${summaryLine ? ` — ${summaryLine}` : ''}`;
  if (exit && exit !== 0) return summaryLine || `command exited ${exit}; no structured failures detected`;
  return summaryLine ? `no failures detected — ${summaryLine}` : 'no failures detected';
}

function compactText({ command, exit, summary, failures }) {
  const lines = [`Command: ${command || '-'}`, `Exit: ${exit == null ? '-' : exit}`, `Summary: ${summary}`];
  if (failures.length) {
    lines.push('Failures:');
    for (const f of failures) {
      const loc = f.path ? `${f.path}${f.line ? `:${f.line}` : ''}` : 'unknown location';
      lines.push(`- ${f.name || 'failure'} at ${loc}: ${f.message || ''}`.trim());
    }
  } else {
    lines.push('Failures: none');
  }
  return `${lines.join('\n')}\n`;
}

function packToolOutput({ projectDir = process.cwd(), kind = 'generic-log', command = '', raw = '', exit = 0 } = {}) {
  const rawDir = ensureRawDir(projectDir);
  const rawName = `${safeStamp()}-${String(kind).replace(/[^a-z0-9_-]/gi, '_')}.log`;
  const rawAbs = path.join(rawDir, rawName);
  fs.writeFileSync(rawAbs, String(raw || ''));
  const rawPath = path.relative(projectDir, rawAbs).split(path.sep).join('/');

  const failures = detectFailures(raw);
  const summary = summarize(raw, failures, exit);
  const packed = compactText({ command, exit, summary, failures });
  const estimatedRaw = estimateTextTokens(raw);
  const estimatedPack = estimateTextTokens(packed);
  return {
    kind,
    command,
    exit,
    raw_path: rawPath,
    estimated_raw_tokens: estimatedRaw,
    estimated_pack_tokens: estimatedPack,
    estimated_saved_tokens: Math.max(0, estimatedRaw - estimatedPack),
    summary,
    failures,
    pack: packed,
  };
}

module.exports = { packToolOutput, estimateTextTokens, detectFailures };

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i === -1 ? fallback : args[i + 1];
  };
  const projectDir = get('--root', process.cwd());
  const kind = get('--kind', 'generic-log');
  const command = get('--command', '');
  const exit = parseInt(get('--exit', '0'), 10) || 0;
  const inFile = get('--in', null);
  const outFile = get('--out', null);
  const raw = inFile ? fs.readFileSync(inFile, 'utf8') : fs.readFileSync(0, 'utf8');
  const packed = `${JSON.stringify(packToolOutput({ projectDir, kind, command, raw, exit }), null, 2)}\n`;
  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, packed);
  } else {
    process.stdout.write(packed);
  }
}
