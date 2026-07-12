#!/usr/bin/env node

'use strict';

// Build a diagnostics work queue (Bun Phase B).
//
// Usage:
//   node .claude/scripts/diagnostics-shard.js --tool tsc --from-file errors.txt
//   node .claude/scripts/diagnostics-shard.js --tool ruff --text "..."
//   node .claude/scripts/diagnostics-shard.js --auto --from-file capture.txt
//
// Writes:
//   .claude/state/diagnostics/errors.jsonl
//   .claude/state/diagnostics/shards.json
//
// Exit 0 always on successful parse (even 0 errors); exit 2 on usage error.

const fs = require('fs');
const path = require('path');
const {
  parseDiagnostics,
  parseAuto,
  shardDiagnostics,
  toJsonl,
} = require('../hooks/lib/diagnostics-parse');

function parseArgs(argv) {
  const out = {
    tool: null,
    auto: false,
    fromFile: null,
    text: null,
    outDir: '.claude/state/diagnostics',
    maxPerShard: 50,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tool') out.tool = argv[++i];
    else if (a === '--auto') out.auto = true;
    else if (a === '--from-file') out.fromFile = argv[++i];
    else if (a === '--text') out.text = argv[++i];
    else if (a === '--out-dir') out.outDir = argv[++i];
    else if (a === '--max-per-shard') out.maxPerShard = Number(argv[++i]) || 50;
  }
  return out;
}

/**
 * @param {string[]} argv
 * @param {string} [root]
 * @param {{ readFileSync?: Function, writeFileSync?: Function, mkdirSync?: Function }} [deps]
 */
function run(argv, root = process.cwd(), deps = {}) {
  const args = parseArgs(argv);
  const readFileSync = deps.readFileSync || fs.readFileSync;
  const writeFileSync = deps.writeFileSync || fs.writeFileSync;
  const mkdirSync = deps.mkdirSync || fs.mkdirSync;

  let text = args.text;
  if (args.fromFile) {
    const p = path.isAbsolute(args.fromFile) ? args.fromFile : path.join(root, args.fromFile);
    text = readFileSync(p, 'utf8');
  }
  if (text == null) {
    process.stderr.write(
      'usage: diagnostics-shard.js (--tool tsc|eslint|ruff|mypy | --auto) (--from-file PATH | --text "...")\n'
    );
    return 2;
  }

  let diagnostics;
  if (args.auto || !args.tool) {
    diagnostics = parseAuto(text);
  } else {
    diagnostics = parseDiagnostics(args.tool, text);
  }

  const shards = shardDiagnostics(diagnostics, { maxPerShard: args.maxPerShard });
  const outDir = path.isAbsolute(args.outDir) ? args.outDir : path.join(root, args.outDir);
  mkdirSync(outDir, { recursive: true });

  const errorsPath = path.join(outDir, 'errors.jsonl');
  const shardsPath = path.join(outDir, 'shards.json');
  writeFileSync(errorsPath, toJsonl(diagnostics), 'utf8');
  const payload = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    tool: args.tool || 'auto',
    total_errors: diagnostics.length,
    shard_count: shards.length,
    shards,
  };
  writeFileSync(shardsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  process.stdout.write(
    `diagnostics-shard: ${diagnostics.length} error(s) → ${shards.length} shard(s)\n` +
      `  ${path.relative(root, errorsPath)}\n` +
      `  ${path.relative(root, shardsPath)}\n`
  );
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
