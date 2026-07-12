#!/usr/bin/env node

'use strict';

// Format commit subjects with optional review attribution (Bun Phase C).
// Bun put review attribution in commit subjects; we keep audit JSON as source of
// truth and offer a small formatter for humans/agents.
//
// Usage:
//   node .claude/scripts/review-commit-msg.js --subject "fix uaf on pipe close" \
//     --review-id f0a4543 --finding "leak Box before async uv_close"
//   node .claude/scripts/review-commit-msg.js --from-audit specs/reviews/adversarial-review-audit.json \
//     --subject "address dual-review BLOCKs"
//
// Prints a single-line subject to stdout (suitable for git commit -m).

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { subject: '', reviewId: null, finding: null, fromAudit: null, policy: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--subject') out.subject = argv[++i] || '';
    else if (argv[i] === '--review-id') out.reviewId = argv[++i];
    else if (argv[i] === '--finding') out.finding = argv[++i];
    else if (argv[i] === '--from-audit') out.fromAudit = argv[++i];
    else if (argv[i] === '--policy') out.policy = argv[++i];
  }
  return out;
}

/**
 * @param {{ subject: string, reviewId?: string|null, finding?: string|null, policy?: string|null, blockCount?: number }} opts
 */
function formatReviewSubject(opts) {
  const base = String(opts.subject || '').trim() || 'apply review fixes';
  const parts = [base];
  const tags = [];
  if (opts.reviewId) tags.push(`review:${opts.reviewId}`);
  if (opts.policy) tags.push(`policy=${opts.policy}`);
  if (opts.blockCount != null && opts.blockCount > 0) tags.push(`blocks=${opts.blockCount}`);
  if (opts.finding) {
    const f = String(opts.finding).replace(/\s+/g, ' ').trim().slice(0, 72);
    if (f) tags.push(f);
  }
  if (tags.length) parts.push(`(${tags.join('; ')})`);
  // Conventional short subject ~72–100 chars preferred; do not hard-truncate message body needs
  return parts.join(' ');
}

function loadAudit(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function run(argv, root = process.cwd()) {
  const args = parseArgs(argv);
  let reviewId = args.reviewId;
  let policy = args.policy;
  let blockCount = null;
  let finding = args.finding;

  if (args.fromAudit) {
    const p = path.isAbsolute(args.fromAudit) ? args.fromAudit : path.join(root, args.fromAudit);
    const audit = loadAudit(p);
    if (audit) {
      policy = policy || audit.policy || null;
      if (audit.merged_summary && audit.merged_summary.block != null) {
        blockCount = audit.merged_summary.block;
      }
      if (!reviewId && audit.instances && audit.instances[0]) {
        reviewId = 'adversarial';
      }
      if (!finding && audit.merged_pass === false) {
        finding = 'dual-review BLOCK fixes';
      }
    }
  }

  if (!args.subject && !args.fromAudit) {
    process.stderr.write(
      'usage: review-commit-msg.js --subject "..." [--review-id ID] [--finding "..."] [--from-audit path]\n'
    );
    return 2;
  }

  const line = formatReviewSubject({
    subject: args.subject,
    reviewId,
    finding,
    policy,
    blockCount,
  });
  process.stdout.write(`${line}\n`);
  return 0;
}

module.exports = { formatReviewSubject, parseArgs, run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
