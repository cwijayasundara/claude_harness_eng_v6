#!/usr/bin/env node

'use strict';

// Impact classifier for /feature (design spec 2026-07-04-sprint-delta-lane-design.md,
// §1). Decides whether a story is architecturally invisible (-> /change, no design
// amendment) or design-touching (-> /design --delta, amendment + GATE 2). Modeled on
// seam-confidence.js: a pure scoring function + thin CLI wrapper. Advisory only —
// always exits 0; it routes work, it does not block a build.

const fs = require('fs');
const path = require('path');

const RISK_PATTERNS = [
  { name: 'auth', re: /\b(auth|authn|authz|login|session|token|password)\b/i },
  { name: 'payments', re: /\b(payment|billing|invoice|charge|stripe|subscription)\b/i },
  { name: 'persistence', re: /\b(migration|schema change|persist|database|db\.|repository)\b/i },
  { name: 'public-api-contract', re: /\b(api contract|public api|breaking change|endpoint (added|removed|changed))\b/i },
];

const FILE_THRESHOLD = 3;

function extractFilePaths(text) {
  const re = /`([^`\n]+\.[a-z]{1,4})`/gi;
  const files = new Set();
  let m;
  while ((m = re.exec(String(text))) !== null) files.add(m[1]);
  return [...files];
}

function riskHits(text) {
  return RISK_PATTERNS.filter((p) => p.re.test(String(text))).map((p) => p.name);
}

function isNewModule(file, graph) {
  if (!graph || !Array.isArray(graph.nodes)) return false;
  const dir = path.dirname(file);
  return !graph.nodes.some((n) => n.path && path.dirname(n.path) === dir);
}

// Pure core. storyText is the story markdown (or request text); files is an
// explicit override list; graph is a parsed code-graph.json (or null).
function classifyImpact({ storyText, files, graph }) {
  const touchedFiles = files && files.length ? files : extractFilePaths(storyText);
  const risks = riskHits(storyText);
  const newModules = touchedFiles.filter((f) => isNewModule(f, graph));
  const reasons = [];
  let designTouching = false;

  if (touchedFiles.length > FILE_THRESHOLD) {
    designTouching = true;
    reasons.push(`touches ${touchedFiles.length} files (> ${FILE_THRESHOLD})`);
  }
  if (risks.length) {
    designTouching = true;
    reasons.push(`risk category: ${risks.join(', ')}`);
  }
  if (newModules.length) {
    designTouching = true;
    reasons.push(`introduces new module(s): ${newModules.join(', ')}`);
  }
  if (!designTouching) reasons.push('no file-count, risk, or new-module signal — architecturally invisible');

  return {
    classification: designTouching ? 'design-touching' : 'invisible',
    touched_files: touchedFiles,
    risk_categories: risks,
    new_modules: newModules,
    reasons,
  };
}

// --- CLI ----------------------------------------------------------------------

function parseArgs(argv) {
  const args = { files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--story') args.story = argv[++i];
    else if (key === '--graph') args.graph = argv[++i];
    else if (key === '--file') args.files.push(argv[++i]);
    else if (key === '--out') args.out = argv[++i];
  }
  return args;
}

function readJson(file) {
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.story && args.files.length === 0) {
    process.stderr.write('impact-classifier: --story <file> or --file <path> (repeatable) is required\n');
    process.exit(2);
  }
  const storyText = args.story && fs.existsSync(args.story) ? fs.readFileSync(args.story, 'utf8') : '';
  const graph = readJson(args.graph);
  const verdict = classifyImpact({ storyText, files: args.files, graph });

  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(verdict, null, 2) + '\n');
  }
  process.stdout.write(`impact-classifier: ${verdict.classification} — ${verdict.reasons.join('; ')}\n`);
  process.exit(0);
}

module.exports = { classifyImpact, extractFilePaths, riskHits, FILE_THRESHOLD };

if (require.main === module) main();
