'use strict';

// Pure parsers for tool diagnostics → stable JSONL rows (Bun Phase B).
// Row shape: { tool, file, line, col, code, message, package }

const path = require('path');

/**
 * @typedef {{ tool: string, file: string, line: number, col: number, code: string, message: string, package: string }} Diagnostic
 */

function packageOf(file, groupBy = 'top') {
  if (!file) return 'unknown';
  const n = String(file).replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = n.split('/').filter(Boolean);
  if (parts.length === 0) return 'unknown';
  // Prefer first meaningful root: src/foo → src/foo, packages/a → packages/a
  // For file-at-root under lib/src (e.g. lib/util.ts) use the dir only: "lib"
  if (parts[0] === 'src' || parts[0] === 'lib' || parts[0] === 'app') {
    if (parts.length >= 3) return `${parts[0]}/${parts[1]}`;
    if (parts.length === 2) {
      // src/mod.ts → "src"; src/mod/file.ts would be length 3
      return parts[0];
    }
    return parts[0];
  }
  if (parts[0] === 'packages' || parts[0] === 'apps' || parts[0] === 'services') {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  if (groupBy === 'file') return n;
  return parts[0];
}

function row(partial) {
  const file = (partial.file || '').replace(/\\/g, '/');
  return {
    tool: partial.tool || 'unknown',
    file,
    line: Number(partial.line) || 0,
    col: Number(partial.col) || 0,
    code: String(partial.code || ''),
    message: String(partial.message || '').trim(),
    package: partial.package || packageOf(file),
  };
}

/**
 * TypeScript / tsc pretty or plain:
 *   src/a.ts(10,5): error TS2322: Type 'string' is not assignable...
 *   src/a.ts:10:5 - error TS2322: ...
 */
function parseTsc(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  const reParen = /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.*)$/;
  const reColon = /^(.+?):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.*)$/;
  for (const line of lines) {
    let m = line.match(reParen) || line.match(reColon);
    if (!m) continue;
    out.push(row({
      tool: 'tsc',
      file: m[1].trim(),
      line: m[2],
      col: m[3],
      code: m[4],
      message: m[5],
    }));
  }
  return out;
}

/**
 * ESLint stylish (default CLI):
 *   /abs/path/src/a.ts
 *     10:5  error  Unexpected any  @typescript-eslint/no-explicit-any
 * Or JSON array from eslint -f json
 */
function parseEslint(text) {
  const raw = String(text || '').trim();
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const data = JSON.parse(raw);
      const files = Array.isArray(data) ? data : [data];
      const out = [];
      for (const f of files) {
        const filePath = f.filePath || f.file || '';
        for (const msg of f.messages || []) {
          if (msg.severity !== 2 && msg.severity !== 'error') {
            // keep errors only; severity 2 = error
            if (msg.severity !== 2) continue;
          }
          out.push(row({
            tool: 'eslint',
            file: filePath,
            line: msg.line,
            col: msg.column,
            code: msg.ruleId || '',
            message: msg.message || '',
          }));
        }
      }
      return out;
    } catch (_) {
      /* fall through to stylish */
    }
  }
  const out = [];
  let currentFile = '';
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^(\/|\.\/|[A-Za-z]:\\)/.test(line) || (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(line) && !/^\s/.test(line))) {
      currentFile = line.trim();
      continue;
    }
    const m = line.match(/^\s+(\d+):(\d+)\s+error\s+(.+?)\s{2,}(\S+)\s*$/);
    if (m && currentFile) {
      out.push(row({
        tool: 'eslint',
        file: currentFile,
        line: m[1],
        col: m[2],
        message: m[3].trim(),
        code: m[4],
      }));
    }
  }
  return out;
}

/**
 * Ruff text:
 *   src/a.py:10:5: E501 Line too long
 * Ruff JSON: array of { filename, location: {row,column}, code, message }
 */
