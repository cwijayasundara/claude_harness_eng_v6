# Live-route budget baselines

One file per live e2e route, e.g. `sprint-delta.json`, holding the per-phase
output-token and USD figures that route last cost. `helpers/phase-budget.js`
compares a run against the file and fails the route when a phase regresses past
the tolerance band (30% by default).

A ratchet rather than a ceiling: absolute cost moves with every model and prompt
change, so a fixed cap gets bumped rather than investigated. Phases below the
noise floor (5,000 output tokens / $0.25) are reported as `unratcheted` instead
of being ratcheted on variance.

Re-record after a deliberate cost change:

```bash
HARNESS_E2E_UPDATE_BASELINE=1 npm run test:sprint
```

A route whose bill covers no sessions fails loudly — an empty bill must never
read as a run that came in under budget.
