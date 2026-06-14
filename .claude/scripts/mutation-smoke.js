#!/usr/bin/env node

'use strict';

// Mutation-smoke gate — generalizes the manual "flip a behavior, confirm the
// test goes red" checkpoint (pinning-down-behavior) into a bounded, deterministic
// runner. It applies one high-signal operator mutation at a time to CODE (never
// strings or comments), re-runs the test command, and reports SURVIVORS — mutants
// no test killed, i.e. behavior the suite does not actually verify.
//
// Coverage proves a line ran; this proves a test would fail if that line broke.
//
// Design contract:
//   - false survivors are impossible — strings and comments are never mutated, so
//     a "survivor" is always a real gap, never a no-op edit.
//   - false kills are tolerable — a syntactically broken mutant fails to run and
//     counts as killed; no signal, but never a false gate failure.
//
// Scope: a smoke gate, not exhaustive mutation testing. Operator set is the
// classic high-signal core (relational, equality, logical, boolean literal),
// applied to JavaScript/TypeScript and Python.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Longest match first so `>=` wins over `>`, `===` over `==`.
const OPERATORS = [
  { match: '===', mutated: '!==', langs: ['js'] },
  { match: '!==', mutated: '===', langs: ['js'] },
  { match: '==', mutated: '!=', langs: ['js', 'python'] },
  { match: '!=', mutated: '==', langs: ['js', 'python'] },
  { match: '>=', mutated: '>', langs: ['js', 'python'] },
  { match: '<=', mutated: '<', langs: ['js', 'python'] },
  { match: '&&', mutated: '||', langs: ['js'] },
  { match: '||', mutated: '&&', langs: ['js'] },
  { match: '>', mutated: '>=', langs: ['js', 'python'] },
  { match: '<', mutated: '<=', langs: ['js', 'python'] },
  { match: 'and', mutated: 'or', langs: ['python'], word: true },
  { match: 'or', mutated: 'and', langs: ['python'], word: true },
  { match: 'True', mutated: 'False', langs: ['python'], word: true },
  { match: 'False', mutated: 'True', langs: ['python'], word: true },
  { match: 'true', mutated: 'false', langs: ['js'], word: true },
  { match: 'false', mutated: 'true', langs: ['js'], word: true },
];

function detectLang(filePath) {
  const ext = path.extname(String(filePath)).toLowerCase();
  if (ext === '.py') return 'python';
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) return 'js';
  return null;
}

function isWordChar(c) {
  return /[A-Za-z0-9_$]/.test(c || '');
}

// --- string / comment skipping (so we only ever mutate code) -------------------

function skipToLineEnd(source, i) {
  const n = source.indexOf('\n', i);
  return n === -1 ? source.length : n;
}

function skipQuoted(source, i) {
  const q = source[i];
  for (let k = i + 1; k < source.length; k++) {
    if (source[k] === '\\') { k++; continue; }
    if (source[k] === q) return k + 1;
  }
  return source.length;
}

function skipBlockComment(source, i) {
  const e = source.indexOf('*/', i + 2);
  return e === -1 ? source.length : e + 2;
}

function skipTriple(source, i) {
  const q = source.substr(i, 3);
  const e = source.indexOf(q, i + 3);
  return e === -1 ? source.length : e + 3;
}

// Returns the index past a string/comment starting at i, or -1 if none does.
function skipRegion(source, i, lang) {
  const c = source[i];
  const d = source[i + 1];
  if (lang === 'js') {
    if (c === '/' && d === '/') return skipToLineEnd(source, i);
    if (c === '/' && d === '*') return skipBlockComment(source, i);
    if (c === '`') return skipQuoted(source, i);
  } else {
    if (c === '#') return skipToLineEnd(source, i);
    if ((c === "'" || c === '"') && source[i + 1] === c && source[i + 2] === c) return skipTriple(source, i);
  }
  if (c === "'" || c === '"') return skipQuoted(source, i);
  return -1;
}

// --- site detection ------------------------------------------------------------

function matchOperatorAt(source, i, lang) {
  const prev = source[i - 1] || '';
  for (const op of OPERATORS) {
    if (!op.langs.includes(lang) || !source.startsWith(op.match, i)) continue;
    if (op.word) {
      const after = source[i + op.match.length] || '';
      if (isWordChar(prev) || isWordChar(after)) continue;
    }
    if (op.match === '>' && prev === '=') continue; // never corrupt a => arrow
    return op;
  }
  return null;
}

