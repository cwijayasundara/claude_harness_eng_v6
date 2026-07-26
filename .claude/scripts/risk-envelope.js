#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { classifyImpact, extractFilePaths } = require('./impact-classifier');

const TIER_ORDER = ['R0', 'R1', 'R2', 'R3', 'R4'];
const SIGNALS = [
  { name: 'production_access', tier: 'R4', re: /\b(production access|prod access|deploy to prod|production database|irreversible)\b/i },
  { name: 'authorization', tier: 'R3', re: /\b(authz|authorization|permission|role|tenant isolation|access control)\b/i },
  { name: 'sensitive_data', tier: 'R3', re: /\b(pii|personal data|health data|payment card|secret|credential)\b/i },
  { name: 'authentication', tier: 'R3', re: /\b(auth|authn|login|session|password|oauth|saml|jwt|token)\b/i },
  { name: 'payments', tier: 'R3', re: /\b(payment|billing|invoice|charge|stripe|subscription)\b/i },
  { name: 'dependency_change', tier: 'R2', re: /\b(dependency|dependencies|lockfile|package-lock|requirements|upgrade package)\b/i },
  { name: 'persistence', tier: 'R2', re: /\b(migration|schema change|database|repository|persistent data)\b/i },
  { name: 'infrastructure', tier: 'R2', re: /\b(terraform|infrastructure|kubernetes|docker|github actions|ci\/cd|network policy)\b/i },
  { name: 'public_api', tier: 'R2', re: /\b(public api|api contract|breaking change|webhook)\b/i },
];

const FILE_SIGNALS = [
  { name: 'documentation_only', tier: 'R0', re: /^(docs\/|.*\.(md|txt|rst)$)/i },
  { name: 'dependency_change', tier: 'R2', re: /(^|\/)(package-lock\.json|package\.json|requirements.*\.txt|poetry\.lock|uv\.lock|Cargo\.lock)$/i },
  { name: 'infrastructure', tier: 'R2', re: /(^|\/)(\.github\/workflows|terraform|infra|k8s|deploy)(\/|$)/i },
  { name: 'authentication', tier: 'R3', re: /(^|[/_.-])(auth|login|session|oauth|saml|jwt)([/_.-]|$)/i },
  { name: 'sensitive_data', tier: 'R3', re: /(^|[/_.-])(secret|credential|pii|privacy)([/_.-]|$)/i },
];

function maxTier(a, b) {
  return TIER_ORDER[Math.max(TIER_ORDER.indexOf(a), TIER_ORDER.indexOf(b))];
}

function unique(values) {
  return [...new Set(values)];
}

function classifyRisk({ taskId, text = '', files = [], graph = null, now = new Date() }) {
  const touched = files.length ? files : extractFilePaths(text);
  const textHits = SIGNALS.filter((s) => s.re.test(text));
  const fileHits = FILE_SIGNALS.filter((s) => touched.some((file) => s.re.test(file)));
  const allDocs = touched.length > 0 && touched.every((file) => FILE_SIGNALS[0].re.test(file));
  let tier = allDocs ? 'R0' : 'R1';
  for (const hit of [...textHits, ...fileHits]) tier = maxTier(tier, hit.tier);

  const impact = classifyImpact({ storyText: text, files: touched, graph });
  if (impact.classification === 'design-touching') tier = maxTier(tier, 'R2');
  const signals = unique([...textHits, ...fileHits].map((hit) => hit.name));
  if (impact.classification === 'design-touching') signals.push('design_touching');

  const required = ['unit', 'acceptance', 'independent_review'];
  if (TIER_ORDER.indexOf(tier) >= 2) required.push('integration', 'sast', 'dependency_scan');
  if (TIER_ORDER.indexOf(tier) >= 3) required.push('security_review', 'threat_model');
  if (tier === 'R4') required.push('human_execution');

  const forbidden = ['merge'];
  if (TIER_ORDER.indexOf(tier) >= 2) forbidden.push('modify_branch_protection');
  if (TIER_ORDER.indexOf(tier) >= 3) forbidden.push('deploy');
  if (tier === 'R4') forbidden.push('execute_production_change');

  return {
    schema_version: 1,
    task_id: taskId || 'unassigned',
    tier,
    reasons: unique(signals.length ? signals : [allDocs ? 'documentation_only' : 'ordinary_code_change']),
    signals: unique(signals),
    allowed_paths: unique(touched),
    forbidden_actions: unique(forbidden),
    required_evidence: unique(required),
    required_approvals: tier === 'R0' ? 0 : tier === 'R1' ? 1 : tier === 'R2' ? 1 : 2,
    classified_at: now.toISOString(),
    classifier_version: 1,
  };
}

function parseArgs(argv) {
  const opts = { files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--task') opts.taskId = argv[++i];
    else if (argv[i] === '--text') opts.text = argv[++i];
    else if (argv[i] === '--story') opts.story = argv[++i];
    else if (argv[i] === '--file') opts.files.push(argv[++i]);
    else if (argv[i] === '--graph') opts.graph = argv[++i];
    else if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.taskId) {
    process.stderr.write('risk-envelope: --task <id> is required\n');
    process.exit(2);
  }
  const storyText = opts.story && fs.existsSync(opts.story) ? fs.readFileSync(opts.story, 'utf8') : '';
  const graph = opts.graph && fs.existsSync(opts.graph) ? JSON.parse(fs.readFileSync(opts.graph, 'utf8')) : null;
  const envelope = classifyRisk({ taskId: opts.taskId, text: opts.text || storyText, files: opts.files, graph });
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const out = opts.out || path.join(root, '.claude', 'state', 'risk-envelope.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(envelope, null, 2)}\n`);
  fs.writeFileSync(path.join(root, '.claude', 'state', 'current-task'), `${envelope.task_id}\n`);
  fs.writeFileSync(path.join(root, '.claude', 'state', 'current-risk-tier'), `${envelope.tier}\n`);
  process.stdout.write(`risk-envelope: ${envelope.task_id} ${envelope.tier} — ${envelope.reasons.join(', ')}\n`);
}

module.exports = { FILE_SIGNALS, SIGNALS, TIER_ORDER, classifyRisk, maxTier, parseArgs };

if (require.main === module) main();
