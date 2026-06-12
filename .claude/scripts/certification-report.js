#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const STATUS_PATH = path.join(ROOT, '.claude', 'certification', 'status.json');

function loadStatus() {
  return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
}

function formatCapability(name, entry) {
  return `${name.padEnd(24)} ${entry.status.padEnd(16)} ${entry.rationale}`;
}

function main() {
  const status = loadStatus();
  const lines = [
    'Certification Status',
    `Generated: ${status.generated_at}`,
    `Overall: ${status.summary.overall_status}`,
    '',
    status.summary.position,
    '',
    'Capability               Status           Rationale',
    '------------------------ ---------------- ----------------------------------------',
  ];

  for (const [name, entry] of Object.entries(status.capabilities)) {
    lines.push(formatCapability(name, entry));
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

if (require.main === module) {
  main();
}

module.exports = { formatCapability, loadStatus };
