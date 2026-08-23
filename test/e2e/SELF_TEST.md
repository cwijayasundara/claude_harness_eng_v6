# E2E self-test harnesses (live `claude -p`)

All live end-to-end harnesses live here under `test/e2e/`. They run real
`claude -p` against the harness plugin, cost tokens, and are **not** part of
`npm test` (the fast unit/contract suite). Each has a cheap static **contract**
in `test/*-contract.test.js` that pins its shape in CI without a live run.

Run them from the repo root through the e2e pack runner:

```bash
npm install
npm run test:e2e:fast       # no live Claude and no local server; contracts + safe helper tests
npm run test:routes         # scaffold + lite-auto + full-auto + gated + feature routes
npm run test:front-half   # the separate-invocation front half (/brd → /spec → /design → /test)
npm run test:sprint         # the sprint-N delta lane (/sprint) — needs a sprint-1 baseline first
npm run e2e:baseline:sprint1  # build/capture that sprint-1 baseline (one-off, expensive)
npm run test:e2e:live       # all live route/smoke checks
npm run test:e2e:cert       # certification layers (same as ./test/e2e/run.sh)
npm run test:e2e:all        # fast → live → cert
```

The runner writes per-layer logs to `test/e2e/results/logs/` and a machine-readable
summary to `test/e2e/results/e2e-pack-summary.json`. It continues through
independent layers by default and exits non-zero at the end if any failed. Add
`-- --bail` to stop at the first failure, `-- --only plan,auto` to target layers,
or `-- --skip smoke` to omit known-expensive layers.

| Harness | Script | What it proves |
|---|---|---|
| `harness-plan-only.test.js` | `npm run test:plan` or `npm run test:e2e:live -- --only plan` | `/build --autonomous --plan-only` → `specs/` for inspection, then stop. Cheapest. |
| `harness-front-half.test.js` | `npm run test:front-half` or `npm run test:e2e:live -- --only front-half` | The **separate-invocation** front half: `/brd` → `/spec` → `/spec --render-only` → `/design` → `/design --render-only` → `/test --plan-only`, each in its own cold session (the `/clear`). The only route that does not go through the `/build` conductor. |
| `harness-semi-auto-run.test.js` | `npm run test:semi` or `npm run test:e2e:live -- --only semi` | Mode 2: `/build --autonomous` plans then **pauses at the approval gate** (no silent build). |
| `harness-auto-run.test.js` | `npm run test:auto` or `npm run test:e2e:live -- --only auto` | Mode 1 over lite scope: `/build --auto --lite` runs with **zero human gates**; the generated app's own suite is the oracle. |
| `harness-full-auto-run.test.js` | `npm run test:full-auto` or `npm run test:e2e:live -- --only full-auto` | Full non-lite route: `/build --auto prd.md` plans/builds from a PRD and leaves a green project. |
| `harness-gated-build.test.js` | `npm run test:gated` or `npm run test:e2e:live -- --only gated` | Default `/build prd.md` generates BRD and stops at the human approval gate; it must not silently enter `/auto`. |
| `harness-feature-route.test.js` | `npm run test:feature` or `npm run test:e2e:live -- --only feature` | Existing repo route: `/scaffold --yes` then `/feature` refreshes brownfield code-map, changes behavior, and keeps tests green. |
| `harness-sprint-delta.test.js` | `npm run test:sprint` or `npm run test:e2e:live -- --only sprint` | The **SPDD delta lane**: `/sprint` over a built sprint-1 system. Proves the living `specs/design/` was **amended, not regenerated**, that the requirements delta matches the classification the sprint-2 PRD pre-committed to, and that the built sprint-2 system is green. The only route that ratchets its own token spend. |
| `harness-selfheal-smoke.test.js` | `npm run test:smoke` or `npm run test:e2e:live -- --only smoke` | Self-healing: build a counter web app → Playwright verify → `/change` add a feature → regression, with a bounded fix loop. Browser is the independent oracle. |

