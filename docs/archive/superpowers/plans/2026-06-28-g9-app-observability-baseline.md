# G9 App-Level Observability Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the harness scaffold a RED-metrics + `/metrics` + trace-id-log-correlation observability baseline into the server apps it generates, as a feedforward code-gen guide with deterministic manifest and deploy anchors.

**Architecture:** A new stack-neutral code-gen reference (`observability-conventions.md`) plus a concrete `observability-python-fastapi.md` steer the generator to emit instrumentation as part of the app's API layer. A `project-manifest.json#observability` block (defaulted on for server shapes by `scaffold-render.js`) and a Prometheus scrape annotation in `deploy` are the deterministic anchors. The `/metrics` endpoint becomes a verifiable acceptance criterion the existing evaluator probes — no evaluator code change, and no runtime-SLO drift sensor in this pass.

**Tech Stack:** Markdown references; Node.js (`scaffold-render.js`, `node:test`); the harness registry (`harness-manifest.json` + `validate-harness-manifest.js`). The generated-app code shown in references targets Python/FastAPI + `prometheus-client`.

## Global Constraints

- **Guide-only.** Do NOT build the runtime-SLO drift sensor, frontend RUM, default OTLP trace export, or any new network port. (Spec §4.)
- **Default-on for server/API shapes, opt-out** via `project-manifest.json#observability.enabled=false`; CLI/library/static (lite-shaped) projects default to `enabled:false`. (Spec scope.)
- **Cardinality guardrail:** the `route` metric label is the route *template* (`/users/{id}`), never the raw path; default `red_labels` is exactly `["method","route","status"]`; no user-id/email/free-text labels. (Spec §1.)
- **Metric names are fixed:** `http_requests_total` (counter) and `http_request_duration_seconds` (histogram). (Spec §1, §3.)
- **Prompting standards:** any prompt edit (`generator.md`) names no model and is phrased as a criterion, not a nudge (`docs/prompting-standards.md`).
- **Manifest honesty:** every `active` entry in `harness-manifest.json` must point at a real `wired_at` file; `node .claude/scripts/validate-harness-manifest.js` must pass.
- **Commit message trailer:** end every commit with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Create** `.claude/skills/code-gen/references/observability-conventions.md` — stack-neutral contract (Task 2).
- **Create** `.claude/skills/code-gen/references/observability-python-fastapi.md` — concrete FastAPI implementation (Task 2).
- **Create** `test/g9-observability-baseline.test.js` — all contract tests; grows across Tasks 1–4.
- **Modify** `.claude/scripts/scaffold-render.js` — `buildManifest()` emits the `observability` block (Task 1).
- **Modify** `.claude/commands/scaffold.md` — document the `observability` block in the manifest schema (Task 1).
- **Modify** `.claude/agents/generator.md` — Stack Expertise section gains the observability trigger (Task 2).
- **Modify** `.claude/skills/deploy/SKILL.md` — scrape annotations gated on `observability.enabled` (Task 3).
- **Modify** `harness-manifest.json` — flip `observability-conventions` guide `planned→active` (Task 4).
- **Modify** `HARNESS.md` — Architecture matrix + holes line (Task 4).
- **Modify** `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md` — mark G9 guide-half DONE (Task 4).

---

### Task 1: `observability` manifest block + scaffold default

**Files:**
- Modify: `.claude/scripts/scaffold-render.js` (`buildManifest`, ~line 70-100)
- Modify: `.claude/commands/scaffold.md` (manifest schema section, ~line 170-194)
- Test: `test/g9-observability-baseline.test.js` (create)

**Interfaces:**
- Consumes: `buildManifest(profile)` and `isLiteShaped(profile)` already in `scaffold-render.js`; `module.exports.buildManifest`.
- Produces: `manifest.observability = { enabled: boolean, metrics_path: string, red_labels: string[], slo: { error_rate_pct: number, p95_ms: number } }`. `enabled` is `true` only for non-lite projects that have a backend.

- [ ] **Step 1: Write the failing test**

Create `test/g9-observability-baseline.test.js`:

```javascript
'use strict';

// Contract for gap G9: app-level observability baseline (guide-only).
// The harness scaffolds a RED-metrics + /metrics + log-correlation baseline
// into generated server apps via a feedforward code-gen guide, defaulted on
// for server shapes with deterministic manifest + deploy anchors.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { buildManifest } = require('../.claude/scripts/scaffold-render.js');

test('G9: buildManifest defaults observability on for a server shape', () => {
  const m = buildManifest({
    name: 'api', projectType: 'C',
    stack: { backend: { language: 'python', framework: 'FastAPI' }, database: { engine: 'postgres' } },
  });
  assert.ok(m.observability, 'manifest must carry an observability block');
  assert.strictEqual(m.observability.enabled, true);
  assert.strictEqual(m.observability.metrics_path, '/metrics');
  assert.deepStrictEqual(m.observability.red_labels, ['method', 'route', 'status']);
  assert.strictEqual(typeof m.observability.slo.error_rate_pct, 'number');
  assert.strictEqual(typeof m.observability.slo.p95_ms, 'number');
});

test('G9: buildManifest defaults observability off for a lite (CLI/library) shape', () => {
  const m = buildManifest({ name: 'tool', projectType: 'D', stack: { backend: { language: 'python' } } });
  assert.ok(m.observability, 'observability block present even when disabled');
  assert.strictEqual(m.observability.enabled, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/g9-observability-baseline.test.js`
Expected: FAIL — `m.observability` is `undefined`.

- [ ] **Step 3: Add the observability block to `buildManifest`**

In `.claude/scripts/scaffold-render.js`, inside `buildManifest`, after the `manifest` object literal is created and before the `if (Array.isArray(profile.frameworkPacks) ...)` block, insert:

```javascript
  // G9: app-level observability baseline. Default ON for server/API shapes
  // (a backend that isn't lite-shaped), OFF for CLI/library/static projects.
  // Opt out per project with observability.enabled = false.
  manifest.observability = {
    enabled: !lite && !!stack.backend,
    metrics_path: '/metrics',
    red_labels: ['method', 'route', 'status'],
    slo: { error_rate_pct: 1.0, p95_ms: 500 },
  };
```