function parseRuff(text) {
  const raw = String(text || '').trim();
  if (raw.startsWith('[')) {
    try {
      const data = JSON.parse(raw);
      return (Array.isArray(data) ? data : []).map((d) => row({
        tool: 'ruff',
        file: d.filename || d.file || '',
        line: (d.location && d.location.row) || d.row || d.line,
        col: (d.location && d.location.column) || d.column || d.col,
        code: d.code || '',
        message: d.message || d.body || '',
      }));
    } catch (_) {
      /* fall through */
    }
  }
  const out = [];
  const re = /^(.+?):(\d+):(\d+):\s*([A-Z]\d+)\s+(.*)$/;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    out.push(row({
      tool: 'ruff',
      file: m[1],
      line: m[2],
      col: m[3],
      code: m[4],
      message: m[5],
    }));
  }
  return out;
}

/**
 * mypy:
 *   src/a.py:10: error: Incompatible types  [assignment]
 *   src/a.py:10:5: error: ...
 */
function parseMypy(text) {
  const out = [];
  const re = /^(.+?):(\d+)(?::(\d+))?: error: (.+?)(?:\s+\[([^\]]+)\])?\s*$/;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    out.push(row({
      tool: 'mypy',
      file: m[1],
      line: m[2],
      col: m[3] || 0,
      code: m[5] || '',
      message: m[4],
    }));
  }
  return out;
}

const PARSERS = Object.freeze({
  tsc: parseTsc,
  eslint: parseEslint,
  ruff: parseRuff,
  mypy: parseMypy,
});

/**
 * @param {string} tool
 * @param {string} text
 * @returns {Diagnostic[]}
 */
function parseDiagnostics(tool, text) {
  const fn = PARSERS[String(tool || '').toLowerCase()];
  if (!fn) return [];
  return fn(text);
}

/**
 * Auto-detect tool from content when possible; otherwise try all.
 */
function parseAuto(text) {
  const raw = String(text || '');
  if (/\berror TS\d+\b/.test(raw)) return parseTsc(raw);
  if (raw.trim().startsWith('[') && /"filePath"|"messages"/.test(raw)) return parseEslint(raw);
  if (raw.trim().startsWith('[') && /"filename"|"location"/.test(raw)) return parseRuff(raw);
  if (/: error: /.test(raw) && /\[/.test(raw)) return parseMypy(raw);
  if (/^\s+\d+:\d+\s+error\s+/m.test(raw)) return parseEslint(raw);
  if (/: [A-Z]\d+ /.test(raw)) return parseRuff(raw);
  // try all and pick largest
  const candidates = [
    parseTsc(raw),
    parseEslint(raw),
    parseRuff(raw),
    parseMypy(raw),
  ];
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] || [];
}

/**
 * Group diagnostics into shards by package.
 * @param {Diagnostic[]} diagnostics
 * @param {{ maxPerShard?: number }} [opts]
 * @returns {{ id: string, package: string, files: string[], errors: Diagnostic[] }[]}
 */
function shardDiagnostics(diagnostics, opts = {}) {
  const maxPerShard = opts.maxPerShard || 50;
  /** @type {Map<string, Diagnostic[]>} */
  const byPkg = new Map();
  for (const d of diagnostics || []) {
    const pkg = d.package || packageOf(d.file);
    if (!byPkg.has(pkg)) byPkg.set(pkg, []);
    byPkg.get(pkg).push(d);
  }
  const shards = [];
  let n = 0;
  for (const [pkg, errors] of [...byPkg.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (let i = 0; i < errors.length; i += maxPerShard) {
      const chunk = errors.slice(i, i + maxPerShard);
      const files = [...new Set(chunk.map((e) => e.file))].sort();
      shards.push({
        id: `shard-${++n}`,
        package: pkg,
        files,
        errors: chunk,
        error_count: chunk.length,
      });
    }
  }
  return shards;
}

function toJsonl(diagnostics) {
  return (diagnostics || []).map((d) => JSON.stringify(d)).join('\n') + (diagnostics && diagnostics.length ? '\n' : '');
}

function fromJsonl(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch (_) {
      /* skip */
    }
  }
  return out;
}

module.exports = {
  packageOf,
  parseTsc,
  parseEslint,
  parseRuff,
  parseMypy,
  parseDiagnostics,
  parseAuto,
  shardDiagnostics,
  toJsonl,
  fromJsonl,
  PARSERS,
};
