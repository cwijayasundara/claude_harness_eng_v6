# E2E self-test harnesses (live `claude -p`)

All live end-to-end harnesses live here under `test/e2e/`. They run real
`claude -p` against the harness plugin, cost tokens, and are **not** part of
`npm test` (the fast unit/contract suite). Each has a cheap static **contract**
in `test/*-contract.test.js` that pins its shape in CI without a live run.

Run them from the repo root:

```bash
npm install
npm run install:browser     # one-time: playwright chromium (for the browser smoke)
npm run test:plan           # MODE: plan-only — architect half, inspect specs/, no code/PR
npm run test:semi           # MODE 2: semi-auto — /build --autonomous, pauses at the plan gate
npm run test:auto           # MODE 1: full-auto — /build --auto, plan→build→deploy→test, zero gates
npm run test:smoke          # self-healing browser smoke (scaffold→build→verify→modify→regression)
```

| Harness | Script | What it proves |
|---|---|---|
| `harness-plan-only.test.js` | `test:plan` | `/build --autonomous --plan-only` → `specs/` for inspection, then stop. Cheapest. |
| `harness-semi-auto-run.test.js` | `test:semi` | Mode 2: `/build --autonomous` plans then **pauses at the approval gate** (no silent build). |
| `harness-auto-run.test.js` | `test:auto` | Mode 1: `/build --auto` runs the full pipeline with **zero human gates**; the generated app's own suite is the oracle. |
| `harness-selfheal-smoke.test.js` | `test:smoke` | Self-healing: build a counter web app → Playwright verify → `/change` add a feature → regression, with a bounded fix loop. Browser is the independent oracle. |

Plus the pre-existing certification layers (`harness-real-workflow`,
`harness-adversarial-*`, `harness-pipeline*`, `harness-brownfield`,
`harness-native-commands`) and `run.sh`, which runs the certification stack.

## Notes
- **Local vs distributed:** the local `--auto` run uses a single integrated build
  (no remote in a temp repo). Per-cluster PR fan-out (`--pod`) and `AUTO_MERGE`
  are the **distributed** path — validated against a real tracker via
  `symphony_clone/`, not here.
- **Fixtures:** `fixtures/counter-prd.md` (small, for the full auto/semi runs) and
  `fixtures/sample-prd.md` (bookmarks, for plan-only).
- **Output** (gitignored): `*-output/` dirs + `screenshots/`.
- **Reused, not reinvented:** every harness uses the shared
  `helpers/claude-runner.js` (budgeted, MCP-isolated `claude -p`); only the
  browser oracle (`helpers/app-runtime.js`) and the `specs/` summary
  (`helpers/specs-summary.js`) are harness-specific. Both have unit tests that
  run in `npm test`.
