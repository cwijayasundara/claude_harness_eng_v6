#!/usr/bin/env node

'use strict';

// Golden-query navigation benchmark: pack recall + estimated token savings
// vs naive full-file orientation. No LLM required.

const fs = require('fs');
const path = require('path');
const { buildContextPack, estimateTextTokens } = require('./context-pack');

const DEFAULT_GOLDEN = path.join(__dirname, '..', '..', 'test', 'fixtures', 'nav-bench', 'golden-queries.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function estimateCorpusTokens(projectDir, paths) {
  let total = 0;
  for (const p of paths) {
    try {
      total += estimateTextTokens(fs.readFileSync(path.join(projectDir, p), 'utf8'));
    } catch (_) {
      total += 400; // missing file — assume medium file
    }
  }
  return total;
}

function hitExpected(pack, expectedPaths) {
  if (!expectedPaths || !expectedPaths.length) return { hit: true, matched: [] };
  const got = new Set((pack.results || []).map((r) => r.path));
  const matched = expectedPaths.filter((p) => got.has(p));
  return { hit: matched.length > 0, matched, expected: expectedPaths };
}

function runBench({
  projectDir = process.cwd(),
  goldenPath = null,
  budgetTokens = 1600,
} = {}) {
  const goldenFile = goldenPath || path.join(projectDir, 'test', 'fixtures', 'nav-bench', 'golden-queries.json');
  let golden = readJson(goldenFile);
  if (!golden) golden = readJson(DEFAULT_GOLDEN);
  if (!golden || !Array.isArray(golden.queries)) {
    return { ok: false, reason: 'missing_golden_queries', path: goldenFile };
  }

  const results = [];
  let hits = 0;
  let packTokens = 0;
  let naiveTokens = 0;

  for (const q of golden.queries) {
    const t0 = Date.now();
    const pack = buildContextPack({
      projectDir,
      question: q.question,
      budgetTokens: q.budget || budgetTokens,
      writeReceipt: false,
      useDiff: false,
    });
    const ms = Date.now() - t0;
    const recall = hitExpected(pack, q.expect_paths || q.expected_paths);
    if (recall.hit) hits += 1;
    const pTok = pack.estimated_tokens || estimateTextTokens(JSON.stringify(pack.results));
    const nTok = estimateCorpusTokens(
      projectDir,
      (q.expect_paths && q.expect_paths.length)
        ? q.expect_paths
        : (pack.results || []).slice(0, 5).map((r) => r.path),
    ) || 2000;
    // naive orientation: assume reading those files whole + siblings (~3x pack targets)
    const naive = Math.max(nTok * 3, 1500);
    packTokens += pTok;
    naiveTokens += naive;
    results.push({
      id: q.id || q.question,
      question: q.question,
      status: pack.status,
      confidence: pack.confidence,
      ms,
      pack_tokens: pTok,
      naive_tokens_est: naive,
      recall_hit: recall.hit,
      matched: recall.matched,
      expected: recall.expected || [],
      top_paths: (pack.results || []).slice(0, 5).map((r) => r.path),
    });
  }

  const n = results.length || 1;
  const summary = {
    ok: true,
    queries: n,
    recall_rate: hits / n,
    hits,
    avg_pack_tokens: Math.round(packTokens / n),
    avg_naive_tokens_est: Math.round(naiveTokens / n),
    estimated_savings_ratio: naiveTokens > 0 ? Math.round((1 - packTokens / naiveTokens) * 1000) / 1000 : 0,
    p95_ms: percentile(results.map((r) => r.ms), 0.95),
    results,
  };

  const outDir = path.join(projectDir, 'specs', 'reviews');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'nav-bench.json'), `${JSON.stringify(summary, null, 2)}\n`);
  } catch (_) { /* optional write */ }

  return summary;
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor(p * s.length));
  return s[i];
}

module.exports = { runBench, hitExpected };

if (require.main === module) {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const projectDir = rootIdx === -1 ? process.cwd() : args[rootIdx + 1];
  const goldenIdx = args.indexOf('--golden');
  const goldenPath = goldenIdx === -1 ? null : args[goldenIdx + 1];
  const summary = runBench({ projectDir, goldenPath });
  if (!summary.ok) {
    process.stderr.write(`nav-bench: ${summary.reason}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({
    queries: summary.queries,
    recall_rate: summary.recall_rate,
    avg_pack_tokens: summary.avg_pack_tokens,
    avg_naive_tokens_est: summary.avg_naive_tokens_est,
    estimated_savings_ratio: summary.estimated_savings_ratio,
    p95_ms: summary.p95_ms,
  }, null, 2)}\n`);
  // Fail CI if recall is catastrophically low on golden set
  if (summary.recall_rate < 0.5 && summary.queries >= 3) process.exit(2);
}
