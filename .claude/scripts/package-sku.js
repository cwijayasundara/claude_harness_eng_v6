#!/usr/bin/env node

'use strict';

// Emit installable SKU trees for harness-core / harness-lite (Phase 3 packaging).
// Does not publish to a marketplace — produces a local directory you can point
// claude --plugin-dir at, or zip for distribution.
//
// Usage:
//   node .claude/scripts/package-sku.js core|lite|full|all [--out dir] [--clean]
//
// Defaults: --out <repo>/dist/skus

const fs = require('fs');
const path = require('path');
const {
  copyScaffoldTree,
  resolveScaffoldProfile,
  CORE_SKILLS,
  OPTIONAL_SKILLS,
} = require('./scaffold-copy');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PLUGIN_SOURCE = path.join(REPO_ROOT, '.claude');
const LITE_SOURCE = path.join(REPO_ROOT, 'harness-lite');

const SKU_META = {
  core: {
    dirName: 'harness-core',
    pluginName: 'claude-harness-core',
    description:
      'Lean product harness: /build, /feature, /gate, brownfield spine. No vertical/framework optional skills.',
    profile: 'core',
  },
  full: {
    dirName: 'harness-full',
    pluginName: 'claude-harness-full',
    description:
      'Full harness surface including optional skills, workflows slot, and ops extras.',
    profile: 'full',
  },
  lite: {
    dirName: 'harness-lite',
    pluginName: 'claude-harness-lite',
    description:
      'Artifact-only loadout: mockups, ARB docs, research. No SDLC pipeline or quality hooks.',
    profile: null, // special: copy harness-lite/
  },
};

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  return argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}

function readRootVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

function writePluginJson(skuRoot, meta, version) {
  // Claude plugin dir is the folder containing .claude-plugin/plugin.json
  // For core/full we emit a ready-to-load .claude tree; plugin.json lives inside it.
  const pluginDir = path.join(skuRoot, '.claude-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  const body = {
    name: meta.pluginName,
    version,
    description: meta.description,
    author: { name: 'Claude Harness Engine' },
    sku: meta.dirName,
  };
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), `${JSON.stringify(body, null, 2)}\n`);
}

function packageCoreOrFull(sku, outRoot, version) {
  const meta = SKU_META[sku];
  const dest = path.join(outRoot, meta.dirName);
  fs.mkdirSync(dest, { recursive: true });
  // copyScaffoldTree writes into <target>/.claude — for a plugin-dir loadout we
  // want the contents of .claude at the package root (claude --plugin-dir <pkg>).
  const staging = path.join(dest, '_staging');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const profile = resolveScaffoldProfile({}, { scaffoldProfile: meta.profile });
  copyScaffoldTree(PLUGIN_SOURCE, staging, profile);
  // Move staged .claude/* up to package root
  const stagedClaude = path.join(staging, '.claude');
  for (const entry of fs.readdirSync(stagedClaude)) {
    fs.cpSync(path.join(stagedClaude, entry), path.join(dest, entry), { recursive: true });
  }
  fs.rmSync(staging, { recursive: true, force: true });
  writePluginJson(dest, meta, version);
  // Manifest stamp for humans
  fs.writeFileSync(
    path.join(dest, 'SKU.md'),
    `# ${meta.dirName}\n\n${meta.description}\n\nVersion: ${version}\nProfile: ${meta.profile}\n\n` +
      `Load: \`claude --plugin-dir ${meta.dirName}\`\n` +
      (sku === 'core'
        ? `\nCore skills (${CORE_SKILLS.length}). Optional not included: ${OPTIONAL_SKILLS.join(', ')}.\n`
        : '')
  );
  return dest;
}

function packageLite(outRoot, version) {
  const meta = SKU_META.lite;
  const dest = path.join(outRoot, meta.dirName);
  fs.rmSync(dest, { recursive: true, force: true });
  if (!fs.existsSync(LITE_SOURCE)) {
    throw new Error(`harness-lite source missing at ${LITE_SOURCE}`);
  }
  // lite lives as harness-lite/.claude — emit flat plugin dir
  const liteClaude = path.join(LITE_SOURCE, '.claude');
  const litePlugin = path.join(LITE_SOURCE, '.claude-plugin');
  fs.mkdirSync(dest, { recursive: true });
  if (fs.existsSync(liteClaude)) {
    for (const entry of fs.readdirSync(liteClaude)) {
      fs.cpSync(path.join(liteClaude, entry), path.join(dest, entry), { recursive: true });
    }
  }
  // Prefer packaging SKU metadata; fall back to source plugin.json fields
  let description = meta.description;
  try {
    const src = JSON.parse(fs.readFileSync(path.join(litePlugin, 'plugin.json'), 'utf8'));
    if (src.description) description = src.description;
  } catch (_) { /* use default */ }
  writePluginJson(dest, { ...meta, description }, version);
  fs.writeFileSync(
    path.join(dest, 'SKU.md'),
    `# harness-lite\n\n${description}\n\nVersion: ${version}\n\nLoad: \`claude --plugin-dir harness-lite\`\n`
  );
  // README for operators
  if (fs.existsSync(path.join(LITE_SOURCE, 'README.md'))) {
    fs.copyFileSync(path.join(LITE_SOURCE, 'README.md'), path.join(dest, 'README.md'));
  }
  return dest;
}

function packageSku(sku, outRoot, version) {
  if (sku === 'lite') return packageLite(outRoot, version);
  if (sku === 'core' || sku === 'full') return packageCoreOrFull(sku, outRoot, version);
  throw new Error(`unknown sku: ${sku} (expected core|lite|full)`);
}

function main(argv = process.argv.slice(2)) {
  const which = (argv[0] || 'all').toLowerCase();
  const outRoot = path.resolve(arg(argv, '--out', path.join(REPO_ROOT, 'dist', 'skus')));
  const clean = argv.includes('--clean');
  const version = readRootVersion();

  if (!['core', 'lite', 'full', 'all'].includes(which)) {
    process.stderr.write('Usage: package-sku.js core|lite|full|all [--out dir] [--clean]\n');
    process.exit(2);
  }

  if (clean && fs.existsSync(outRoot)) {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(outRoot, { recursive: true });

  const skus = which === 'all' ? ['core', 'lite', 'full'] : [which];
  const results = [];
  for (const sku of skus) {
    const dest = packageSku(sku, outRoot, version);
    results.push({ sku, dest });
    process.stdout.write(`package-sku: ${sku} -> ${dest}\n`);
  }
  process.stdout.write(`package-sku: done (${results.length} sku(s), version ${version})\n`);
  process.exit(0);
}

module.exports = {
  packageSku,
  SKU_META,
  readRootVersion,
  REPO_ROOT,
};

if (require.main === module) main();