function lineColAt(source, index) {
  let line = 1;
  let last = -1;
  for (let k = 0; k < index; k++) if (source[k] === '\n') { line++; last = k; }
  return { line, col: index - last };
}

function findMutationSites(source, lang) {
  const sites = [];
  let i = 0;
  while (i < source.length) {
    const r = skipRegion(source, i, lang);
    if (r !== -1) { i = r; continue; }
    const op = matchOperatorAt(source, i, lang);
    if (op) { sites.push({ index: i, original: op.match, mutated: op.mutated }); i += op.match.length; continue; }
    i++;
  }
  return sites.map((s) => ({ ...s, ...lineColAt(source, s.index) }));
}

function applyMutationToSource(source, site) {
  return source.slice(0, site.index) + site.mutated + source.slice(site.index + site.original.length);
}

// --- runner --------------------------------------------------------------------

function collectSites(files, cwd) {
  const out = [];
  for (const file of files || []) {
    const abs = path.resolve(cwd, file);
    const lang = detectLang(abs);
    if (!lang || !fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    for (const s of findMutationSites(src, lang)) out.push({ file, abs, ...s });
  }
  return out;
}

// Apply one mutant, run the suite, restore. killed = the test command failed.
// testCmd is the operator's own test command (e.g. "cd backend && pytest"); it
// is intentionally run through a shell because it needs shell features. It is
// configuration, never untrusted input — do not pass user-derived data here.
function runMutant(site, testCmd, cwd, timeout) {
  const original = fs.readFileSync(site.abs, 'utf8');
  try {
    fs.writeFileSync(site.abs, applyMutationToSource(original, site));
    execSync(testCmd, { cwd, stdio: 'ignore', timeout }); // shell: see note above
    return false;
  } catch (_) {
    return true;
  } finally {
    fs.writeFileSync(site.abs, original);
  }
}

function asSurvivor(s) {
  return { file: s.file, line: s.line, operator: `${s.original}->${s.mutated}`, original: s.original, mutated: s.mutated };
}

function runGate(args) {
  const cwd = args.cwd || process.cwd();
  const all = collectSites(args.files, cwd);
  const threshold = args.threshold != null ? parseFloat(args.threshold) : 0.8;
  if (args.dryRun) return { score: null, total_sites: all.length, tested: 0, killed: 0, survived: [], threshold, pass: true, dry_run: true };
  const cap = args['max-mutants'] != null ? parseInt(args['max-mutants'], 10) : Infinity;
  const timeout = args['timeout-ms'] != null ? parseInt(args['timeout-ms'], 10) : 60000;
  const selected = all.slice(0, cap);
  const survived = [];
  let killed = 0;
  for (const s of selected) runMutant(s, args['test-cmd'], cwd, timeout) ? killed++ : survived.push(asSurvivor(s));
  const tested = selected.length;
  const score = tested === 0 ? null : killed / tested;
  return { score, total_sites: all.length, tested, killed, survived, threshold, pass: tested === 0 ? true : score >= threshold };
}

// --- CLI -----------------------------------------------------------------------

function parseArgs(argv) {
  const args = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dry-run') args.dryRun = true;
    else if (k === '--files') args.files.push(argv[++i]);
    else if (k && k.startsWith('--')) args[k.slice(2)] = argv[++i];
  }
  return args;
}

function usage() {
  process.stderr.write('usage: mutation-smoke.js --files <f> [--files <f>...] --test-cmd "<cmd>" ' +
    '[--cwd <dir>] [--max-mutants N] [--timeout-ms N] [--threshold 0.8] [--out <file>] [--dry-run]\n');
}

function printSummary(r) {
  if (r.dry_run) { process.stdout.write(`mutation-smoke: ${r.total_sites} site(s) (dry run)\n`); return; }
  const pct = r.score == null ? 'n/a' : `${Math.round(r.score * 100)}%`;
  process.stdout.write(`mutation-smoke: ${r.pass ? 'PASS' : 'FAIL'} — score ${pct} ` +
    `(${r.killed}/${r.tested} killed, ${r.survived.length} survived, threshold ${Math.round(r.threshold * 100)}%)\n`);
  for (const s of r.survived) process.stdout.write(`  SURVIVED ${s.file}:${s.line} ${s.operator}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.files || args.files.length === 0) { usage(); process.exit(2); }
  if (!args.dryRun && !args['test-cmd']) { usage(); process.exit(2); }
  const report = runGate(args);
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
  }
  printSummary(report);
  process.exit(report.pass ? 0 : 1);
}

module.exports = { detectLang, findMutationSites, applyMutationToSource };

if (require.main === module) main();
