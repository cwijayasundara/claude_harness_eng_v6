'use strict';

// Dead-path detection — pure classification (no git, no filesystem).
//
// The rule, from SwarmForge's `squad` redo plan: when a path dies, its
// functions, config and tests die in the SAME commit. "Grep the old name. If
// the only remaining refs are the defn and tests, delete both." What that plan
// bans by name — `(defn foo [_ _] [])` stubs, and inverting a dead test into
// "does not mention merger" — is the accretion this harness has on record:
// 132 controls, a cut-to-half proposal overwhelmed in five weeks.
//
// The precision that makes it usable as a commit gate: this is NOT an unused-
// code detector. It fires only when the staged change is what removed the last
// production caller of a symbol whose definition is still in the tree. Code
// that was already callerless is the drift report's business.

// Reserved words and common noise that are never a symbol worth chasing.
const NOISE = new Set([
  'if', 'else', 'for', 'while', 'return', 'const', 'let', 'var', 'function', 'class',
  'new', 'this', 'null', 'true', 'false', 'undefined', 'typeof', 'instanceof', 'void',
  'try', 'catch', 'finally', 'throw', 'switch', 'case', 'break', 'continue', 'default',
  'import', 'export', 'from', 'require', 'module', 'exports', 'async', 'await', 'yield',
  'def', 'self', 'None', 'True', 'False', 'elif', 'pass', 'raise', 'with', 'lambda',
  'and', 'or', 'not', 'in', 'is', 'del', 'global', 'nonlocal', 'assert',
]);

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

function identifiersIn(content) {
  return new Set(String(content || '').match(IDENTIFIER) || []);
}

/** How many lines of `content` CALL `name` (imports and exports do not count). */
function callSiteCount(content, name) {
  let n = 0;
  for (const line of String(content || '').split(/\r?\n/)) {
    if (isReferenceLine(line, name)) n += 1;
  }
  return n;
}

/**
 * Identifiers this change stopped CALLING in the file: they had call sites in
 * the old content and have none in the new one.
 *
 * Counting call sites rather than mere presence is what catches the common
 * shape — the call goes but the `require` line stays behind. A name whose
 * presence test would say "still there" is exactly the orphan worth reporting.
 * A name whose calls merely went 2 -> 1 did not die and is not a candidate.
 */
function removedIdentifiers(oldContent, newContent) {
  const removed = new Set();
  for (const name of identifiersIn(oldContent)) {
    if (NOISE.has(name)) continue;
    if (name.length < 3) continue; // single-letter locals are not a path
    if (callSiteCount(oldContent, name) === 0) continue;
    if (callSiteCount(newContent, name) > 0) continue;
    removed.add(name);
  }
  return removed;
}

/**
 * Does `content` DEFINE `name` (rather than merely call it)? Covers the shapes
 * this repo and its scaffolded projects use: JS function/const/class/method and
 * Python def/class. Anchored on the name so a prefix never counts.
 */
function definesSymbol(content, name) {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`\\bfunction\\s+${n}\\s*\\(`),
    new RegExp(`\\b(?:const|let|var)\\s+${n}\\s*=`),
    new RegExp(`\\bclass\\s+${n}\\b`),
    new RegExp(`^\\s*(?:async\\s+)?${n}\\s*\\([^)]*\\)\\s*\\{`, 'm'),
    new RegExp(`^\\s*def\\s+${n}\\s*\\(`, 'm'),
  ];
  return patterns.some((re) => re.test(String(content || '')));
}

/**
 * Does this source line REFERENCE `name` as a caller would?
 *
 * Three shapes name a symbol without using it, and all three must be excluded
 * or every exported function looks alive because it names itself in its own
 * exports: the definition, an export listing (`module.exports = { name }`,
 * `exports.name =`, or a bare `name,` inside a multiline block), and an import.
 */
function isReferenceLine(text, name) {
  const line = String(text || '');
  if (!new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(line)) return false;
  if (definesSymbol(line, name)) return false;
  if (new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},?$`).test(line)) return false;
  if (/\bmodule\.exports\b/.test(line)) return false;
  if (new RegExp(`\\bexports\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(line)) return false;
  if (/\brequire\s*\(/.test(line)) return false;
  if (/^\s*(import|from)\b/.test(line)) return false;
  if (/^\s*__all__\b/.test(line)) return false;
  return true;
}

/**
 * Is `name` exempted by a `harness:keep-dead` marker? Same shape as the
 * `harness:secret-ok` marker the secret scanner already honours: an escape a
 * reviewer can see in the diff, rather than a config file nobody reads.
 */
function isKeepMarked(content, name) {
  const lines = String(content || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!/harness:keep-dead/.test(lines[i])) continue;
    if (lines[i].includes(name)) return true;
    const next = lines[i + 1];
    if (next && definesSymbol(next, name)) return true;
  }
  return false;
}

/**
 * Findings for candidate symbols already resolved against the tree.
 * @param {Array<{symbol:string, definedIn:?string, refsBefore:number,
 *   refsAfter:number, testRefsAfter?:number, keepMarked?:boolean}>} candidates
 */
function classifyOrphans(candidates) {
  const findings = [];
  for (const c of candidates || []) {
    if (c.keepMarked) continue;
    if (!c.definedIn) continue; // deleted along with its callers — the right outcome
    if (c.refsBefore <= 0) continue; // was already callerless; not this commit's doing
    if (c.refsAfter > 0) continue;

    const tests = c.testRefsAfter || 0;
    const tail = tests > 0
      ? ` Its ${tests} remaining reference${tests === 1 ? '' : 's'} ${tests === 1 ? 'is' : 'are'} in tests — `
        + 'delete the test with the function; a test kept alive for a dead path reads as coverage.'
      : '';
    findings.push({
      symbol: c.symbol,
      definedIn: c.definedIn,
      message: `${c.symbol} lost its last production caller in this change but is still defined in `
        + `${c.definedIn}. Delete it — and its tests and config lines — in this commit.${tail}`
        + ' If it is deliberately callerless (a CLI entry point, a public export),'
        + ' mark it: // harness:keep-dead <why>',
    });
  }
  return findings;
}

module.exports = {
  classifyOrphans,
  definesSymbol,
  identifiersIn,
  isKeepMarked,
  isReferenceLine,
  removedIdentifiers,
};
