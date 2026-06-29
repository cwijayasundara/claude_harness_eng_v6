# G12 slice 4 — flake detection

**Date:** 2026-06-28
**Gap:** G12 (slice 4 of 4 — the last). Today flake handling is manual, per-check (the evaluator retries a flaky Playwright check once; `/auto` retries an `api_transient` once). There is no *systematic* detection of which tests are non-deterministic. `TESTING_AGENT_PROPOSAL.md` deferred "systematic flake detection (N× re-run)" to a P2 follow-on ("adds tool dependencies"). This slice ships the minimal bounded version.
**Done before this:** slice 1 (oasdiff), slice 2 (default-on a11y), slice 3 (approved-fixtures). **This completes G12 — and G1–G12.**

## Scope (decided)

- **Minimal:** a `flake-detector.js` script + `npm run flakes` + a drift-cadence manifest sensor + hermetic tests. Nothing more.
- **Per-test:** parse node:test TAP per run; a test that is both `ok` (some runs) and `not ok` (others) is a flake, named in the report.
- **Opt-in / drift cadence, non-blocking:** runnable on demand or via `/schedule`; exit 1 on flakes for the cron/CI signal, but **not** wired into `/gate` or `/auto` (a genuine flake should not block the change lifecycle).
- **Explicit EXCLUDES:** k6/Artillery load-flake; per-test quarantine DB; CI-matrix auto-retry; auto-retry-wrapping the real suite; statistical/Bayesian scoring; cross-run flake history/trend (P3); `/gate` or `/auto` wiring.

## §1 — `.claude/scripts/flake-detector.js`

Flags: `--test-cmd <cmd>` (default `npm test`), `--runs <N>` (default 5), `--timeout <ms>` per run (default 600000), `--out <path>` (default `specs/reports/flake-report.json`), `--root <dir>` (default cwd).

Two **pure** functions (exported for unit tests):
- `parseTap(stdout) -> { [testName]: 'ok' | 'not ok' }`. Parses lines matching `^(ok|not ok)\s+\d+\s+-\s+(.*)$` (node:test TAP); the test name is the captured remainder, trimmed of a trailing ` # ...` directive. Ignores the `TAP version` / `1..N` plan lines and `#` comments. On a duplicate name, last-write-wins (good enough; node:test names are typically unique per file-qualified run).
- `aggregateFlakes(perRun) -> [{ name, passed, failed }]` where `perRun` is an array of the per-run maps. For each test name, count runs where it was `ok` (passed) vs `not ok` (failed) across the maps that contain it; it is a flake iff `passed > 0 && failed > 0`.

CLI flow (the I/O shell):
1. Run `--test-cmd` `--runs` times via `spawnSync(cmd, { cwd: root, shell: true, timeout, encoding: 'utf8' })`.
2. For each run: if it timed out (`result.signal === 'SIGTERM'` / `result.error`) or `parseTap` yields zero tests → count as an **errored run**; else push the parsed map to `perRun`.
3. `flakes = aggregateFlakes(perRun)`.
4. Write `{ runs: N, completed_runs: perRun.length, errored_runs, flakes, all_consistent: flakes.length === 0 }` to `--out`.
5. Print a one-line summary (and list flaky test names).
6. **Exit:** `1` if `flakes.length > 0`; `2` if `perRun.length === 0` (no run produced parseable results — WARN "could not run the suite"); else `0`.

`module.exports = { parseTap, aggregateFlakes }` BEFORE the `require.main` guard.

## §2 — `npm run flakes`

`package.json`: `"flakes": "node .claude/scripts/flake-detector.js"`. Defaults baked into the script; override with `npm run flakes -- --runs 10 --test-cmd "npm run test:e2e"`. Document `/schedule`-ability (e.g. weekly) next to `npm run drift`. NOT wired into `/gate`/`/auto`.

## §3 — Registry + docs

- `harness-manifest.json`: new sensor `{ id: "flake-detection", axis: "behaviour", type: "computational", cadence: "drift", status: "active", scope: "repo", wired_at: ".claude/scripts/flake-detector.js", gap_ref: "G12", signal: "tests that pass and fail across repeated runs", description: "Flake detection (gap G12): flake-detector.js runs a test command N times (npm run flakes), parses node:test TAP per run, and reports tests that both passed and failed across runs. Drift cadence — opt-in / /schedule, non-blocking (exit 1 on flakes for cron/CI signal); deliberately NOT a /gate or /auto gate, since a genuine flake should not block the change lifecycle." }`. (`scope: "repo"`, `cadence: "drift"` — both validator-accepted.)
- `HARNESS.md`: Behaviour *Sensors* cell add `✅ **flake detection** (N× re-run, drift, G12)`. Holes line: **G12 ✅ done (all 4 slices)** — note the whole G1–G12 roadmap is now closed (remaining items are the recorded non-blocking minors + the P3 trend follow-on).
- `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`: G12 row → ✅ **DONE** (oasdiff + a11y + approved-fixtures + flake detection); §5 roadmap marks G12 complete and the roadmap fully shipped.

## §4 — Tests (`node:test`, hermetic — no real suite, no network)

- `test/flake-detector.test.js`:
  - `parseTap` unit: a TAP string with `ok 1 - a`, `not ok 2 - b # AssertionError`, plan + comment lines → `{ a: 'ok', b: 'not ok' }`.
  - `aggregateFlakes` unit: perRun `[{t:'ok'},{t:'not ok'},{t:'ok'}]` → `t` is a flake (passed 2, failed 1); a consistently-`ok` test → not a flake.
  - CLI against a **fake-flaky** command: write a tiny shell script to a temp dir that reads+increments a `counter` file in cwd and prints TAP `ok 1 - flaky test` on even counts, `not ok 1 - flaky test` on odd. Run the detector `--root <tmp> --test-cmd <fake> --runs 4 --out <tmp>/r.json`; assert exit 1 and the report's `flakes` names `flaky test`.
  - CLI against a **deterministic-pass** fake (always `ok 1 - stable`): exit 0, `all_consistent: true`, no flakes.
  - Wiring: `package.json` has the `flakes` script; `harness-manifest.json` `flake-detection` is `active`, `scope:"repo"`, `cadence:"drift"`, `wired_at` resolves.
- `node .claude/scripts/validate-harness-manifest.js` passes; `npm test` green.

## Risks & mitigations

- **Running the real suite N× could hit the known e2e open-handle hang.** Mitigation: the per-run `--timeout` records a hung run as an errored run (not a false flake); the detector is opt-in (the user chooses to run it); tests never touch the real suite (they use the fake command).
- **A timed-out/crashed run masquerading as a flake.** Mitigation: errored runs are excluded from `aggregateFlakes` — only runs that produced parseable TAP feed the pass/fail tally. `errored_runs` is reported separately.
- **TAP-format variance across runners.** Mitigation: `parseTap` targets node:test's TAP (the harness runner) and is a pure function the user can point at any TAP-emitting command via `--test-cmd`; non-TAP output simply yields zero tests → errored run (loud, not a silent pass).
- **Recursion / cost** (`npm run flakes` running `npm test` 5×). Mitigation: it runs `npm test`, never itself; opt-in; default N=5 is modest; `--runs` tunable.

## Out of scope

Everything on the EXCLUDE list above; integrating flake results into `features.json` or the evaluator; auto-stabilizing or skipping flaky tests; distinguishing UI vs API flakes; dynamic run-count escalation.
