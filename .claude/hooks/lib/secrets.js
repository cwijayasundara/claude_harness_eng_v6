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
  return value.substring(0, value.length <= 10 ? 4 : 10) + '...';
}

function secretScanExempt(filePath) {
  if (path.extname(filePath).toLowerCase() === '.md') return true;
  if (EXEMPT_BASENAMES.has(path.basename(filePath))) return true;
  const n = path.resolve(filePath).replace(/\\/g, '/');
  return n.includes('/hooks/') || n.includes('/evals/') || n.includes('/templates/');
}

function scanSecrets(content) {
  const findings = [];
  for (const [label, pattern] of SECRET_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      findings.push({ label, value: redact(match[0]) });
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
