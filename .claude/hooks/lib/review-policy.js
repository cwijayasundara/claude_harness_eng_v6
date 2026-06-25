'use strict';

const path = require('path');

const SECURITY_RE = /(^|[/_.-])(auth|authz|login|logout|session|cookie|csrf|cors|jwt|oauth|saml|token|permission|permissions|role|roles|policy|acl|secret|password|passwd|credential|credentials|crypto|encrypt|decrypt|hash|upload|download|webhook|payment|billing|invoice|checkout|pii|privacy)([/_.-]|$)/i;
const DATA_RE = /(^|[/_.-])(api|route|router|controller|middleware|request|response|server|handler|endpoint|schema|serializer|dto|model|repository|repo|dao|db|database|migration|migrations|sql|query|orm|prisma|sequelize|typeorm|mongoose)([/_.-]|$)/i;
const NETWORK_RE = /(^|[/_.-])(http|https|url|uri|fetch|client|proxy|redirect|ssrf)([/_.-]|$)/i;

const SECURITY_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.go', '.java', '.cs', '.rb', '.php', '.rs']);

const REVIEWERS = {
  clean: {
    agent: 'clean-code-reviewer',
    verdict: 'clean-code-verdict.json',
    prompt: 'Review the diff for correctness, clean-code/SOLID violations, test adequacy, and unnecessary complexity in the files above. Use the review context pack if present; do not re-read unrelated files.',
  },
  security: {
    agent: 'security-reviewer',
    verdict: 'security-verdict.json',
    prompt: 'Scan only the changed security/API/data-boundary diff for OWASP/security issues in the files above. Use the review context pack if present; do not re-read unrelated files.',
  },
};

function normalizeFile(file) {
  return String(file || '').replace(/\\/g, '/');
}

function uniqueFiles(entries) {
  return [...new Set(entries.map((e) => normalizeFile(e.file)).filter(Boolean))];
}

function touchesSecurityBoundary(file) {
  const f = normalizeFile(file);
  const ext = path.extname(f).toLowerCase();
  if (!SECURITY_EXTS.has(ext)) return false;
  return SECURITY_RE.test(f) || DATA_RE.test(f) || NETWORK_RE.test(f);
}

function classifyScope(files) {
  if (files.length <= 3) return 'tiny';
  if (files.length <= 12) return 'normal';
  return 'large';
}

function reviewPolicy(entries) {
  const files = uniqueFiles(entries);
  const securityFiles = files.filter(touchesSecurityBoundary);
  const scope = classifyScope(files);
  const required = [REVIEWERS.clean];
  const reasons = ['quality review is required for production-code writes'];

  if (securityFiles.length > 0) {
    required.push(REVIEWERS.security);
    reasons.push(`security/data/API boundary touched: ${securityFiles.join(', ')}`);
  }

  return {
    scope,
    files,
    securityFiles,
    required,
    reasons,
  };
}

function renderContextPack(policy) {
  return [
    '# Review Context Pack',
    '',
    `Scope: ${policy.scope}`,
    `Files: ${policy.files.length}`,
    '',
    '## Changed Files',
    ...policy.files.map((f) => `- ${f}`),
    '',
    '## Required Reviewers',
    ...policy.required.map((r) => `- ${r.agent}`),
    '',
    '## Routing Reasons',
    ...policy.reasons.map((r) => `- ${r}`),
    '',
    '## Reviewer Rules',
    '- Review only the acceptance criteria, final diff, test output, this context pack, and directly touched files.',
    '- Do not summarize the implementation.',
    '- Return only BLOCK/WARN/INFO findings with concrete file references.',
    '- Escalate to specialist review only when a touched file crosses that specialist boundary.',
    '',
  ].join('\n');
}

module.exports = {
  reviewPolicy,
  renderContextPack,
  touchesSecurityBoundary,
};
