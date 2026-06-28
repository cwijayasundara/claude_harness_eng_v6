'use strict';

// Per-rule self-correction guidance for the inner-loop computational sensors
// (gap G5) — the sensors article's "positive prompt injection": a linter that
// tells the agent HOW to fix a specific rule self-corrects far better than one
// that only says "fix the errors". enrich() appends one coaching line per known
// rule found in a tool's output, and carries the threshold-bump-with-
// justification valve so the agent raises a limit openly (a review focal point)
// instead of silently suppressing. Pure and testable.

// rule id (ruff code / eslint name / mypy code) -> one-line, agent-facing fix.
const GUIDANCE = {
  // ruff / flake8
  F401: 'Remove the import your change orphaned (leave pre-existing imports alone).',
  F841: 'Remove or use the local; do not silence it with a throwaway assignment.',
  E501: 'Wrap or restructure the long line; do not raise the line-length limit to hide it.',
  C901: 'Too complex — extract a named helper. If the complexity is irreducible (parser/state machine), raise the threshold in the linter config with a one-line comment naming why; the raise is a review focal point, not a silent suppression.',
  E711: 'Compare to None with `is`/`is not`, not `==`/`!=`.',
  E712: 'Compare to True/False with `is`, or just use the truthiness.',
  // eslint / typescript-eslint
  'no-unused-vars': 'Remove the binding your change orphaned; leave pre-existing dead code alone.',
  '@typescript-eslint/no-explicit-any': 'Give it a real type. If genuinely unknowable here, use `unknown` and narrow, or suppress this one line with `// eslint-disable-next-line @typescript-eslint/no-explicit-any` plus a reason — the suppression is a review focal point.',
  complexity: 'Extract a helper to lower branching. If irreducible, raise the rule threshold in the eslint config with a justification comment; the raise becomes a review focal point.',
  'max-lines-per-function': 'Decompose into named sub-functions, each testable in isolation.',
  'max-lines': 'Split the file along a real seam — one module, one responsibility.',
  eqeqeq: 'Use `===`/`!==`; loose equality hides type bugs.',
  'no-console': 'Use the project logger, not console.* (frontend vs backend rules differ — check the layer).',
  // mypy (codes appear as `[code]` when enabled)
  'arg-type': 'Argument type does not match the signature — fix the call or widen the parameter type deliberately.',
  'return-value': 'Return a value matching the annotated return type (or fix the annotation).',
  'attr-defined': 'That attribute does not exist on the type — check the name, or the object is mistyped upstream.',
  assignment: 'Assigned value does not match the declared type — reconcile the two.',
};

// Whole-token match so `max-lines` does not also fire inside `max-lines-per-function`.
function ruleRegex(rule) {
  const esc = rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w/@-])${esc}([^\\w/@-]|$)`);
}

function rulesInOutput(output) {
  const text = String(output || '');
  return Object.keys(GUIDANCE).filter((rule) => ruleRegex(rule).test(text));
}

function enrich(output) {
  const hits = rulesInOutput(output);
  if (!hits.length) return '';
  return '\nSelf-correction guidance (fix the specific rule; do not blanket-suppress):\n' +
    hits.map((r) => `  ↳ ${r}: ${GUIDANCE[r]}`).join('\n') + '\n';
}

module.exports = { GUIDANCE, rulesInOutput, enrich };