Plus the pre-existing certification layers (`harness-real-workflow`,
`harness-adversarial-*`, `harness-pipeline*`, `harness-brownfield`,
`harness-native-commands`) under `npm run test:e2e:cert`.

## Notes
- **Local vs distributed:** the local `--auto` run uses a single integrated build
  (no remote in a temp repo). Per-cluster PR fan-out (`--pod`) and `AUTO_MERGE`
  are the **distributed** path — validated against a real tracker via
  `symphony_clone/`, not here.
- **Fixtures:** `fixtures/counter-prd.md` (small, for the full auto/semi runs),
  `fixtures/sample-prd.md` (bookmarks, for plan-only), and the shortlink pair
  `fixtures/shortlink-sprint1-prd.md` / `fixtures/shortlink-sprint2-prd.md`
  (the sprint route). Any of them can be swapped for a real project's PRD
  without editing a test — `helpers/prd-fixture.js` reads `HARNESS_E2E_PRD`
  and `HARNESS_E2E_PRD_SPRINT2`:

  ```bash
  HARNESS_E2E_PRD_SPRINT2=~/proj/docs/prd-sprint-2.md npm run test:sprint
  ```
- **Sprint-1 baseline:** the sprint route amends a *built* sprint-1 system, so
  it seeds from `fixtures/baselines/shortlink-sprint1/` — product only, no
  harness control plane, so the route runs the CURRENT harness against it.
  Produce it once with `npm run e2e:baseline:sprint1` (live build from the
  sprint-1 PRD), or capture an already-built project with
  `node test/e2e/make-sprint1-baseline.js --from <dir>`. Without it the route
  fails immediately with that instruction rather than part-way through a
  live run.
- **Token/cost assertions:** `helpers/phase-budget.js` bills a route per slash
  command out of the session transcript (main loop **plus** pooled subagent
  transcripts, via `phase-cost-core`) and ratchets it against a committed
  baseline in `baselines/<route>.json` — a phase that regresses past the
  tolerance band fails the route. Every run also drops a receipt in
  `results/cost/<route>.json`. Re-record a deliberate cost change with
  `HARNESS_E2E_UPDATE_BASELINE=1`. A bill with no transcript **fails**; it
  never passes as "under budget".
- **Output (outside the repo):** every live route builds its throwaway project under
  `$HARNESS_E2E_WORKDIR` (default `<tmpdir>/harness-e2e/<route>`), never inside the
  checkout. A scaffolded tree in an iCloud-synced working copy races the sync
  daemon into ` 2.`-suffixed duplicates that wedge `npm test`. See
  `helpers/e2e-workdir.js`.
- **Never in CI:** these routes call a real `claude -p` and spend tokens. CI runs
  `npm test` only; `test/front-half-contract.test.js` asserts structurally that no
  workflow invokes a live pack.
- **Judging a generated project:** `helpers/manifest-suite.js` runs the built
  project's own tests per component, using the commands `/scaffold` recorded in
  `project-manifest.json` (`stack.backend.test_runner`, `package_manager`, …) —
  a root `npm test` cannot judge a FastAPI-plus-Next.js build, which has no root
  package. Two rules keep the verdict honest: a run that finds nothing to run
  reports `null`, never `0`; and a component present with no suite is listed in
  `skipped` with a note that the verdict does not cover it. A `package.json`
  test script counts as a suite even when the manifest declares no runner — a
  real scaffold of the shortlink PRD recorded `pytest` for the backend and no
  runner at all for the frontend. The older single-module routes still use
  `helpers/project-suite.js` (root `npm test`), which is right for their
  fixtures.
- **Reused, not reinvented:** every harness uses the shared
  `helpers/claude-runner.js` (budgeted, MCP-isolated `claude -p`); only the
  browser oracle (`helpers/app-runtime.js`) and the `specs/` summary
  (`helpers/specs-summary.js`) are harness-specific. Both have unit tests that
  run in `npm test`.