(`lite` and `stack` are already in scope at that point in `buildManifest`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/g9-observability-baseline.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Document the block in the manifest schema**

In `.claude/commands/scaffold.md`, in the manifest-schema section (the JSON shape around line 170-194), add an `observability` line alongside the other top-level keys:

```
  "observability": { "enabled": bool, "metrics_path": "/metrics", "red_labels": ["method","route","status"], "slo": {"error_rate_pct", "p95_ms"} } | omitted for lite shapes,
```

Add one sentence after the schema: *"`observability` (G9): default-on for server shapes; the generator reads the observability code-gen references when `enabled` and the project exposes an HTTP server. Set `enabled:false` to opt out."*

- [ ] **Step 6: Commit**

```bash
git add test/g9-observability-baseline.test.js .claude/scripts/scaffold-render.js .claude/commands/scaffold.md
git commit -m "feat(g9): observability manifest block, default-on for server shapes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Code-gen references + generator trigger (the guide)

**Files:**
- Create: `.claude/skills/code-gen/references/observability-conventions.md`
- Create: `.claude/skills/code-gen/references/observability-python-fastapi.md`
- Modify: `.claude/agents/generator.md` (Stack Expertise section, ~line 171-181)
- Test: `test/g9-observability-baseline.test.js` (append)

**Interfaces:**
- Consumes: nothing from Task 1 at runtime (the generator reads `manifest.observability.enabled` produced by Task 1).
- Produces: two reference files the generator reads; a trigger sentence in `generator.md` that names `observability-conventions.md` and the `observability.enabled` condition.

- [ ] **Step 1: Write the failing test (append to the test file)**

```javascript
const CONV = '.claude/skills/code-gen/references/observability-conventions.md';
const FASTAPI = '.claude/skills/code-gen/references/observability-python-fastapi.md';

test('G9: stack-neutral observability conventions reference documents the contract', () => {
  const c = read(CONV);
  assert.ok(/http_requests_total/.test(c) && /http_request_duration_seconds/.test(c),
    'must name the two RED metrics');
  assert.ok(/\/metrics/.test(c), 'must document the /metrics endpoint');
  assert.ok(/route template/i.test(c) && /cardinalit/i.test(c),
    'must state the route-template cardinality guardrail');
  assert.ok(/observability\.enabled/.test(c), 'must document the opt-out');
  assert.ok(/trace_id|request_id/.test(c), 'must require log correlation');
});

test('G9: FastAPI observability reference carries a concrete implementation', () => {
  const f = read(FASTAPI);
  assert.ok(/prometheus[_-]client/.test(f), 'must name the prometheus-client dependency');
  assert.ok(/generate_latest/.test(f) && /CONTENT_TYPE_LATEST/.test(f),
    'must show the /metrics response');
  assert.ok(/Middleware/.test(f), 'must show the request middleware');
  assert.ok(/ContextVar|contextvars/.test(f), 'must show the contextvar log correlation');
});

test('G9: generator is triggered to read the observability references', () => {
  const g = read('.claude/agents/generator.md');
  assert.ok(/observability-conventions\.md/.test(g), 'generator must point at the conventions reference');
  assert.ok(/observability\.enabled/.test(g), 'trigger must be gated on observability.enabled');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/g9-observability-baseline.test.js`
Expected: FAIL — reference files do not exist; generator has no trigger.

- [ ] **Step 3: Create `observability-conventions.md`**

Create `.claude/skills/code-gen/references/observability-conventions.md` with this content:

````markdown
# Observability conventions (stack-neutral)

Apply this when `project-manifest.json#observability.enabled` is `true` and the project exposes an HTTP server. It is additive depth on top of the generic Quality Principles (structured logging, a dependency-checking `/health`) — it does not restate them. For a concrete implementation, also read the matching `observability-<stack>.md`.

## What every instrumented server emits

1. **A `/metrics` endpoint** in Prometheus text exposition format, on the app's existing port, at `observability.metrics_path` (default `/metrics`). Do not open a new port.
2. **RED metrics**, via one request middleware:
   - `http_requests_total{method,route,status}` — a counter (Rate + Errors).
   - `http_request_duration_seconds{method,route}` — a histogram (Duration).
3. **Trace-id / request-id log correlation** — store the request id (and a `trace_id` if a tracer is present) in a request-scoped context and inject it into every structured log line, so a log, a metric, and a future trace share one id.

## Cardinality guardrail (do not skip)

- The **`route` label is the route *template*** (`/users/{id}`), never the concrete path (`/users/42`). Unbounded label values melt Prometheus.
- The default label set is exactly `observability.red_labels` = `["method","route","status"]`.
- **Never** label with user id, email, request id, full URL, query string, or any free-text/high-cardinality value.

## What NOT to do

- Do not export OTLP traces by default — the OTEL SDK + exporter is an opt-in extension, not the baseline. The baseline depends only on a Prometheus client.
- Do not add authentication or a second port for `/metrics` in the baseline.
- Do not emit business metrics speculatively; ship the RED baseline only.

## Verification

When `observability.enabled`, the story's acceptance criteria include: *"GET {metrics_path} returns 200 in Prometheus exposition format, including `http_requests_total` and `http_request_duration_seconds`."* Propose the matching `api_check` in the sprint contract so the evaluator probes it against the running app.
````

- [ ] **Step 4: Create `observability-python-fastapi.md`**

Create `.claude/skills/code-gen/references/observability-python-fastapi.md` with this content:

````markdown
# Observability — Python / FastAPI

Concrete implementation of `observability-conventions.md` for FastAPI. Dependency: `prometheus-client`.

Create `backend/app/observability.py`:

```python
import time
from contextvars import ContextVar

from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

REQUESTS = Counter(
    "http_requests_total", "Total HTTP requests", ["method", "route", "status"]
)
LATENCY = Histogram(
    "http_request_duration_seconds", "HTTP request latency (seconds)", ["method", "route"]
)


def _route_template(request: Request) -> str:
    # Route matching happens during call_next; the matched route is on the scope
    # afterwards. Fall back to the raw path only if no route matched (404).
    route = request.scope.get("route")
    return getattr(route, "path", request.url.path)


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        template = _route_template(request)
        REQUESTS.labels(request.method, template, str(response.status_code)).inc()
        LATENCY.labels(request.method, template).observe(time.perf_counter() - start)
        return response


async def metrics_endpoint(_request: Request) -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
```

Wire it in the app factory (`backend/app/main.py`):

```python
from app.observability import MetricsMiddleware, metrics_endpoint

app.add_middleware(MetricsMiddleware)
app.add_route("/metrics", metrics_endpoint)  # use observability.metrics_path
```

Log correlation — extend the existing JSON logging config with a filter that reads the contextvar (the request-id middleware already sets `request_id_var`):

```python
import logging

class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        from app.observability import request_id_var
        record.request_id = request_id_var.get()
        return True
```

Add `request_id` to the JSON formatter's field list so every line carries it.

## Acceptance criterion

`GET /metrics` → 200, `Content-Type: text/plain; version=0.0.4`, body contains `http_requests_total` and `http_request_duration_seconds`.
````

- [ ] **Step 5: Add the generator trigger**

In `.claude/agents/generator.md`, in the "Stack Expertise" table (line 175-179), add a row after the React/TS row:

```
| `observability.enabled` is true and the project exposes an HTTP server | also `references/observability-conventions.md` + the matching `references/observability-<stack>.md` (e.g. `observability-python-fastapi.md`) |
```

Then after the table's closing paragraph (line 181), add:

```
When `project-manifest.json#observability.enabled` is true and the project serves HTTP, emit the RED-metrics + `/metrics` + log-correlation baseline as part of the API layer, following `observability-conventions.md`. Treat the conventions reference the same way as a stack reference: additive depth, applied to the files you own.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/g9-observability-baseline.test.js`
Expected: PASS (5 tests total).

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/code-gen/references/observability-conventions.md .claude/skills/code-gen/references/observability-python-fastapi.md .claude/agents/generator.md test/g9-observability-baseline.test.js
git commit -m "feat(g9): observability code-gen references + generator trigger

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Deploy scrape wiring

**Files:**
- Modify: `.claude/skills/deploy/SKILL.md` (`Step 3 — Generate docker-compose.yml`, ~line 53-62)
- Test: `test/g9-observability-baseline.test.js` (append)

**Interfaces:**
- Consumes: `observability.enabled` and `observability.metrics_path` from the manifest (Task 1).
- Produces: deploy documents Prometheus scrape annotations on the backend service, gated on `observability.enabled`. Infra-only — deploy never edits app source.

- [ ] **Step 1: Write the failing test (append)**

```javascript
test('G9: deploy wires Prometheus scrape discovery when observability is enabled', () => {
  const d = read('.claude/skills/deploy/SKILL.md');
  assert.ok(/prometheus\.io\/scrape/.test(d), 'must document the scrape annotation');
  assert.ok(/observability\.enabled/.test(d), 'scrape wiring must be gated on observability.enabled');
  assert.ok(/metrics_path/.test(d), 'must point the scrape at the configured metrics_path');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/g9-observability-baseline.test.js`
Expected: FAIL — deploy SKILL.md has no scrape annotation.

- [ ] **Step 3: Add the scrape-wiring requirement to deploy**

In `.claude/skills/deploy/SKILL.md`, in "Step 3 — Generate `docker-compose.yml`", add a bullet to the Requirements list:

```
- **Observability (G9):** when `project-manifest.json#observability.enabled` is true, add Prometheus scrape-discovery labels to the backend service so any Prometheus can scrape it — `prometheus.io/scrape: "true"`, `prometheus.io/path: "<observability.metrics_path>"`, `prometheus.io/port: "<backend port>"`. Do not modify application source here; deploy only wires the service so the app's existing `/metrics` endpoint is discoverable.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/g9-observability-baseline.test.js`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/deploy/SKILL.md test/g9-observability-baseline.test.js
git commit -m "feat(g9): deploy wires Prometheus scrape discovery for /metrics

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Registry + docs flip + validate

**Files:**
- Modify: `harness-manifest.json` (`observability-conventions` guide, line ~44; `drift_sensors_planned` note)
- Modify: `HARNESS.md` (Architecture matrix row ~line 62-63; holes line ~line 95)
- Modify: `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md` (G9 row in §3 table ~line 57; roadmap §5 ~line 151)
- Test: `test/g9-observability-baseline.test.js` (append)

**Interfaces:**
- Consumes: the two reference files created in Task 2 (the guide's `wired_at` target).
- Produces: `observability-conventions` guide is `active`, `wired_at` resolves on disk.

- [ ] **Step 1: Write the failing test (append)**

```javascript
test('G9: observability-conventions guide is active and wired in the manifest', () => {
  const manifest = JSON.parse(read('harness-manifest.json'));
  const guide = manifest.guides.find((g) => g.id === 'observability-conventions');
  assert.ok(guide, 'observability-conventions guide must exist');
  assert.strictEqual(guide.status, 'active');
  assert.strictEqual(guide.gap_ref, 'G9');
  assert.ok(guide.wired_at && fs.existsSync(path.join(ROOT, guide.wired_at)),
    'wired_at must resolve on disk');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/g9-observability-baseline.test.js`
Expected: FAIL — guide status is `planned` and `wired_at` is `null`.

- [ ] **Step 3: Flip the manifest guide to active**

In `harness-manifest.json`, replace the `observability-conventions` entry (currently `"wired_at": null, "status": "planned"`) with:

```json
    { "id": "observability-conventions", "axis": "architecture", "kind": "feedforward", "wired_at": ".claude/skills/code-gen/references/observability-conventions.md", "status": "active", "gap_ref": "G9", "description": "App-level observability baseline (gap G9, guide-half): the generator emits a RED-metrics + /metrics + trace-id-log-correlation baseline INTO generated server apps, steered by observability-conventions.md (stack-neutral) + observability-python-fastapi.md (concrete). Default-on for server shapes via project-manifest.json#observability (scaffold-render.js); deploy adds Prometheus scrape discovery; /metrics is a verifiable acceptance criterion. The runtime-SLO drift sensor that reads these signals is a separate follow-on." }
```

In the same file, in `drift_sensors_planned.still_planned`, narrow the runtime-SLO `blocked_on` note to reflect that the guide-half shipped:

```json
      { "signal": "runtime SLO / error-rate / latency regression", "blocked_on": "G9 sensor-half (the observability guide-half shipped; the drift sensor that scrapes /metrics is the remaining work)" }
```

- [ ] **Step 4: Run the manifest validator and the new test**

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: `harness-manifest OK: ... all wired_at paths resolve.`
Run: `node --test test/g9-observability-baseline.test.js`
Expected: PASS (7 tests total).

- [ ] **Step 5: Update HARNESS.md**

In `HARNESS.md`, in the **Architecture** matrix row (line ~62-63), add `observability-conventions` to the **Guides** cell:

```
| | `architecture.md` · `project-manifest.json#architecture` (layer config) · ✅ **observability conventions** (RED metrics + /metrics scaffolded into generated server apps, G9) | <existing sensors cell> |
```

and in the **Sensors** cell of that row, change `⛔ observability conventions in generated app (G9)` to `⛔ runtime SLO/error-rate drift sensor (G9 sensor-half)`.

In the holes list (line ~95), change the `G9–G12` line to:

```
- **G9 sensor-half, G10–G12 (P2)** — the runtime-SLO drift sensor that reads the new app metrics (G9's guide-half shipped: `observability-conventions`), harness templates per topology, a harness-coverage metric, and behaviour extras.
```

- [ ] **Step 6: Update the gap analysis doc**

In `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`, change the G9 row status (line ~57) from `Missing | **P2**` to:

```
| ✅ **DONE (guide-half)** — `observability-conventions.md` + `observability-python-fastapi.md` code-gen guides emit RED metrics + `/metrics` + log correlation into generated server apps; default-on via `project-manifest.json#observability`; deploy wires Prometheus scrape. Runtime-SLO drift sensor remains (sensor-half). | **P2** |
```

In the §5 roadmap Phase 3 list (line ~151), update the G9 bullet to note the guide-half is done and the drift sensor is the remainder.

- [ ] **Step 7: Run the full suite**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `fail 0`, with the test count increased by 7.

- [ ] **Step 8: Commit**

```bash
git add harness-manifest.json HARNESS.md docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md test/g9-observability-baseline.test.js
git commit -m "feat(g9): register observability-conventions guide active; docs + registry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §1 contract (/metrics, RED metrics, route-template cardinality, log correlation, no-OTLP-default) → Task 2 references + tests. ✅
- §2 components: conventions ref + FastAPI ref → Task 2; generator trigger → Task 2; manifest block + scaffold default + scaffold.md doc → Task 1; deploy scrape → Task 3; registry/HARNESS/gap-doc → Task 4. ✅
- §3 verification: `/metrics` acceptance-criterion pattern documented in both references (Task 2); harness self-tests across Tasks 1-4; validator + npm test in Task 4. ✅
- §4 guardrails: encoded in Global Constraints + the "What NOT to do" section of the conventions ref. ✅

**Placeholder scan:** No TBD/TODO; every code/markdown step shows full content; commands have expected output. ✅

**Type/name consistency:** `manifest.observability.{enabled,metrics_path,red_labels,slo}` is defined in Task 1 and consumed unchanged in Tasks 3-4; metric names `http_requests_total` / `http_request_duration_seconds` and the `observability-conventions.md` filename are identical across all tasks and tests. ✅

**Note on test growth:** `test/g9-observability-baseline.test.js` is created in Task 1 and appended to in Tasks 2-4; each task runs the file and expects the running total noted (2 → 5 → 6 → 7).
