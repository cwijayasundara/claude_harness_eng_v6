#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_LINES_ITERATION_LOG = 500;
const MAX_LINES_LEARNED_RULES = 200;
const MAX_SIZE_TELEMETRY_MB = 10;

function findProjectDir(startDir) {
  let cur = startDir;
  while (true) {
    if (fs.existsSync(path.join(cur, '.claude'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function archiveByLines(filePath, maxLines, archiveDir) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  if (lines.length <= maxLines) return null;

  const keepLines = lines.slice(-maxLines);
  const archiveLines = lines.slice(0, lines.length - maxLines);

  const basename = path.basename(filePath, path.extname(filePath));
  const ext = path.extname(filePath);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archivePath = path.join(archiveDir, `${basename}-${ts}${ext}`);

  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(archivePath, archiveLines.join('\n') + '\n');
  fs.writeFileSync(filePath, keepLines.join('\n'));

  return { archived: archiveLines.length, kept: keepLines.length, archivePath };
}

function archiveBySize(filePath, maxSizeMB, archiveDir) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  const sizeMB = stat.size / (1024 * 1024);
  if (sizeMB <= maxSizeMB) return null;

  const basename = path.basename(filePath, path.extname(filePath));
  const ext = path.extname(filePath);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archivePath = path.join(archiveDir, `${basename}-${ts}${ext}`);

  fs.mkdirSync(archiveDir, { recursive: true });
  fs.renameSync(filePath, archivePath);
  fs.writeFileSync(filePath, '');

  return { archivedSizeMB: sizeMB.toFixed(1), archivePath };
}

const projectDir = findProjectDir(process.cwd());
if (!projectDir) {
  console.log('No .claude/ directory found.');
  process.exit(1);
}

const stateDir = path.join(projectDir, '.claude', 'state');
const archiveDir = path.join(stateDir, 'archive');
const results = [];

const iterResult = archiveByLines(
  path.join(stateDir, 'iteration-log.md'),
  MAX_LINES_ITERATION_LOG,
  archiveDir
);
if (iterResult) {
  results.push(`iteration-log.md: archived ${iterResult.archived} lines -> ${iterResult.archivePath}`);
}

const rulesResult = archiveByLines(
  path.join(stateDir, 'learned-rules.md'),
  MAX_LINES_LEARNED_RULES,
  archiveDir
);
if (rulesResult) {
  results.push(`learned-rules.md: archived ${rulesResult.archived} lines -> ${rulesResult.archivePath}`);
}

const telResult = archiveBySize(
  path.join(stateDir, 'telemetry-ledger.jsonl'),
  MAX_SIZE_TELEMETRY_MB,
  archiveDir
);
if (telResult) {
  results.push(`telemetry-ledger.jsonl: archived ${telResult.archivedSizeMB}MB -> ${telResult.archivePath}`);
}

if (results.length === 0) {
  console.log('All state files within limits. No archival needed.');
} else {
  console.log('State archival complete:');
  results.forEach(r => console.log(`  ${r}`));
}
