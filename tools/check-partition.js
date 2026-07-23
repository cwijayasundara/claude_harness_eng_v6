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

const { printReport, computeProfileBreaks } = require('./partition-report');

const ROOT = path.resolve(__dirname, '..');
const PARTITION = path.join(ROOT, '.claude', 'config', 'packs.json');

const KINDS = ['skill', 'agent', 'hook', 'lib', 'script', 'githook'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The test for a HARD reference is: would this break if the target were absent?
//
// That distinction matters because the harness is full of references that merely
// MENTION a pack unit — a remediation string ("Check: node .claude/scripts/x.js"),
// a doc cross-reference ("see .claude/skills/x/SKILL.md"), a description in prose.
// If the pack is uninstalled those become a stale message, not a crash, so they are
// soft. Counting them would force rewriting correct code to satisfy the checker.
//
// The shape of a breaking reference differs by who is doing the referencing:
//
//   CODE units (lib, script, hook) break on require()/spawn of a missing module.
//     A path sitting inside a quoted message is inert.
//   PROSE units (skill, githook) are executed by an agent following instructions,
//     so a `node .../x.js` command line IS the invocation.
const CODE_KINDS = new Set(['lib', 'script', 'hook']);
const EXEC_CALL = '(?:require|spawnSync|spawn|execSync|execFileSync|execFile)\\(';

function scriptPattern(name, fromKind) {
  const n = escapeRe(name);
  if (CODE_KINDS.has(fromKind)) {
    return new RegExp(`${EXEC_CALL}[^)]*['"][^'"]*${n}(?:\\.js)?['"]`);
  }
  return new RegExp(`scripts/${n}\\.js|npm run [\\w:-]*\\b${n}\\b`);
}

function libPattern(name, fromKind) {
  const n = escapeRe(name);
  if (CODE_KINDS.has(fromKind)) return new RegExp(`${EXEC_CALL}[^)]*['"][^'"]*${n}['"]`);
  return new RegExp(`lib/${n}\\b`);
}

// A skill is hard-referenced only by executing something inside it, or by an explicit
// Skill()/subagent dispatch. A path to its SKILL.md or references/ is documentation.
function skillPattern(name) {
  const n = escapeRe(name);
  return new RegExp(`node[^\\n]*skills/${n}/|Skill\\([^)]*['"]${n}['"]`, 'i');
}

// An actual dispatch, not the word appearing near "subagent_type" in prose.
function agentPattern(name) {
  const n = escapeRe(name);
  return new RegExp(`subagent_type\\s*[:=]\\s*['"]?${n}\\b|Agent\\([^)]*subagent_type[^)]*${n}\\b`, 'i');
}

function hardRefPattern(kind, name, fromKind) {
  switch (kind) {
    case 'script': return scriptPattern(name, fromKind);
    case 'lib': return libPattern(name, fromKind);
    case 'hook': return new RegExp(`hooks/${escapeRe(name)}\\.js`);
    case 'githook': return new RegExp(`git-hooks/${escapeRe(name)}\\b`);
    case 'agent': return agentPattern(name);
    case 'skill': return skillPattern(name);
    default: return null;
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

function hardRefs(text, names, optional = new Set(), fromKind = null) {
  const found = [];
  for (const kind of KINDS) {
    for (const name of names[kind] || []) {
      if (optional.has(name)) continue;
      const re = hardRefPattern(kind, name, fromKind);
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

// A justified exception, declared in the partition as accepted_edges[] with a `why`.
// Kept visible (always printed, never silently dropped) and required to be explicit,
// so an exception is a decision on the record rather than an erosion of the rule.
// An entry that no longer corresponds to a real edge is reported as stale, so the
// list cannot quietly outlive the coupling it excused.
function partitionAccepted(accepted) {
  const map = new Map();
  for (const e of accepted || []) {
    if (!e || !e.from || !e.to || !e.why) {
      throw new Error('check-partition: every accepted_edges entry needs from, to and why');
    }
    map.set(`${e.from} -> ${e.to}`, e);
  }
  return map;
}

// Classify one hard edge into the right bucket. A declared exception (accepted_edges)
// wins wherever the caller lives: a kernel -> pack edge and a cross-pack profile-breaking
// edge are the same problem — a coupling the checker cannot see is safe (e.g. a
// conditional prose step, or an installer that only runs from the full source tree).
// Kept visible in every case; never silently dropped.
function recordEdge(from, to, home, target, acceptedMap, sink) {
  const accepted = acceptedMap.get(`${from} -> ${to}`);
  if (accepted) { accepted.__seen = true; sink.accepted.push({ from, to, pack: target, why: accepted.why }); }
  else if (home === 'kernel') sink.violations.push({ from, to, pack: target });
  else sink.crossPack.push({ from, fromPack: home, to, toPack: target });
}

// Pure core, so the rule is testable without touching disk.
function checkPartition({ assign, texts, names, accepted = [] }) {
  const acceptedMap = partitionAccepted(accepted);
  const ids = Object.keys(assign);
  if (ids.length === 0) {
    // A checker that reports "clean" on empty input is worse than no checker:
    // a mis-wired path would read as a passing gate.
    throw new Error('check-partition: no units to check — refusing to report a vacuous pass');
  }
  const sink = { violations: [], crossPack: [], optional: [], accepted: [] };
  for (const from of ids) {
    const home = assign[from];
    if (!texts[from]) continue;
    const opt = optionalRefs(texts[from]);
    for (const to of hardRefs(texts[from], names, opt, from.slice(0, from.indexOf(":")))) {
      const target = assign[to];
      if (to === from || !target || target === home) continue;
      // pack -> kernel is always safe (the kernel ships in every profile); everything
      // else is classified, so accepted_edges can excuse a cross-pack coupling too.
      if (home === 'kernel' || target !== 'kernel') recordEdge(from, to, home, target, acceptedMap, sink);
    }
    if (home === 'kernel') sink.optional.push(...guardedEdges(from, opt, ids, assign));
  }
  const staleAccepted = [...acceptedMap.values()].filter((e) => !e.__seen).map((e) => `${e.from} -> ${e.to}`);
  return { ...sink, staleAccepted, units: ids.length };
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

function main() {
  const partition = JSON.parse(fs.readFileSync(PARTITION, 'utf8'));
  const assign = loadAssignment(partition);
  const { texts, names } = loadUnitTexts();
  const result = checkPartition({ assign, texts, names, accepted: partition.accepted_edges || [] });
  printReport({ partition, assign, result });
  // --strict now fails on a profile-breaking edge too, not only a kernel violation: a
  // composed profile that crashes on a require it did not ship is as broken as a kernel
  // that cannot stand alone. Report-only until the count reached zero (it now has).
  const breaks = computeProfileBreaks(result.crossPack, partition.profiles || {});
  return process.argv.includes('--strict') && (result.violations.length || breaks.length) ? 1 : 0;
}

if (require.main === module) process.exit(main());

module.exports = { hardRefs, checkPartition, hardRefPattern, optionalRefs };
