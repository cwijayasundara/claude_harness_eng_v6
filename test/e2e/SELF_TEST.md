# E2E self-test harnesses (live `claude -p`)

All live end-to-end harnesses live here under `test/e2e/`. They run real
`claude -p` against the harness plugin, cost tokens, and are **not** part of
`npm test` (the fast unit/contract suite). Each has a cheap static **contract**
in `test/*-contract.test.js` that pins its shape in CI without a live run.

Run them from the repo root through the e2e pack runner:

```bash
npm install
npm run test:e2e:fast       # no live Claude and no local server; contracts + safe helper tests
npm run test:e2e:live       # plan → semi → auto → smoke
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
| `harness-semi-auto-run.test.js` | `npm run test:semi` or `npm run test:e2e:live -- --only semi` | Mode 2: `/build --autonomous` plans then **pauses at the approval gate** (no silent build). |
| `harness-auto-run.test.js` | `npm run test:auto` or `npm run test:e2e:live -- --only auto` | Mode 1: `/build --auto` runs the full pipeline with **zero human gates**; the generated app's own suite is the oracle. |
| `harness-selfheal-smoke.test.js` | `npm run test:smoke` or `npm run test:e2e:live -- --only smoke` | Self-healing: build a counter web app → Playwright verify → `/change` add a feature → regression, with a bounded fix loop. Browser is the independent oracle. |

Plus the pre-existing certification layers (`harness-real-workflow`,
`harness-adversarial-*`, `harness-pipeline*`, `harness-brownfield`,
`harness-native-commands`) under `npm run test:e2e:cert`.

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
