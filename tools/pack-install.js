#!/usr/bin/env node
'use strict';

// Materialize an install from docs/internal/v6-partition.json.
//
// The partition declares which units are kernel and which belong to each pack, and
// tools/check-partition.js proves the kernel never hard-references a pack. This turns
// that from a measurement into a deliverable: a tree containing the kernel plus only
// the packs you asked for.
//
// Why compose a tree rather than move files into packs/ in the repo: pack modules are
// required by relative path (`./gates-planning`, `../scripts/x`) and pack code
// legitimately reaches BACK into the kernel (gates-planning needs pre-commit-util).
// Relocating them in-repo would break every one of those requires and buy nothing —
// what ships is a single .claude tree either way. Composition keeps development flat
// and makes the install lean, which is the property that was actually wanted.
//
//   node tools/pack-install.js --out <dir> [--packs a,b] [--list]
//   node tools/pack-install.js --list                    # what each pack would add

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PARTITION = path.join(ROOT, 'docs', 'internal', 'v6-partition.json');

// Where each unit kind lives, and how its name maps to a path. Directories (skills)
// copy whole; everything else is a single file.
const KIND_PATHS = {
  skill: (n) => `.claude/skills/${n}`,
  agent: (n) => `.claude/agents/${n}.md`,
  hook: (n) => `.claude/hooks/${n}.js`,
  lib: (n) => `.claude/hooks/lib/${n}.js`,
  script: (n) => `.claude/scripts/${n}.js`,
  githook: (n) => `.claude/git-hooks/${n}`,
};

// Files every install needs regardless of pack selection: the plugin manifest, the
// settings that wire the hooks, and the data the kernel scripts read.
const ALWAYS = [
  '.claude/.claude-plugin',
  '.claude/settings.json',
  '.claude/config',
  '.claude/templates/state-seeds',
  // Support modules for the git hooks. The partition's `githook` kind names the hook
  // entry points only, so this tree is not reachable from it — a kernel-only install
  // built without it loaded the hooks fine and then failed inside gate-registry.
  '.claude/git-hooks/lib',
];

// Directories whose contents should be accounted for by the partition. Anything here
// that is neither declared nor covered by ALWAYS is a hole: it would be missing from
// a composed install, and check-partition cannot see it either.
const ACCOUNTED_DIRS = [
  ['.claude/hooks/lib', 'lib'],
  ['.claude/scripts', 'script'],
  ['.claude/agents', 'agent'],
];

function loadPartition(file = PARTITION) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function mergeSpec(into, spec) {
  for (const [kind, names] of Object.entries(spec)) {
    if (!Array.isArray(names)) continue;
    into[kind] = into[kind] || [];
    for (const n of names) if (!into[kind].includes(n)) into[kind].push(n);
  }
}

// The kernel is always included; named packs are layered on top. An unknown name is
// an error, not a no-op — silently installing less than asked for is how a "lean"
// install becomes a broken one.
function resolveSelection(partition, packs = []) {
  const out = {};
  mergeSpec(out, partition.kernel);
  for (const name of packs) {
    if (name === 'kernel') continue;
    if (!partition.packs[name]) {
      throw new Error(`unknown pack: ${name} (have: ${Object.keys(partition.packs).join(', ')})`);
    }
    mergeSpec(out, partition.packs[name]);
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

function filesFor(selection) {
  const out = [];
  for (const [kind, names] of Object.entries(selection)) {
    if (!Array.isArray(names)) continue;
    const toPath = KIND_PATHS[kind];
    if (!toPath) throw new Error(`unknown unit kind: ${kind}`);
    for (const n of names) out.push(toPath(n));
  }
  return out;
}

function copyRecursive(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from)) copyRecursive(path.join(from, e), path.join(to, e));
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function materialize(outDir, rels) {
  let copied = 0;
  const missing = [];
  for (const rel of rels) {
    const from = path.join(ROOT, rel);
    if (!fs.existsSync(from)) { missing.push(rel); continue; }
    copyRecursive(from, path.join(outDir, rel));
    copied += 1;
  }
  return { copied, missing };
}

// Every unit the partition declares, across kernel and all packs.
function declaredNames(partition) {
  const out = {};
  const add = (spec) => {
    for (const [kind, names] of Object.entries(spec)) {
      if (!Array.isArray(names)) continue;
      out[kind] = out[kind] || new Set();
      for (const n of names) out[kind].add(n);
    }
  };
  add(partition.kernel);
  for (const spec of Object.values(partition.packs)) add(spec);
  return out;
}

// Files on disk that no pack claims. These are invisible to check-partition (it walks
// the same dirs but only reports edges) and would silently vanish from a composed
// install, so they are surfaced rather than assumed intentional.
function undeclaredUnits(partition, root = ROOT) {
  const declared = declaredNames(partition);
  const holes = [];
  for (const [dir, kind] of ACCOUNTED_DIRS) {
    let entries;
    try { entries = fs.readdirSync(path.join(root, dir)); } catch { continue; }
    for (const e of entries) {
      if (!e.endsWith('.js') && !e.endsWith('.md')) continue;
      const name = e.replace(/\.(js|md)$/, '');
      if (!(declared[kind] && declared[kind].has(name))) holes.push(`${dir}/${e}`);
    }
  }
  return holes;
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
}

function listPacks(partition) {
  const kernelCount = Object.values(partition.kernel).reduce((a, l) => a + l.length, 0);
  console.log(`kernel: ${kernelCount} units (always installed)`);
  for (const [name, spec] of Object.entries(partition.packs)) {
    const n = Object.values(spec).filter(Array.isArray).reduce((a, l) => a + l.length, 0);
    console.log(`  ${name.padEnd(20)} +${String(n).padStart(3)} units — ${spec.why || ''}`.trimEnd());
  }
}

function main(argv = process.argv.slice(2)) {
  const partition = loadPartition();
  if (argv.includes('--list')) { listPacks(partition); return 0; }

  const outDir = argValue(argv, '--out');
  if (!outDir) { console.error('usage: pack-install.js --out <dir> [--packs a,b] | --list'); return 2; }
  const packs = (argValue(argv, '--packs') || '').split(',').map((s) => s.trim()).filter(Boolean);

  const selection = resolveSelection(partition, packs);
  const rels = [...ALWAYS, ...filesFor(selection)];
  const { copied, missing } = materialize(outDir, rels);

  const holes = undeclaredUnits(partition);
  const units = Object.values(selection).reduce((a, l) => a + l.length, 0);
  console.log(`pack-install: ${units} units (kernel${packs.length ? ' + ' + packs.join(' + ') : ' only'}) -> ${outDir}`);
  console.log(`  copied ${copied} path(s)`);
  if (holes.length) {
    console.log(`  WARNING: ${holes.length} file(s) on disk that no pack declares — they ship in no install:`);
    for (const h of holes) console.log(`    ${h}`);
  }
  if (missing.length) {
    // A declared unit with no file on disk means the partition and the tree disagree.
    // Reported, never skipped silently — that gap is exactly how an install ends up
    // missing a gate nobody notices.
    console.log(`  WARNING: ${missing.length} declared unit(s) not found on disk:`);
    for (const m of missing) console.log(`    ${m}`);
    return 1;
  }
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { resolveSelection, filesFor, loadPartition, materialize, undeclaredUnits };
