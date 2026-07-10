#!/usr/bin/env node

'use strict';

// Build SKU trees and tarballs under dist/release/ for GitHub Releases.
//
// Usage:
//   node .claude/scripts/release-skus.js
//   npm run release:skus

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { packageSku, readRootVersion, SKU_META } = require('./package-sku');

const REPO = path.resolve(__dirname, '..', '..');

function main() {
  const version = readRootVersion();
  const outRoot = path.join(REPO, 'dist', 'skus');
  const releaseDir = path.join(REPO, 'dist', 'release');
  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(outRoot, { recursive: true });
  fs.mkdirSync(releaseDir, { recursive: true });

  const skus = ['core', 'lite', 'full'];
  for (const sku of skus) {
    packageSku(sku, outRoot, version);
  }

  const tarballs = [];
  for (const sku of skus) {
    const dirName = SKU_META[sku].dirName;
    const tgz = path.join(releaseDir, `claude-harness-${sku}-${version}.tgz`);
    const r = spawnSync(
      'tar',
      ['-czf', tgz, '-C', outRoot, dirName],
      { encoding: 'utf8' }
    );
    if (r.status !== 0) {
      process.stderr.write(r.stderr || r.stdout || 'tar failed\n');
      process.exit(r.status || 1);
    }
    tarballs.push(tgz);
    process.stdout.write(`release-skus: ${path.relative(REPO, tgz)}\n`);
  }

  process.stdout.write(
    `release-skus: done v${version} (${tarballs.length} tarballs in dist/release/)\n` +
      'Publish: gh release create v' + version + ' dist/release/*.tgz --notes-file CHANGELOG.md\n'
  );
  process.exit(0);
}

if (require.main === module) main();
