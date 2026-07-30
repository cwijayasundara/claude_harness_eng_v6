# Sensors-CLI parity — design

**Date:** 2026-07-14
**Branch:** `sensors-cli-parity`
**Status:** approved (design), pending implementation plan

## Motivation

Birgitta Böckeler's [Sensors for coding agents](https://martinfowler.com/articles/sensors-for-coding-agents.html) added an "Appendix: About tooling" describing a `sensors-cli` sidecar ([birgitta410/sensors-cli](https://github.com/birgitta410/sensors-cli)). Our harness already has 72 registered sensors with enforcement the article calls unsolved (agents *can't* skip our hook/pre-commit sensors) — so this is not a catch-up. The value is three factoring ideas from `sensors-cli` that are better-factored than our current shape:

1. **Normalized sensor-output schema** — one JSON shape all sensors emit, so one parser reads everything (composability over plugins).
2. **A "which sensors never fire / never fail?" meta-signal** — self-audit of whether sensors are actually biting.
3. **A low-friction custom-sensor slot** — downstream projects add a project-specific check without touching harness internals.

We deliberately **decline** the sidecar daemon / watch mode: our hooks fire exactly on save/commit (no polling, no stale state) and a long-lived daemon collides with the iCloud-sync process-hygiene issues this checkout already fights.

## Scope decisions (locked)

