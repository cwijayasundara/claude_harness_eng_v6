'use strict';

const path = require('path');

// Secret patterns: [label, RegExp] — all use the global flag for matchAll
const SECRET_PATTERNS = [
  ['AWS Access Key',     /AKIA[0-9A-Z]{16}/g],
  ['GitHub Token',       /gh[pousr]_[^\s"'`]{1,}/g],
  ['Anthropic Key',      /sk-ant-[^\s"'`]{1,}/g],
  ['OpenAI Key',         /sk-[a-zA-Z0-9]{20,}/g],
  ['Slack Token',        /xox[baprs]-[^\s"'`]{1,}/g],
  ['Private Key Block',  /-----BEGIN .* PRIVATE KEY-----/g],
  ['Connection String',  /:\/\/[^:]+:[^@]+@/g],
  ['SSN',                /\b\d{3}-\d{2}-\d{4}\b/g],
];

const EXEMPT_BASENAMES = new Set(['.env.example', 'settings.json', 'settings.local.json']);

function redact(value) {
  // Fixed short prefix regardless of length — never reveal more than the first
  // 4 chars of a matched secret (a longer prefix can leak a connection-string
  // username or the start of a password).
  return value.substring(0, 4) + '...';
}

// projectDir anchors the directory exemption to the HARNESS's own .claude tree
// (hooks/evals/templates legitimately carry secret-shaped fixtures). A bare
// substring match on `/hooks/` or `/templates/` would exempt an app's own
// src/hooks/ or src/templates/ — a real secret-leak hole.
function secretScanExempt(filePath, projectDir) {
  if (path.extname(filePath).toLowerCase() === '.md') return true;
  if (EXEMPT_BASENAMES.has(path.basename(filePath))) return true;
  if (!projectDir) return false;
  const n = path.resolve(filePath).replace(/\\/g, '/');
  const claude = path.resolve(projectDir).replace(/\\/g, '/') + '/.claude/';
  if (!n.startsWith(claude)) return false;
  const rel = n.slice(claude.length);
  return rel.startsWith('hooks/') || rel.startsWith('evals/') || rel.startsWith('templates/');
}

// A line carrying this marker is an explicit, greppable, reviewer-visible
// exception (e.g. a test fixture whose whole purpose is to feed a
// secret-shaped string to a parser/validator). It suppresses findings on THAT
// line only — never a whole file — the same trust model as `harness:stub-ok`.
// No secret pattern matches across a newline, so per-line scanning is
// behaviour-identical to whole-content scanning for every unmarked line.
const SECRET_OK_MARKER = /harness:secret-ok/;

function scanSecrets(content) {
  const findings = [];
  for (const line of String(content).split('\n')) {
    if (SECRET_OK_MARKER.test(line)) continue;
    for (const [label, pattern] of SECRET_PATTERNS) {
      for (const match of line.matchAll(pattern)) {
        findings.push({ label, value: redact(match[0]) });
      }
    }
  }
  return findings;
}

// .env, .env.local, .env.production, … but NOT .env.example
function isProtectedEnvFile(filePath) {
  const filename = path.basename(filePath);
  if (filename === '.env.example') return false;
  return /^\.env(\..+)?$/.test(filename);
}

module.exports = { scanSecrets, secretScanExempt, isProtectedEnvFile };
