'use strict';

// Heuristic extraction of filesystem write targets from a shell command string.
//
// The pre-write gate only intercepts Write/Edit/MultiEdit. An agent can still
// create or overwrite files through Bash — redirections (`> f`), `tee`, `sed -i`,
// `dd of=`, `cp`/`mv` — and so bypass every pre-write check, including the
// trust-boundary that stops an agent from rewriting its own quality gates.
// pre-bash-gate.js re-applies the security-critical subset of those checks; this
// module finds the paths it should check.
//
// Bias: over-extract rather than miss. The gate acts only on a narrow protected
// set (outside-project / harness machinery / protected env files), so an extra
// candidate pointing at an ordinary project file is simply ignored. A *missed*
// machinery write is the failure that matters, so when in doubt we emit the path.

const WRITER_HEADS = new Set(['cp', 'mv', 'install', 'rsync', 'ln', 'truncate']);

// Split a command line into segments that each run one simple command, breaking
// on the operators that terminate a command (`;`, `&&`, `||`, `|`, newline).
// Quote-aware: a `;` or `|` inside a quoted sed/awk script must not split the
// command (the bug a naive regex split would introduce). `&>` is kept intact as
// a redirection rather than treated as a background separator.
function splitSegments(command) {
  const segments = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '\n' || c === ';') { segments.push(cur); cur = ''; continue; }
    if ((c === '|' && next === '|') || (c === '&' && next === '&')) { segments.push(cur); cur = ''; i++; continue; }
    if (c === '|') { segments.push(cur); cur = ''; continue; }
    if (c === '&' && next !== '>') { segments.push(cur); cur = ''; continue; }
    cur += c;
  }
  segments.push(cur);
  return segments;
}

function unquote(tok) {
  if (!tok) return tok;
  const first = tok[0];
  const last = tok[tok.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return tok.slice(1, -1);
  }
  return tok;
}

function tokenize(segment) {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(unquote);
}

function isFlag(tok) {
  return tok.startsWith('-');
}

function isEnvAssignment(tok) {
  return /^\w+=/.test(tok);
}

// Output redirections in a raw segment: `> f`, `>> f`, `2> f`, `&> f`.
// Skips fd duplications like `2>&1` (target `&1`) — those create no file.
function redirectTargets(segment) {
  const out = [];
  const re = /(?:^|\s)(?:&|\d*)>>?\s*("[^"]*"|'[^']*'|[^\s|;&<>]+)/g;
  let m;
  while ((m = re.exec(segment)) !== null) {
    const tgt = unquote(m[1]);
    if (!tgt || tgt.startsWith('&') || /^\d+$/.test(tgt)) continue;
    out.push(tgt);
  }
  return out;
}

// `sed -i 'script' file...`: the first non-flag operand is the script, the rest
// are files. With a single operand it is the file (e.g. `sed -i f`).
function sedInPlaceTargets(rest, nonFlag) {
  const inPlace = rest.some((t) => t === '-i' || t.startsWith('-i') || t === '--in-place' || t.startsWith('--in-place'));
  if (!inPlace) return [];
  return nonFlag.length === 1 ? [nonFlag[0]] : nonFlag.slice(1);
}

// Write targets implied by the command verb (cp/mv dest, tee files, dd of=, …).
function commandTargets(tokens) {
  let i = 0;
  while (i < tokens.length && (isEnvAssignment(tokens[i]) || tokens[i] === 'sudo' || tokens[i] === 'command')) i++;
  const head = tokens[i];
  if (!head) return [];
  const rest = tokens.slice(i + 1);
  const nonFlag = rest.filter((t) => !isFlag(t) && !isEnvAssignment(t));

  if (WRITER_HEADS.has(head)) {
    return nonFlag.length ? [nonFlag[nonFlag.length - 1]] : []; // last operand is the destination
  }
  if (head === 'tee') return nonFlag; // `tee [-a] file...` writes every named file
  if (head === 'dd') return rest.map((t) => (t.match(/^of=(.+)$/) || [])[1]).filter(Boolean).map(unquote);
  if (head === 'sed' || head === 'perl') return sedInPlaceTargets(rest, nonFlag);
  return [];
}

function extractWriteTargets(command) {
  if (typeof command !== 'string' || !command) return [];
  const targets = new Set();
  for (const seg of splitSegments(command)) {
    for (const t of redirectTargets(seg)) targets.add(t);
    for (const t of commandTargets(tokenize(seg))) targets.add(t);
  }
  return [...targets];
}

// ---------------------------------------------------------------- removals
//
// The extractor above answers "what does this command WRITE". It never answered
// "what does it REMOVE", which left the cheapest attack on a state-backed gate
// completely invisible:
//
//   rm .claude/state/task-lifecycle.jsonl
//   rm -rf .claude/git-hooks
//   git checkout -- .claude/git-hooks/pre-commit
//   mv .claude/state/task-envelope.json /tmp/x     (only /tmp/x was extracted)
//
// Deleting the evidence a gate reads is equivalent to rewriting it, and for a
// ledger-backed control it is strictly better for the attacker: an absent file
// reads as "nothing to check" rather than as tampering.
//
// SEPARATE from write targets on purpose. pre-bash-gate checks write targets for
// project scope too, and routing removals through that would start blocking
// `rm -rf /tmp/scratch` — large new friction for no security gain. Removals are
// checked only against protected machinery.
const REMOVE_HEADS = new Set(['rm', 'unlink', 'shred']);
const MOVE_HEADS = new Set(['mv', 'rename']);
// git subcommands that overwrite a working-tree path from the index or stash.
const GIT_RESTORE_VERBS = new Set(['checkout', 'restore']);

function gitRestoreTargets(rest) {
  const verb = rest.find((t) => !isFlag(t));
  if (!GIT_RESTORE_VERBS.has(verb)) return [];
  const after = rest.slice(rest.indexOf(verb) + 1);
  const sep = after.indexOf('--');
  if (sep !== -1) return after.slice(sep + 1).filter((t) => !isFlag(t)).map(unquote);
  // Without a `--` separator the two verbs differ, and conflating them either
  // misses real overwrites or blocks ordinary branch work:
  //   `git restore <path>`  — restore takes PATHS positionally (a ref goes in
  //                           --source=), so a bare operand is a path.
  //   `git checkout <x>`    — ambiguous: `git checkout main` and
  //                           `git checkout -b feature` are branch operations,
  //                           and guessing "path" would block everyday git.
  if (verb !== 'restore') return [];
  return after.filter((t) => !isFlag(t)).map(unquote);
}

function removalTargets(tokens) {
  let i = 0;
  while (i < tokens.length && (isEnvAssignment(tokens[i]) || tokens[i] === 'sudo' || tokens[i] === 'command')) i++;
  const head = tokens[i];
  if (!head) return [];
  const rest = tokens.slice(i + 1);
  const nonFlag = rest.filter((t) => !isFlag(t) && !isEnvAssignment(t)).map(unquote);

  if (REMOVE_HEADS.has(head)) return nonFlag;
  // A move REMOVES its sources; the destination is already a write target.
  if (MOVE_HEADS.has(head)) return nonFlag.slice(0, -1);
  if (head === 'git') return gitRestoreTargets(rest);
  return [];
}

/** Paths a command deletes, moves away, or overwrites from git. */
function extractRemoveTargets(command) {
  if (typeof command !== 'string' || !command) return [];
  const targets = new Set();
  for (const seg of splitSegments(command)) {
    for (const t of removalTargets(tokenize(seg))) targets.add(t);
  }
  return [...targets];
}

module.exports = { extractWriteTargets, extractRemoveTargets };