| # | Decision |
|---|---|
| 1 | Adapter, no rewrites: define schema + `normalize()` adapter; refactor quality-card internals; **output stays byte-stable**; 14 producers untouched. |
| 2 | Instrument (2a) + report (2b). Report-only, advisory, feeds `/retro`. |
| 3 | `project-manifest.json#custom_sensors[]` (JSON); opt-in blocking (default report-only); commit + on-demand cadence only. |
| Packaging | One branch, 3 stacked PRs (#1 → #2 → #3). Human merges in order. No auto-merge. |

---

## Feature 1 — Normalized sensor schema (shared foundation)

### Canonical shape

New module `.claude/hooks/lib/sensor-schema.js`:

```js
// canonical result
{
  findings: [{ message, severity, file, line, column, rule, context }],
  metrics:  [{ key, label, value, direction }],   // direction: "less" | "more"
  guidance: [{ rule, body }],
  score:    { value, direction, description },
  success:  boolean,
  summary:  string,
  extra:    {},
}
```

Field defaults (mirroring sensors-cli's `default` parser): absent `findings/metrics/guidance` → `[]`; absent `extra` → `{}`; absent `success` → `findings.length === 0`; absent `summary` → `"N issue(s)"` / `"No issues"`; absent `score.value` → `findings.length`; `score.direction` default `"less"`. Every result additionally carries a `schema` version stamp (`SCHEMA_VERSION`) for forward-compat — additive to the shape above; consumers read the named fields, never assert `additionalProperties:false`.

### Exports

- `normalize(raw, kind)` — maps our existing verdict shapes into the canonical shape. `kind ∈ {json_pass, json_verdict, md_verdict}` (the same kinds quality-card already uses). Pure function.
- `parseDefault(stdout)` — the "default parser": `JSON.parse` a tool's stdout and apply the field-defaults above. Used by custom sensors (#3) and future native sensors. Tolerates non-JSON stdout → returns a `success:false` result with the raw text as `summary` (never throws).
- `SCHEMA_VERSION` constant.

### quality-card refactor

`quality-card.js:loadChecks` routes every `SOURCES` entry through `normalize()` instead of the bespoke `interpretJson`/`interpretMdVerdict` branching (those move behind `normalize`). **Constraint: `specs/reviews/quality-card.json` and `.md` output must stay byte-for-byte stable** — `gate-receipt.json` and pr-body consume them. Enforced by a golden-output test: capture current output on a fixture set, assert the refactor reproduces it exactly.

### Non-goals

- Not rewriting the 14 producer scripts to emit the schema.
- Not changing quality-card's public output.

---

## Feature 2 — "Are sensors biting?" meta-sensor

### The data gap (why 2a is needed)

`telemetry-ledger.jsonl` records `turn`/`tool`/`prompt`/`subagent_stop` events only — **never per-sensor outcomes**. So the article's questions ("which never fail?") cannot be answered from existing data. We add a minimal, isolated instrumentation source.

### 2a — instrument (commit-cadence gates only)

`gate-registry.js:runPreCommit` loops `g.run(ctx)` over the 17 commit gates — a single clean chokepoint.

- Wrap the loop so each gate that returns (didn't block) appends `{ sensor, ran:true, blocked:false, ts }` to append-only `.claude/state/sensor-outcomes.jsonl`.
- A gate that blocks calls `fail()` (in `pre-commit-util`) → `process.exit(1)`. The wrapper cannot observe an outcome past `process.exit`, so the block event is recorded **inside `fail()`** (the single block path): it appends `{ sensor, ran:true, blocked:true, ts }` for the current sensor (tracked via `setFailContext`) immediately before exit.
- **Safety invariant:** all appends are `try/catch` and best-effort — a logging failure MUST NOT change gate control flow (never block a commit that would pass, never pass one that would block). Verified by a test that makes the ledger unwritable and asserts the gate outcome is unchanged.
- Scope: commit gates only. Session/integration/drift/inferential sensors are out of 2a for now (multiple entry points, lower marginal signal). Documented as a known bound.

### 2b — report (in loop-health)

A new `loop-health.js` signal with two parts:

- **Static (day-one value, no history):** cross-check `harness-manifest.json` `status:active` sensors against what is actually invoked (gate-registry `GATE_CATALOG`, `.claude/settings.json` hook matchers). Flag **registered-but-unwired** sensors ("dead" — registered but nothing runs them). This is deterministic and distinct from `harness-coverage.js` (which measures *file* coverage, not *invocation*).
- **Historical (accrues over runs):** over `sensor-outcomes.jsonl`, flag **never-fired** commit gates and **fired-but-never-blocked** commit gates. Emits `"accruing history"` until a minimum sample of **≥ 5 commit runs** exists, so it never cries wolf on a cold ledger.
- Always advisory (exit 0). Surfaces in the loop-health scorecard consumed by `/retro`.

### Manifest registration

Add sensor entry `biting-meta` (axis: maintainability, type: computational, cadence: drift, status: active, wired_at: `.claude/scripts/loop-health.js`). The instrumentation itself is infrastructure, not a separate sensor.

---

## Feature 3 — Custom-sensor slot

### Config

`project-manifest.json#custom_sensors[]`:

```json
"custom_sensors": [
  { "id": "my-check", "command": "some-tool | to-json",
    "parser": "default", "cadence": "commit", "blocking": false }
]
```

- `parser`: only `"default"` supported initially (uses `parseDefault` from #1).
- `cadence`: `"commit"` or `"on-demand"`. (`session` intentionally unsupported — no clean hook injection point.)
- `blocking`: default `false` (report-only). `true` → `fail()` when the parsed result has `success:false`.

### Runner

New `.claude/scripts/run-custom-sensors.js`:

- Reads `custom_sensors[]`, runs each `command` in a shell, pipes stdout through `parseDefault`.
- Returns normalized results; writes `specs/reviews/custom-sensors.json`.
- `npm run custom-sensors` for on-demand use.

### Commit integration

`runPreCommit` loads `custom_sensors` with `cadence:"commit"` and runs them **after** the built-in catalog. `sensor-tier.isGateEnabled` already returns `true` for unknown gate ids (fail-safe), so custom gates run in every tier unless the entry is disabled. Blocking entries call `fail()`; report-only entries append to `sensor-outcomes.jsonl` and the custom-sensors report.

### Validation & scaffold

- JSON-schema for the `custom_sensors[]` entry; `validate-harness-manifest.js` (or manifest validation) checks shape.
- `/scaffold` copies an empty `custom_sensors: []` into target `project-manifest.json`.
- Manifest registration: sensor entry `custom-sensor-runner` (axis: traceability, type: computational, cadence: commit, status: active, wired_at: `.claude/scripts/run-custom-sensors.js`).

---

## Cross-cutting

### Testing (TDD, red first)

| Area | Test |
|---|---|
| #1 | `normalize()` per kind; `parseDefault` defaults + non-JSON tolerance; **quality-card golden-output stability** |
| #2a | outcome appended on pass and on block; **unwritable-ledger → gate control flow unchanged** |
| #2b | static unwired detection on a seeded manifest/registry mismatch; historical never-fired/never-blocked over a seeded ledger; "accruing history" under min sample |
| #3 | custom sensor report-only vs blocking; `parseDefault` wiring; on-demand runner output; disabled/malformed entry handled |

### Manifest honesty

Every new `active` sensor entry points at a file that exists (enforced by `scaffold-copy-completeness.test.js` / `hook-requires-tracked.test.js` + `validate-harness-manifest.js`). `HARNESS.md` matrix updated for the two new sensors.

### Packaging

One branch `sensors-cli-parity`:
- **PR 1** — sensor-schema.js + quality-card refactor (output-stable).
- **PR 2** — 2a instrumentation + 2b loop-health signal + manifest entry. Depends on PR 1 only conceptually (independent code).
- **PR 3** — custom_sensors runner + commit integration + manifest entry + scaffold. Depends on PR 1's `parseDefault`.

Human merges in order. No auto-merge (harness rule: merge stays human).

### Explicitly out of scope

- The sidecar daemon / watch mode (declined — hooks already cover continuous running better).
- Rewriting the 14 quality-card producers.
- Instrumenting non-commit-cadence sensors in 2a.
- YAML config (`*.sensors.yaml`) — we stay in `project-manifest.json`.
