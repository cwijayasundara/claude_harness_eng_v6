#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function estimateTextTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

function cacheDir(projectDir) {
  const dir = path.join(projectDir, '.claude', 'state', 'context-cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function hashContent(raw) {
  return crypto.createHash('sha256').update(String(raw || '')).digest('hex').slice(0, 16);
}

function rel(projectDir, abs) {
  return path.relative(projectDir, abs).split(path.sep).join('/');
}

function storeContext({
  projectDir = process.cwd(),
  kind = 'generic-text',
  raw = '',
  label = '',
  estimatedPackTokens = null,
  estimatedSavedTokens = null,
} = {}) {
  const hash = hashContent(raw);
  const dir = cacheDir(projectDir);
  const rawAbs = path.join(dir, `${hash}.raw`);
  const metaAbs = path.join(dir, `${hash}.json`);
  const meta = {
    hash,
    kind,
    label,
    created_at: new Date().toISOString(),
    raw_path: rel(projectDir, rawAbs),
    meta_path: rel(projectDir, metaAbs),
    estimated_raw_tokens: estimateTextTokens(raw),
    estimated_pack_tokens: Number.isFinite(estimatedPackTokens) ? estimatedPackTokens : null,
    estimated_saved_tokens: Number.isFinite(estimatedSavedTokens) ? estimatedSavedTokens : null,
  };

  fs.writeFileSync(rawAbs, String(raw || ''));
  fs.writeFileSync(metaAbs, `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

function words(text) {
  return [...String(text || '').toLowerCase().matchAll(/[a-z0-9_./:-]+/g)].map((m) => m[0]);
}

function lineScore(queryWords, line) {
  const hay = words(line);
  let score = 0;
  for (const q of queryWords) {
    for (const h of hay) {
      if (h === q) score += 4;
      else if (h.includes(q) || q.includes(h)) score += 1;
    }
  }
  return score;
}

function queryLines(raw, query, maxLines = 40) {
  if (!query) return String(raw || '');
  const qWords = words(query);
  if (!qWords.length) return String(raw || '');
  const scored = String(raw || '').split('\n')
    .map((line, idx) => ({ line, idx, score: lineScore(qWords, line) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, maxLines)
    .sort((a, b) => a.idx - b.idx);
  return scored.map((r) => r.line).join('\n') + (scored.length ? '\n' : '');
}

function retrieveContext({ projectDir = process.cwd(), hash, query = '', maxLines = 40 } = {}) {
  if (!hash) return { status: 'missing_hash', raw: '', warnings: ['hash is required'] };
  const dir = cacheDir(projectDir);
  const rawAbs = path.join(dir, `${hash}.raw`);
  const metaAbs = path.join(dir, `${hash}.json`);
  if (!fs.existsSync(rawAbs) || !fs.existsSync(metaAbs)) {
    return { status: 'missing', hash, raw: '', warnings: [`no cached context for ${hash}`] };
  }
  const rawFull = fs.readFileSync(rawAbs, 'utf8');
  const meta = JSON.parse(fs.readFileSync(metaAbs, 'utf8'));
  const raw = queryLines(rawFull, query, maxLines);
  return {
    status: 'ok',
    hash,
    query,
    raw,
    raw_path: rel(projectDir, rawAbs),
    meta,
    estimated_return_tokens: estimateTextTokens(raw),
  };
}

module.exports = { storeContext, retrieveContext, estimateTextTokens };
