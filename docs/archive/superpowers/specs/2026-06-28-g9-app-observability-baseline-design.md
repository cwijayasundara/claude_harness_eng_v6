# G9 — App-level observability baseline (guide-only)

**Date:** 2026-06-28
**Gap:** G9 (`docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`) — *Generated apps get no observability baseline.* The harness instruments **itself** (`telemetry/` → OTEL collector → Prometheus → Grafana) but scaffolds no traces / structured-metric conventions / `/metrics` endpoint **into the product apps it builds**, so the planned runtime sensors (SLO / error-rate / latency drift) have nothing to read.
**Manifest:** `observability-conventions` guide is registered `planned` (`wired_at: null`, `gap_ref: G9`).

## Scope (decided)

- **Guide-only.** Ship the feedforward guide (conventions + scaffolded instrumentation) + its deterministic anchors (manifest block, deploy scrape wiring). The **runtime-SLO drift sensor** is explicitly out of scope and remains a follow-on; after this pass it is blocked only on *sensor* work, not on the guide.
- **Default-on for server/API shapes, opt-out.** Generated backend/API services get the baseline automatically; CLI / library / static shapes get nothing. Off switch: `project-manifest.json#observability.enabled = false`. Mirrors how layered-architecture is on for server shapes and skipped otherwise.
- **Signal:** RED metrics + a `/metrics` endpoint + `trace_id`/`request_id` log correlation. (Structured JSON logging and a dependency-checking `/health` are already code-gen principles — G9 builds on them, does not restate them.)
- **Stacks:** concrete Python/FastAPI reference implementation + a stack-neutral conventions doc the generator applies to any backend via the existing drop-in-reference pattern. Frontend (React/TS) RUM/web-vitals is **deferred**.
- **Approach:** A — guide-first via code-gen references, with deterministic manifest + deploy anchors. (Rejected: B, a scaffold-time template — the app skeleton does not exist at scaffold time, codegen runs later in `/auto`; C, a shared library the harness publishes — cross-language packaging + version coupling.)

## § 1 — The contract

Every instrumented server emits:

1. **`/metrics` endpoint** — Prometheus text exposition format, served on the app's **existing port** (no new port), path configurable via `observability.metrics_path` (default `/metrics`).
2. **RED metrics**, produced by a single request middleware:
   - `http_requests_total{method,route,status}` — counter (Rate + Errors).
   - `http_request_duration_seconds{method,route}` — histogram (Duration; p50/p95/p99 derivable), buckets aligned to `execution.latency_budget_ms`.
   - **`route` label is the route *template*** (`/users/{id}`), never the raw path; `status` is the numeric code.
3. **Cardinality guardrail** — documented allowlist discipline: bounded label sets only; no user-id / email / raw-path / free-text labels. The default `red_labels` is `["method","route","status"]`.
4. **Log correlation** — the already-mandated request-ID middleware mints `request_id`; G9 adds storing it (and `trace_id` when a tracer is present) in a contextvar and injecting it into the existing JSON log formatter, so a log line, a metric, and a future trace share one id.
5. **No OTLP trace export by default** — the OTEL SDK tracer/meter providers + OTLP exporter are a **documented opt-in extension**, not part of the baseline, to keep the dependency footprint small. The baseline depends only on a Prometheus client.

## § 2 — Components and where they live

### Guide (feedforward) — the heart of the change
- **`.claude/skills/code-gen/references/observability-conventions.md`** (new) — stack-neutral. Defines the §1 contract, the cardinality rules, the opt-out, and an explicit "what NOT to do" list. The generator applies it to any backend stack. *Interface:* read by the generator when `observability.enabled` and the project exposes an HTTP server. *Depends on:* nothing.
- **`.claude/skills/code-gen/references/observability-python-fastapi.md`** (new) — concrete FastAPI implementation: a Starlette/ASGI middleware computing the counter + histogram; a `/metrics` route using `prometheus_client` (`generate_latest` / `CONTENT_TYPE_LATEST`); a `contextvars` + `logging.Filter` that injects `request_id`/`trace_id` into the JSON formatter. Names the dependency (`prometheus-client`). *Depends on:* `observability-conventions.md` (additive depth, the established reference pattern).

