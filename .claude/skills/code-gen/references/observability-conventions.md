# Observability conventions (stack-neutral)

Apply this when `project-manifest.json#observability.enabled` is `true` and the project exposes an HTTP server. It is additive depth on top of the generic Quality Principles (structured logging, a dependency-checking `/health`) — it does not restate them. For a concrete implementation, also read the matching `observability-<stack>.md`.

## What every instrumented server emits

1. **A `/metrics` endpoint** in Prometheus text exposition format, on the app's existing port, at `observability.metrics_path` (default `/metrics`). Do not open a new port.
2. **RED metrics**, via one request middleware:
   - `http_requests_total{method,route,status}` — a counter (Rate + Errors).
   - `http_request_duration_seconds{method,route}` — a histogram (Duration).
3. **Trace-id / request-id log correlation** — store the request id (and a `trace_id` if a tracer is present) in a request-scoped context and inject it into every structured log line, so a log, a metric, and a future trace share one id.

## Cardinality guardrail (do not skip)

- The **`route` label is the route template** (`/users/{id}`), never the concrete path (`/users/42`). Unbounded label values melt Prometheus.
- The default label set is exactly `observability.red_labels` = `["method","route","status"]`.
- **Never** label with user id, email, request id, full URL, query string, or any free-text/high-cardinality value.

## What NOT to do

- Do not export OTLP traces by default — the OTEL SDK + exporter is an opt-in extension, not the baseline. The baseline depends only on a Prometheus client.
- Do not add authentication or a second port for `/metrics` in the baseline.
- Do not emit business metrics speculatively; ship the RED baseline only.

## Verification

When `observability.enabled`, the story's acceptance criteria include: *"GET {metrics_path} returns 200 in Prometheus exposition format, including `http_requests_total` and `http_request_duration_seconds`."* Propose the matching `api_check` in the sprint contract so the evaluator probes it against the running app.
