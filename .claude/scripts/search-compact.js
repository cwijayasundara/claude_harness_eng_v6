#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { storeContext, estimateTextTokens } = require('./context-store');

function argValue(args, flag, fallback = null) {
  const idx = args.indexOf(flag);
  return idx === -1 ? fallback : args[idx + 1];
}

// Dirs excluded everywhere by bare name (VCS / installed deps).
const EXCLUDED_DIR_NAMES = new Set(['.git', 'node_modules']);
// Heavy/transient trees that sit directly under a .claude/ control dir: runtime
// state logs, run journals, and worktree checkouts. Excluded by (parent === .claude,
// name) rather than a single top-level prefix, so nested copies inside a worktree's
// own .claude/ are caught too. Crucially NOT a blanket '.claude' exclusion — that hid
// the harness's own hooks/scripts/skills from /retro and every scoped search (the real
// cause of "canvas-sync doesn't exist").
const CLAUDE_HEAVY_DIRS = new Set(['state', 'runs', 'worktrees']);

function underPrefix(rel, prefix) {
  return rel === prefix || rel.startsWith(`${prefix}/`);
}

function sourceFiles(dir, prefix = '') {
  const out = [];
  const parent = prefix.split('/').pop();
  for (const entry of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const rel = path.join(prefix, entry.name).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (parent === '.claude' && CLAUDE_HEAVY_DIRS.has(entry.name)) continue;
      out.push(...sourceFiles(dir, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

function globToRegExp(glob) {
  if (!glob) return /^.*$/;
  const escaped = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

function searchFiles({ projectDir, pattern, glob, scopes = [] }) {
  const re = new RegExp(pattern);
  const globRe = globToRegExp(glob);
  const inScope = (f) => !scopes.length || scopes.some((s) => underPrefix(f, s));
  const files = [];
  const rawLines = [];
  for (const file of sourceFiles(projectDir).filter((f) => globRe.test(f) && inScope(f))) {
    const abs = path.join(projectDir, file);
    let text = '';
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch (_) {
      continue;
    }
    const matches = [];
    text.split('\n').forEach((line, idx) => {
      if (re.test(line)) {
        const match = { line: idx + 1, text: line };
        matches.push(match);
        rawLines.push(`${file}:${idx + 1}:${line}`);
      }
    });
    if (matches.length) files.push({ path: file, matches });
  }
  return { files, raw: rawLines.join('\n') + (rawLines.length ? '\n' : '') };
}

// Positional args are everything not consumed by a --flag (each flag takes one value).
function positionalArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { i += 1; continue; }
    out.push(args[i]);
  }
  return out;
}

function normalizeScope(s) {
  return String(s).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const projectDir = argValue(args, '--root', process.cwd());
  const positionals = positionalArgs(args);
  const patternFromFlag = argValue(args, '--pattern', null);
  const pattern = patternFromFlag != null ? patternFromFlag : positionals[0];
  const glob = argValue(args, '--glob', null);
  // Any positional after the pattern scopes the search to that path prefix (dir or
  // file) — previously ignored, so a "scoped" search silently ran repo-wide.
  const scopes = (patternFromFlag != null ? positionals : positionals.slice(1)).map(normalizeScope).filter(Boolean);
  if (!pattern) {
    process.stdout.write(`${JSON.stringify({ status: 'missing_pattern', files: [], warnings: ['pass --pattern <regex>'] }, null, 2)}\n`);
    process.exit(2);
  }
  const { files, raw } = searchFiles({ projectDir, pattern, glob, scopes });
  const estimatedRaw = estimateTextTokens(raw);
  const estimatedPack = estimateTextTokens(JSON.stringify(files));
  const estimatedSaved = Math.max(0, estimatedRaw - estimatedPack);
  const stored = storeContext({
    projectDir,
    kind: 'search-results',
    raw,
    label: pattern,
    estimatedPackTokens: estimatedPack,
    estimatedSavedTokens: estimatedSaved,
  });
  const pack = {
    status: files.length ? 'ok' : 'no_match',
    pattern,
    glob,
    scopes,
    context_hash: stored.hash,
    retrieve: `node .claude/scripts/context-retrieve.js ${stored.hash}`,
    estimated_raw_tokens: estimatedRaw,
    estimated_pack_tokens: estimatedPack,
    files,
  };
  pack.estimated_saved_tokens = estimatedSaved;
  process.stdout.write(`${JSON.stringify(pack, null, 2)}\n`);
}

module.exports = { sourceFiles, searchFiles };
