'use strict';

// Security/data/API boundary classifier — shared by security-scan.js (the
// computational security scan's --boundary-only file filter) so there is one
// source of truth for "does this file cross a security boundary" instead of
// two regex sets drifting apart. Previously also backed a per-turn reviewer
// spawn policy for the Stop hook; that policy was removed (all reviewers now
// run only at pre-PR checkpoints), leaving this module scoped to the
// boundary classifier alone.

const path = require('path');

const SECURITY_RE = /(^|[/_.-])(auth|authz|login|logout|session|cookie|csrf|cors|jwt|oauth|saml|token|permission|permissions|role|roles|policy|acl|secret|password|passwd|credential|credentials|crypto|encrypt|decrypt|hash|upload|download|webhook|payment|billing|invoice|checkout|pii|privacy)([/_.-]|$)/i;
const DATA_RE = /(^|[/_.-])(api|route|router|controller|middleware|request|response|server|handler|endpoint|schema|serializer|dto|model|repository|repo|dao|db|database|migration|migrations|sql|query|orm|prisma|sequelize|typeorm|mongoose)([/_.-]|$)/i;
const NETWORK_RE = /(^|[/_.-])(http|https|url|uri|fetch|client|proxy|redirect|ssrf)([/_.-]|$)/i;

const SECURITY_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.go', '.java', '.cs', '.rb', '.php', '.rs']);

function normalizeFile(file) {
  return String(file || '').replace(/\\/g, '/');
}

function touchesSecurityBoundary(file) {
  const f = normalizeFile(file);
  const ext = path.extname(f).toLowerCase();
  if (!SECURITY_EXTS.has(ext)) return false;
  return SECURITY_RE.test(f) || DATA_RE.test(f) || NETWORK_RE.test(f);
}

module.exports = {
  touchesSecurityBoundary,
};
