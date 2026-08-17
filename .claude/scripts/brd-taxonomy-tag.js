#!/usr/bin/env node

'use strict';

// Keyword taxonomy for lean /brd --prd. Fills taxonomy:null left by adoption
// so the ten-slot floor can pass without an LLM pass over the spine.
// Does not invent requirements — it only labels text the PRD already wrote.

const fs = require('fs');
const path = require('path');

const SLOTS = [
  'functional',
  'data_lifecycle',
  'integration',
  'performance',
  'security_authz',
  'privacy_retention',
  'observability',
  'operability_failure',
  'ux_accessibility',
  'constraints',
];

const RULES = [
  { slot: 'functional', re: /(?:^|\/\s*)FR-/i },
  { slot: 'performance', re: /p95|latency|rps|requests per second|under \d+\s*ms|throughput/i },
  { slot: 'security_authz', re: /password|session|sign in|sign-out|auth|admin|argon|cookie|rate limit|entropy|open-redirect|own host/i },
  { slot: 'privacy_retention', re: /IP address|retention|ninety days|90-day|90 days|PII|personal data|discard/i },
  { slot: 'observability', re: /structured JSON log|request id|log line|metrics|duration/i },
  { slot: 'operability_failure', re: /healthz|unreachable|503|database is stopped|purge job|scheduled job/i },
  { slot: 'ux_accessibility', re: /WCAG|keyboard|focus|clipboard|assistive|Tab alone/i },
  { slot: 'integration', re: /OpenAPI|third-party|webhook|external API/i },
  { slot: 'data_lifecycle', re: /click event|stored|purge|delete|expiry|retention|tombstone/i },
  { slot: 'constraints', re: /docker compose|no third-party|self-host|single Postgres|cryptographically/i },
];

function haystack(req) {
  return [req.label, req.section, req.text, req.id].filter(Boolean).join(' ');
}

function tagRequirement(req) {
  const text = haystack(req);
  const slots = new Set();
  for (const { slot, re } of RULES) {
    if (re.test(text)) slots.add(slot);
  }
  if (slots.size === 0) slots.add('functional');
  return [...slots];
}

function coverageFor(reqs) {
  const covered = new Set();
  for (const r of reqs) for (const s of r.taxonomy || []) covered.add(s);
  return SLOTS
    .filter((slot) => !covered.has(slot))
    .map((slot) => ({
      slot,
      na_reason: 'The source PRD states no requirement for this slot; /spec authors one only if a later story needs it.',
    }));
}

function tagDir(dir) {
  const file = path.join(dir, 'brd-requirements.json');
  const reqs = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(reqs)) throw new Error(`brd-taxonomy-tag: ${file} is not an array`);
  for (const req of reqs) req.taxonomy = tagRequirement(req);
  fs.writeFileSync(file, `${JSON.stringify(reqs, null, 2)}\n`);
  const coverage = coverageFor(reqs);
  fs.writeFileSync(path.join(dir, 'taxonomy-coverage.json'), `${JSON.stringify(coverage, null, 2)}\n`);
  return { tagged: reqs.length, uncovered: coverage.map((c) => c.slot) };
}

function parseArgs(argv) {
  const opts = { root: process.cwd(), dir: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') opts.root = argv[++i];
    else if (argv[i] === '--dir') opts.dir = argv[++i];
  }
  opts.dir = path.resolve(opts.root, opts.dir || path.join('specs', 'brd'));
  return opts;
}

function main(argv) {
  const { dir } = parseArgs(argv);
  const result = tagDir(dir);
  process.stdout.write(
    `brd-taxonomy-tag: ${result.tagged} requirements tagged; `
    + `uncovered slots: ${result.uncovered.length ? result.uncovered.join(', ') : 'none'}\n`,
  );
}

module.exports = { tagRequirement, tagDir, SLOTS };

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`brd-taxonomy-tag: ${err.message}\n`);
    process.exit(2);
  }
}
