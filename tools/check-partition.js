#!/usr/bin/env node
'use strict';

// The single structural rule of the v6 reduction:
//
//   A kernel unit may not hard-reference a pack unit.
//
// "Hard" means executable coupling — require(), `node .claude/scripts/x.js`,
// `npm run x`, or a subagent_type dispatch. Breaking a hard edge breaks the unit.
// Prose routing ("escalate to /design") is a SOFT edge: breaking it degrades to
// "that lane isn't installed", which is exactly what an uninstalled pack should do.
//
// This is deliberately the only structural gate in the reduction. One rule that
// holds is worth more than a taxonomy that doesn't.
//
//   node tools/check-partition.js            report
//   node tools/check-partition.js --strict   exit 1 on any kernel -> pack edge

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PARTITION = path.join(ROOT, 'docs', 'internal', 'v6-partition.json');

const KINDS = ['skill', 'agent', 'hook', 'lib', 'script', 'githook'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The shape of an executable reference, per unit kind. Anything not matched here
// is a soft edge by construction.
function hardRefPattern(kind, name) {
  const n = escapeRe(name);
  switch (kind) {
    case 'script':
      return new RegExp(`require\\([^)]*['"][^'"]*${n}['"]|scripts/${n}\\.js|npm run [\\w:-]*\\b${n}\\b`);
    case 'lib':
      return new RegExp(`require\\([^)]*['"][^'"]*${n}['"]|lib/${n}\\b`);
    case 'hook':
      return new RegExp(`hooks/${n}\\.js`);
    case 'githook':
      return new RegExp(`git-hooks/${n}\\b`);
    case 'agent':
      return new RegExp(`subagent_type[^\\n]{0,60}\\b${n}\\b|agents/${n}\\.md`, 'i');
    case 'skill':
      return new RegExp(`skills/${n}[/'"]|Skill\\([^)]*['"]${n}['"]`, 'i');
    default:
      return null;
  }
}

// An OPTIONAL reference is one the caller already survives the absence of. Two forms:
//
//   packRun('<module>', fn, '<pack>')    an explicit lazy-dispatch declaration
//   try ... require(...) ... catch       a guarded load whose failure is handled
//
// Both mean "this dependency may be missing at runtime", which is exactly what an
// uninstalled pack looks like. Counting them as violations would force rewriting code
// that is already correct — context-pack.js, for instance, already loads the whole nav
// stack through a guarded loader that returns null, with every call site checking.
//
// Deliberately narrow: a bare top-level require() is never optional, so the exemption
// cannot be claimed by accident.
const OPEN_BRACE = '{';
const CLOSE_BRACE = '}';
const PACKRUN_DECL = /packRun\(\s*['"]([^'"]+)['"]/g;
const REQUIRE_SPEC = /require\(\s*['"]([^'"]+)['"]/g;
const TRY_OPEN = new RegExp('\\btry\\s*\\' + OPEN_BRACE, 'g');

const specName = (spec) => String(spec).replace(/\.js$/, '').split('/').pop();

// Spans of try-block bodies, located by brace matching from each try.
function tryBlockSpans(text) {
  const spans = [];
  let m;
  TRY_OPEN.lastIndex = 0;
  while ((m = TRY_OPEN.exec(text)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < text.length; i++) {
      if (text[i] === OPEN_BRACE) depth++;
      else if (text[i] === CLOSE_BRACE && --depth === 0) break;
    }
    spans.push([m.index, i]);
  }
  return spans;
}

function optionalRefs(text) {
  const out = new Set();
  for (const m of text.matchAll(PACKRUN_DECL)) out.add(specName(m[1]));
  for (const [start, end] of tryBlockSpans(text)) {
    for (const m of text.slice(start, end).matchAll(REQUIRE_SPEC)) out.add(specName(m[1]));
  }
  return out;
}

function hardRefs(text, names, optional = new Set()) {
  const found = [];
  for (const kind of KINDS) {
    for (const name of names[kind] || []) {
      if (optional.has(name)) continue;
      const re = hardRefPattern(kind, name);
      if (re && re.test(text)) found.push(`${kind}:${name}`);
    }
  }
  return found;
}

// Kernel -> pack edges that ARE guarded. Not violations, but still worth showing:
// each one is a pack the kernel knows about, and the count should trend to zero.
function guardedEdges(from, optionalNames, ids, assign) {
  const out = [];
  for (const name of optionalNames) {
    const to = ids.find((id) => id.endsWith(`:${name}`));
    const target = to && assign[to];
    if (target && target !== 'kernel') out.push({ from, to, pack: target });
  }
  return out;
}

// Pure core, so the rule is testable without touching disk.
function checkPartition({ assign, texts, names }) {
  const ids = Object.keys(assign);
  if (ids.length === 0) {
    // A checker that reports "clean" on empty input is worse than no checker:
    // a mis-wired path would read as a passing gate.
    throw new Error('check-partition: no units to check — refusing to report a vacuous pass');
  }
  const violations = [];
  const crossPack = [];
  const optional = [];
  for (const from of ids) {
    const home = assign[from];
    if (!texts[from]) continue;
    const opt = optionalRefs(texts[from]);
    for (const to of hardRefs(texts[from], names, opt)) {
      const target = assign[to];
      if (to === from || !target || target === home) continue;
      if (home === 'kernel') violations.push({ from, to, pack: target });
      else if (target !== 'kernel') crossPack.push({ from, fromPack: home, to, toPack: target });
    }
    if (home === 'kernel') optional.push(...guardedEdges(from, opt, ids, assign));
  }
  return { violations, crossPack, optional, units: ids.length };
}

// ---- disk wiring ----

function walk(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, acc) : acc.push(p);
  }
  return acc;
}

const readUnit = (files) => files.map((f) => {
  try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
}).join('\n');

function loadAssignment(partition) {
  const assign = {};
  for (const [kind, list] of Object.entries(partition.kernel)) {
    for (const n of list) assign[`${kind}:${n}`] = 'kernel';
  }
  for (const [pack, spec] of Object.entries(partition.packs)) {
    for (const kind of KINDS) for (const n of spec[kind] || []) assign[`${kind}:${n}`] = pack;
  }
  return assign;
}

function loadUnitTexts() {
  const c = (...p) => path.join(ROOT, '.claude', ...p);
  const texts = {}, names = {};
  const put = (kind, name, files) => {
    (names[kind] = names[kind] || []).push(name);
    texts[`${kind}:${name}`] = readUnit(files);
  };
  const dirEntries = (d, fn) => fs.readdirSync(c(d)).forEach(fn);
  dirEntries('skills', (s) => { if (fs.statSync(c('skills', s)).isDirectory()) put('skill', s, walk(c('skills', s))); });
  dirEntries('agents', (a) => { if (a.endsWith('.md')) put('agent', a.slice(0, -3), [c('agents', a)]); });
  dirEntries('hooks', (h) => { if (h.endsWith('.js')) put('hook', h.slice(0, -3), [c('hooks', h)]); });
  dirEntries('scripts', (s) => { if (s.endsWith('.js')) put('script', s.slice(0, -3), [c('scripts', s)]); });
  fs.readdirSync(c('hooks', 'lib')).forEach((l) => { if (l.endsWith('.js')) put('lib', l.slice(0, -3), [c('hooks', 'lib', l)]); });
  dirEntries('git-hooks', (g) => { if (fs.statSync(c('git-hooks', g)).isFile()) put('githook', g, [c('git-hooks', g)]); });
  return { texts, names };
}

function reportCrossPack(crossPack) {
  if (!crossPack.length) return;
  const pairs = {};
  for (const e of crossPack) {
    const k = `${e.fromPack} -> ${e.toPack}`;
    pairs[k] = (pairs[k] || 0) + 1;
  }
  console.log(`\ncross-pack edges (allowed, but each is a coupling to retire): ${crossPack.length}`);
  Object.entries(pairs).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
}

function reportViolations(violations) {
  const byPack = {};
  for (const v of violations) (byPack[v.pack] = byPack[v.pack] || []).push(v);
  console.log(`\nKERNEL -> PACK violations: ${violations.length}`);
  for (const [pack, list] of Object.entries(byPack).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${pack} (${list.length})`);
    for (const v of list) console.log(`    ${v.from}  ->  ${v.to}`);
  }
  console.log(
    '\nEach line is a kernel unit that cannot run without that pack installed.\n' +
    'Resolve by: moving the caller into the pack, moving the callee into the kernel,\n' +
    'or making the call optional (degrade when the pack is absent).'
  );
}

function main() {
  const partition = JSON.parse(fs.readFileSync(PARTITION, 'utf8'));
  const assign = loadAssignment(partition);
  const { texts, names } = loadUnitTexts();
  const { violations, crossPack, optional, units } = checkPartition({ assign, texts, names });

  const counts = {};
  for (const v of Object.values(assign)) counts[v] = (counts[v] || 0) + 1;
  console.log(`partition: ${units} units — ` +
    Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));

  if (optional.length) {
    console.log(`\nkernel -> pack edges already guarded (lazy/try-catch, not violations): ${optional.length}`);
    for (const e of optional) console.log(`    ${e.from}  ~>  ${e.to}  [${e.pack}]`);
  }
  reportCrossPack(crossPack);
  if (!violations.length) {
    console.log('\nOK: no kernel -> pack hard references.');
    return 0;
  }
  reportViolations(violations);
  return process.argv.includes('--strict') ? 1 : 0;
}

if (require.main === module) process.exit(main());

module.exports = { hardRefs, checkPartition };
