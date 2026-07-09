'use strict';

// Gap G29 (Gap B, design goal 3) — narrow bite-check backstop for a MANUAL
// commit's UNCOVERED-evidence path in legacy-discipline-gate.js.
// mutation-gate.js (gap G7)'s own bite-check backstop only runs inAutoBuild
// (see .claude/git-hooks/pre-commit's checkMutation) — a manual commit that
// satisfies legacy-discipline-gate.js's evidence requirement on relatedness
// alone (gap G29 Gap B) had NO proof the related test actually kills
// anything when the logic breaks.
//
// A full G7-scale mutation run (up to 12 mutants x one full test-suite run
// each, per hooks/lib/mutation-gate.js's DEFAULTS) is impractical to add
// unconditionally to every commit's synchronous pre-commit hook — that is
// exactly the cost G7 itself avoids for manual commits ("never surprise a
// manual commit with N test-suite runs"). This deliberately runs a much
// smaller budget (a handful of mutants, a short per-mutant timeout) and
// scopes it to ONLY the specific uncovered production file(s) that just
// passed the evidence check, not the whole commit — reusing
// hooks/lib/mutation-gate.js's existing runMutationOnFiles primitive
// unchanged (dependency-injected here so this stays unit-testable without
// spawning real subprocesses), rather than reimplementing mutation running.

const DEFAULTS = { maxMutants: 3, timeoutMs: 10000 };

// files: uncovered production file(s) legacy-discipline-gate.js just
// accepted via relatedness evidence. runMutationOnFiles: injected (the real
// hooks/lib/mutation-gate.js implementation in production; a stub in tests).
function biteCheckFiles(files, projectDir, runMutationOnFiles, opts) {
  if (!files || files.length === 0) return { ran: false, pass: true, results: [] };
  const o = { ...DEFAULTS, ...(opts || {}) };
  const { results, blocked } = runMutationOnFiles(files, projectDir, o);
  return { ran: true, pass: blocked.length === 0, results, blocked };
}

module.exports = { biteCheckFiles, DEFAULTS };
