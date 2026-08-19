#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/matrix-append.js --incoming PATH [--sprint N] [--root DIR]
// Merges incoming matrix rows into specs/test_artefacts/verification-matrix.json
// and copies the incoming file to specs/test_artefacts/sprint-N/ when sprint is set.

const fs = require('fs');
const path = require('path');
const { appendMatrix } = require('../hooks/lib/matrix-append');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 || argv[i + 1] === undefined ? fallback : String(argv[i + 1]);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function run(argv = process.argv.slice(2), cwd = process.cwd()) {
  const root = path.resolve(cwd, arg(argv, '--root', cwd));
  const incomingPath = arg(argv, '--incoming', null);
  if (!incomingPath) {
    process.stderr.write('matrix-append: --incoming <file> is required\n');
    return 2;
  }
  const sprintRaw = arg(argv, '--sprint', null);
  const sprint = sprintRaw ? Number(sprintRaw) : null;
  const livingPath = path.join(root, 'specs', 'test_artefacts', 'verification-matrix.json');
  const incomingAbs = path.resolve(root, incomingPath);
  const incoming = readJson(incomingAbs, null);
  if (!incoming) {
    process.stderr.write(`matrix-append: cannot read ${incomingPath}\n`);
    return 1;
  }
  const living = readJson(livingPath, { version: 1, requirements: [] });
  const result = appendMatrix(living, incoming, { sprint: Number.isFinite(sprint) ? sprint : undefined });
  fs.mkdirSync(path.dirname(livingPath), { recursive: true });
  fs.writeFileSync(livingPath, `${JSON.stringify(result.matrix, null, 2)}\n`);
  if (Number.isFinite(sprint) && sprint > 0) {
    const destDir = path.join(root, 'specs', 'test_artefacts', `sprint-${sprint}`);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(incomingAbs, path.join(destDir, 'verification-matrix.json'));
  }
  process.stdout.write(
    `matrix-append: added ${result.added.length} superseded ${result.superseded.length}\n`,
  );
  return 0;
}

module.exports = { run };

if (require.main === module) {
  try {
    process.exit(run());
  } catch (err) {
    process.stderr.write(`matrix-append: ${err.message}\n`);
    process.exit(2);
  }
}
