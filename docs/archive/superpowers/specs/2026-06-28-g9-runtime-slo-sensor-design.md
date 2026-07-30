# G9 sensor-half — runtime-SLO sensor

**Date:** 2026-06-28
**Gap:** G9 sensor-half. The guide-half (merged) scaffolds a RED-metrics `/metrics` endpoint into generated server apps. This is the missing reader: a sensor that scrapes those product metrics and flags SLO breaches. Closes the `drift_sensors_planned` runtime-SLO entry (`harness-manifest.json`), which is `blocked_on` exactly this.

## Scope (decided)

- **Reusable module.** One `slo-check.js` + a pure parse lib. Wired into `/evaluate` (integration cadence — the app is already booted there) AND runnable standalone (`npm run slo -- --url <live>`) for the scheduled/drift use against a real deployment.
- **Signals:** primary = **5xx error-rate** vs `observability.slo.error_rate_pct` (nothing measures errors today); secondary = **p95 absolute-budget** vs `observability.slo.p95_ms` as a WARN. p95 *regression* stays owned by the existing perf ratchet (`perf-baseline.js`) — this sensor does not snapshot/diff p95.
- **Blocking:** error-rate over budget = **FAIL in Full, WARN in Lean** (mirrors the accessibility gate); p95 over budget = WARN always. Standalone use exits non-zero on an error-rate breach (cron/CI contract).
- **Count only 5xx**, never 4xx — deliberate negative tests (400/422) must not trip it.
- **No Prometheus server dependency** (scrape the text endpoint directly); **no per-route snapshot history** (absolute budgets only).

## §1 — `lib/prom-parse.js` (pure, no I/O)

Testable in isolation; fed raw Prometheus exposition text.

- `parseProm(text) -> Series[]` where `Series = { name, labels: {k:v}, value: number }`. Parses standard exposition lines `name{labels} value`, skips `# HELP`/`# TYPE` comments.
- `errorRate(series) -> number | null` = `sum(http_requests_total where status matches /^5/) / sum(http_requests_total)`, expressed as a **percent** (0–100). Returns `null` when total requests == 0 (no traffic → not a breach).
- `histogramP95(series) -> number | null` = standard Prometheus histogram-quantile (q=0.95) over `http_request_duration_seconds_bucket` cumulative buckets (the `le` label), linear-interpolated within the crossing bucket, converted to **milliseconds**. Returns `null` when `_count` == 0 or no buckets present.

## §2 — `scripts/slo-check.js`

Resolves, in order:
- **base URL** from `--url`, else `project-manifest.json#verification` (`local.backend_url` / docker `evaluation.api_base_url`);
- **metrics_path** from `--metrics-path`, else `project-manifest.json#observability.metrics_path` (default `/metrics`);
- **budgets** from `project-manifest.json#observability.slo` (`error_rate_pct`, `p95_ms`).

Behavior:
- If `observability.enabled` is false (or block absent) → exit **0**, verdict `disabled`. Nothing to check.
- Fetch `<base><metrics_path>` with 3 retries (reuse the evaluator's retry shape). Unreachable after retries → exit **2** (WARN), verdict `unreachable`.
- Parse, compute `errorRate` and `histogramP95`.
- Write `specs/reviews/slo-verdict.json`:
  ```json
  { "verdict": "pass|fail|warn|disabled|unreachable",
    "error_rate_pct": <num|null>, "p95_ms": <num|null>,
    "budgets": { "error_rate_pct": <num>, "p95_ms": <num> },
    "breaches": ["error_rate" | "p95"], "scraped": "<url>" }
  ```
- **Exit codes** (mirroring `perf-baseline.js`): `1` if error-rate > budget (FAIL); `2` if only p95 > budget, or no-traffic, or unreachable (WARN); `0` otherwise.

## §3 — `/evaluate` integration

Add to `.claude/skills/evaluate/SKILL.md` "Performance Checks" a **Step P4 — SLO check**, after the app is booted and P1–P3 run (no new boot):
- Invoke `node .claude/scripts/slo-check.js`.
- Fold the verdict: `error_rate` breach → **FAIL** with `failure_layer: "slo"` in Full mode, **WARN** in Lean; `p95` breach → WARN in both. `disabled`/`unreachable`/no-traffic → WARN/skip, never FAIL.
- Note in `.claude/agents/evaluator.md` KEY RULES that a Full-mode SLO error-rate breach is a FAIL (alongside the perf ratchet and accessibility), counting only 5xx.

## §4 — Standalone / drift

- `package.json` script: `"slo": "node .claude/scripts/slo-check.js"`.
- `slo-check.js --url <live> [--metrics-path /metrics]` for `/schedule` or `/loop` against a real deployment; exit 1 on error-rate breach gives the cron/CI gate contract. Documented next to `npm run drift`.

## §5 — Registry + docs

- `harness-manifest.json`: replace the `drift_sensors_planned.still_planned` runtime-SLO entry with a real `sensors[]` entry — `{ id: "runtime-slo", axis: "behaviour", type: "computational", cadence: "integration", status: "active", wired_at: ".claude/scripts/slo-check.js", gap_ref: "G9", signal: "5xx error-rate over SLO; p95 over absolute budget", description: ... }`. Update `drift_sensors_planned` to note the runtime-SLO signal shipped (still_planned empty or removed).
- `HARNESS.md`: Behaviour *Sensors* row gains `runtime-SLO error-rate` ✅; holes line: G9 now fully done (guide + sensor), leaving G10–G12.
- `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`: G9 row → ✅ DONE (both halves); roadmap §5 updated.

## §6 — Tests (`node:test`)

- `test/prom-parse.test.js`: fixture exposition text → known error-rate (incl. a fixture with 4xx present that must NOT count, and a 0-traffic fixture → `null`); `histogramP95` against a known bucket set; malformed lines ignored.
- `test/slo-check.test.js` (contract): `observability.enabled:false` → exit 0 `disabled`; an error-rate-over-budget fixture → exit 1; p95-only-over-budget → exit 2; verdict JSON shape. (Scrape is stubbed/fed via `--url` to a local fixture server or a `--fixture <file>` flag for hermetic testing — no network in CI.)
- Wiring assertions: `evaluate/SKILL.md` documents Step P4 + `failure_layer: "slo"`; `package.json` has the `slo` script; `harness-manifest.json` `runtime-slo` sensor is `active` and `wired_at` resolves; `HARNESS.md`/gap-doc updated.
- `node .claude/scripts/validate-harness-manifest.js` passes; `npm test` green.

## Risks & mitigations

- **Hermetic testing of a network scrape.** Mitigation: add a `--fixture <file>` flag to `slo-check.js` that reads exposition text from a file instead of HTTP, so the contract test never opens a socket (avoids the open-handle hangs the suite is prone to).
- **Error-rate from eval's own traffic is small-sample.** Mitigation: it counts only 5xx; a single server error during eval is a legitimate signal. No statistical thresholding — absolute budget only, matching the guide-half's stated SLO.
- **Double-counting `/metrics` self-scrapes** (the guide-half noted the endpoint instruments itself). Mitigation: error-rate denominator includes all routes; a successful `/metrics` GET is a 200 and only dilutes error-rate harmlessly. No special-casing needed.

## Out of scope

Per-route p95 regression history (perf ratchet owns regression); 4xx/client-error budgets; latency SLOs beyond p95; a bundled Prometheus/Grafana for products (the harness's own telemetry stack is separate and unchanged).
