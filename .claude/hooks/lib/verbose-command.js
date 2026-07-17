'use strict';

// Detects Bash commands whose stdout is genuinely verbose (a test/build/lint
// RUN) so the token governor can steer them through run-compact.js. Split out of
// token-advisor.js (SRP + the 300-line file cap).
//
// The point is that verbose output comes from RUNNING a tool — not from the word
// "test"/"build"/"lint" appearing as a path, arg, directory name, or commit
// message. The previous detector matched the bare word anywhere, so `test -d x`,
// `git add test/foo.test.js`, `du -sh … test`, `for d in … test; do`, and
// `git commit -m "add test"` were all wrongly blocked in enforced mode. These
// patterns require an actual runner invocation instead.

const RUNNER_PATTERNS = {
  test: [
    /\bnpm\s+(?:run\s+[\w:@/.-]*)?test\b/,
    /\b(?:yarn|pnpm)\s+(?:run\s+)?[\w:@/.-]*test[\w:@/.-]*\b/,
    /\bnode\s+--test\b/,
    /\b(?:pytest|vitest|jest|mocha)\b/,
    /\bplaywright\s+test\b/,
    /\bnpx\s+(?:jest|vitest|mocha|playwright|ava|tap)\b/,
  ],
  'build-log': [
    /\bnpm\s+(?:run\s+[\w:@/.-]*)?build\b/,
    /\b(?:yarn|pnpm)\s+(?:run\s+)?[\w:@/.-]*build[\w:@/.-]*\b/,
    /\b(?:tsc|webpack)\b/,
    /\bvite\s+build\b/,
    /\bnpx\s+(?:tsc|webpack|vite)\b/,
  ],
  lint: [
    /\b(?:eslint|ruff)\b/,
    /\bnpm\s+run\s+[\w:@/.-]*lint[\w:@/.-]*\b/,
    /\bnpx\s+(?:eslint|ruff)\b/,
  ],
};

// Return 'test' | 'build-log' | 'lint' | null.
function verboseKind(command) {
  const c = String(command || '');
  // git operations are never verbose runners, even when a tool name or the word
  // "test" appears as a path, arg, or commit message. Match a git command as any
  // segment (start, or after a newline / ; / && / |) so `cd x && git commit -m
  // "npm test"` and multi-line `cd x\n git commit` are not misread as runs.
  if (/(?:^|[\n;&|]\s*)git\s/.test(c)) return null;
  // shell test/[ conditionals (`test -d x`, `[ -d x ]`) are not test runners.
  if (/(?:^|[\n;&|]\s*)!?\s*\[{1,2}\s/.test(c) || /(?:^|[\n;&|]\s*)test\s+-/.test(c)) return null;
  for (const kind of Object.keys(RUNNER_PATTERNS)) {
    if (RUNNER_PATTERNS[kind].some((re) => re.test(c))) return kind;
  }
  return null;
}

function verboseCommandWarning(command, cfg) {
  if (!cfg || !cfg.compress_tool_output) return null;
  const trimmed = String(command || '').trim();
  if (!trimmed) return null;
  // Already compacted — do not warn/block.
  if (/run-compact\.js/.test(trimmed)) return null;
  const kind = verboseKind(trimmed);
  if (!kind) return null;
  return {
    kind: 'verbose_command',
    tool: 'Bash',
    command: trimmed,
    compact_kind: kind,
    message:
      `TOKEN ADVISORY: likely verbose command. Prefer compact execution:\n` +
      `  node .claude/scripts/run-compact.js --kind ${kind} -- ${trimmed}\n`,
  };
}

module.exports = { RUNNER_PATTERNS, verboseKind, verboseCommandWarning };