### Deterministic anchors — so the guide cannot be silently skipped
- **`.claude/agents/generator.md`** — add a criterion-phrased trigger to its stack-reference section: *when `project-manifest.json#observability.enabled` is true and the project exposes an HTTP server, also read `observability-conventions.md` and the matching `observability-<stack>.md`, and emit the instrumentation as part of the API layer.* Model-agnostic, no model named (per `docs/prompting-standards.md`).
- **`project-manifest.json#observability`** — new block:
  ```json
  "observability": {
    "enabled": true,
    "metrics_path": "/metrics",
    "red_labels": ["method", "route", "status"],
    "slo": { "error_rate_pct": 1.0, "p95_ms": <from latency_budget_ms.read> }
  }
  ```
- **`.claude/scripts/scaffold-render.js` `buildManifest()`** — default `observability.enabled = true` when a server/API backend is detected, `false` for CLI / library / static shapes. SLO budgets default from the existing `execution.latency_budget_ms`.
- **`.claude/commands/scaffold.md`** — document the `observability` block in the manifest-schema section.
- **`.claude/skills/deploy/SKILL.md`** — when `observability.enabled`, add Prometheus scrape annotations/labels (`prometheus.io/scrape`, `prometheus.io/path`, `prometheus.io/port`) to the backend service in `docker-compose.yml`, and document that the harness's own Prometheus (or any Prometheus) can scrape `<service>{metrics_path}`. Stays infra-only — **no app-source edits in deploy**.

### Registry + docs
- **`harness-manifest.json`** — flip `observability-conventions` from `planned` → `active`, `wired_at` the conventions reference; update its description to name the FastAPI reference and the deploy/scaffold anchors. The `drift_sensors_planned` runtime-SLO entry stays `planned` (its `blocked_on` note narrows to the sensor build).
- **`HARNESS.md`** — Architecture *Guides* cell: add `observability-conventions` ✅; update the holes line (G9 guide-half done, sensor-half remains).
- **`docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`** — mark G9 guide-half DONE, sensor-half still open; reflect in the roadmap.

## § 3 — Verification

**Keeping "guide-only" honest without building the sensor.** When `observability.enabled`, the planning artifacts add one acceptance criterion: *"GET {metrics_path} returns 200 in Prometheus exposition format, including `http_requests_total` and `http_request_duration_seconds`."* The evaluator's existing Layer-1 API check probes it against the running app — **no evaluator code change** — exactly how a `/health` AC is handled today. The generator proposes the matching `api_check` in the sprint contract.

**Harness self-tests** (`node:test`, a new `test/g9-observability-baseline.test.js`):
- the two new references exist and document the RED contract, `/metrics`, the cardinality rule, and the opt-out;
- `generator.md` carries the observability trigger;
- `scaffold-render.js buildManifest()` defaults `observability.enabled` by app shape (server → true, CLI/library → false);
- `deploy/SKILL.md` documents the scrape annotation gated on `observability.enabled`;
- `harness-manifest.json` `observability-conventions` is `active` and its `wired_at` resolves on disk;
- `node .claude/scripts/validate-harness-manifest.js` still passes and `npm test` is green.

## § 4 — Scope guardrails (YAGNI)

Explicitly **not** in this pass: frontend RUM / web-vitals; default OTLP trace export; the runtime-SLO drift sensor; any new network port; any second backend stack (Node/Go/Java get the stack-neutral conventions doc but no concrete reference yet — a drop-in follow-on).

## Risks & mitigations

- **Generation is non-deterministic** (the generator could under-instrument). *Mitigation:* the contract is a code-gen reference (high adherence), the deterministic manifest/deploy anchors make intent explicit, and the `/metrics` acceptance criterion turns "did it actually happen" into a runtime check the evaluator already performs.
- **Cardinality blow-up** from a careless label. *Mitigation:* the `route`-template rule and the `red_labels` allowlist are stated as hard conventions with a "what NOT to do" list.
- **Dependency creep.** *Mitigation:* baseline depends only on a Prometheus client; full OTEL is opt-in and documented separately.

## Out-of-scope follow-ons (recorded, not built here)

1. **Runtime-SLO drift sensor** — scrape `/metrics` (or Prometheus) on a cadence / during `/evaluate`, compare error-rate and p95 against `observability.slo`, flag regressions. Closes the G9 sensor-half.
2. **Second backend reference** — `observability-node-express.md` etc., drop-in.
3. **Opt-in OTLP trace export** extension doc.
