#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { storeContext, estimateTextTokens } = require('./context-store');

function argValue(args, flag, fallback = null) {
  const idx = args.indexOf(flag);
  return idx === -1 ? fallback : args[idx + 1];
}

function sourceFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.claude' || entry.name === 'node_modules') continue;
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(dir, rel));
    else out.push(rel.split(path.sep).join('/'));
  }
  return out;
}

function globToRegExp(glob) {
  if (!glob) return /^.*$/;
  const escaped = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

function searchFiles({ projectDir, pattern, glob }) {
  const re = new RegExp(pattern);
  const globRe = globToRegExp(glob);
  const files = [];
  const rawLines = [];
  for (const file of sourceFiles(projectDir).filter((f) => globRe.test(f))) {
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

if (require.main === module) {
  const args = process.argv.slice(2);
  const projectDir = argValue(args, '--root', process.cwd());
  const pattern = argValue(args, '--pattern', args.find((a) => !a.startsWith('--')));
  const glob = argValue(args, '--glob', null);
  if (!pattern) {
    process.stdout.write(`${JSON.stringify({ status: 'missing_pattern', files: [], warnings: ['pass --pattern <regex>'] }, null, 2)}\n`);
    process.exit(2);
  }
  const { files, raw } = searchFiles({ projectDir, pattern, glob });
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
    context_hash: stored.hash,
    retrieve: `node .claude/scripts/context-retrieve.js ${stored.hash}`,
    estimated_raw_tokens: estimatedRaw,
    estimated_pack_tokens: estimatedPack,
    files,
  };
  pack.estimated_saved_tokens = estimatedSaved;
  process.stdout.write(`${JSON.stringify(pack, null, 2)}\n`);
}
