# Testing the Harness

## End-to-End Testing

The harness includes a full E2E test suite that builds a real project through the entire pipeline, validates artifacts with LLM-based assertions, and checks telemetry.

### Quick run

```bash
./test/e2e/run.sh
```

This auto-starts the telemetry stack (Docker Compose) if not running, then executes all 8 stages.

### What it tests

| Stage | What | Model | Budget |
|---|---|---|---|
| 1 - Scaffold | Project structure created | Haiku | $0.50 |
| 2 - BRD | Business requirements document generated | Haiku | $1.00 |
| 2b - BRD LLM | LLM validates BRD quality (advisory) | Haiku | $0.15 |
| 3 - Spec | Stories + features.json decomposed from BRD | Haiku | $1.00 |
| 3b - Spec LLM | LLM validates spec quality (advisory) | Haiku | $0.15 |
| 4 - Design | Architecture artifacts generated | Haiku | $1.50 |
| 5 - Auto | Working code built (todo CLI app) | Sonnet | $5.00 |
| 6 - Brownfield | Codebase discovery maps generated | Haiku | $1.00 |
| 7 - Telemetry | Prometheus metrics exist | — | — |
| 8 - Grafana | Dashboard loads, Phase Quality panels visible | — | — |

**Total runtime:** ~15-20 minutes. **Total cost:** ~$5-10 per run.

### Keep artifacts for debugging

```bash
E2E_KEEP_ARTIFACTS=1 ./test/e2e/run.sh
```

Artifacts are saved in a temp directory printed at the start of the run.

### Run without telemetry stack

Stages 7-8 gracefully skip if Prometheus/Grafana aren't running:

```bash
node --test test/e2e/harness-pipeline.test.js --timeout 1200000
```

## Unit tests (fast, no API calls)

Run the whole unit suite:

```bash
npm test
```

> Use `npm test` (or `node --test "test/*.test.js"`), **not** `node --test test/`.
> Passing a bare directory makes Node try to load `test/` as a module and fails
> with `MODULE_NOT_FOUND` (`cjs/loader:1408`). `npm test` also scopes to the unit
> suite so the costly e2e tests (which spawn `claude`) are not swept in — run
> those with `npm run test:e2e`.

Run a single file while iterating:

```bash
node --test test/phase-eval-unit.test.js         # rubrics, schema, hooks, skills
node --test test/phase-eval-integration.test.js  # telemetry snapshot, Grafana, deck
node --test test/scaffold-command.test.js        # scaffold config validation
node --test test/skills-consistency.test.js      # skill cross-reference integrity
node --test test/pre-write-gate.test.js          # consolidated pre-write gate (scope/env/secrets/length/TDD)
node --test test/verify-on-save.test.js          # post-save lint/layers + review queue
node --test test/pre-commit-git-hook.test.js     # git commit gate (layers/contract/coverage)
node --test test/review-on-stop.test.js          # Stop-hook review gate + advisories
node --test test/hook-security.test.js           # hook injection/scope/exemption regressions
node --test test/record-run-hook.test.js         # telemetry hook
```

## Test file structure

```
test/
  e2e/
    harness-pipeline.test.js       # Main orchestrator (8 stages)
    run.sh                         # One-command runner with auto-start
    helpers/
      claude-runner.js             # Spawn claude -p with model/budget
      llm-validator.js             # LLM artifact quality checks (Haiku)
      prometheus-checker.js        # Prometheus HTTP API queries
      grafana-checker.js           # Grafana REST API dashboard checks
    fixtures/
      todo-cli-brd-prompt.md       # Canned BRD input (deterministic)
      validation-criteria.json     # Per-stage LLM validation rules
    results/                       # Screenshots, logs (gitignored)
  helpers/
    hook-fixture.js                # Temp-project fixture for hook tests
    record-run-fixture.js          # Fixture for the telemetry hook
  phase-eval-unit.test.js          # Unit tests for phase ratchet evaluators
  phase-eval-integration.test.js   # Integration tests (telemetry, Grafana, deck)
  scaffold-command.test.js         # Scaffold configuration tests
  pre-write-gate.test.js           # Consolidated pre-write gate tests
  verify-on-save.test.js           # Post-save verification tests
  pre-commit-git-hook.test.js      # Git commit gate tests
  review-on-stop.test.js           # Stop-hook review gate tests
```
