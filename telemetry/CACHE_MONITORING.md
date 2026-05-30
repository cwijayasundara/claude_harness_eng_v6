# Prompt-Cache Monitoring

Claude Code is built around prompt caching: the API caches the request prefix (static
system prompt + tools → `CLAUDE.md` → session context) and reuses it across turns. A
high cache-read ratio is what makes long agentic sessions cheap and fast. Caching is
**automatic and always-on inside Claude Code** — there is nothing to "enable", and this
harness makes no direct API calls, so there are no `cache_control` breakpoints to set.
The job is to make sure the harness doesn't *break* the cached prefix, and to alert when
it does. (See the "Prompt Caching" section of the root `CLAUDE.md` for the design rules.)

## Files

| File | Purpose |
|---|---|
| `cache-alerts.rules.yml` | Recording rule for cache hit rate + warning/critical alerts |
| `grafana/dashboards/cache-health.json` | Dashboard: hit-rate stat, trend, token mix, cache-creation spikes |

These sit alongside the existing `prometheus.yml`, `otel-collector-config.yml`, and
`grafana/` provisioning in this directory.

## Wire-up

Both pieces are already wired into the existing stack — no manual import needed:

1. **Prometheus** — `prometheus.yml` references the rules via `rule_files:
   [cache-alerts.rules.yml]`. The rules file must be mounted into the Prometheus config
   dir alongside `prometheus.yml` (adjust the path if your mount layout differs). Reload
   Prometheus after first adding it.
2. **Grafana** — `cache-health.json` lives in `grafana/dashboards/`, which the existing
   provider in `grafana/provisioning/dashboards/dashboards.yml` auto-loads from
   `/etc/grafana/dashboards` (same mechanism as `harness-overview.json`). It uses the
   default Prometheus datasource provisioned in
   `grafana/provisioning/datasources/prometheus.yml`.
3. **Alertmanager** — route `component: prompt-cache` alerts wherever you want them.

The token-usage metric comes from Claude Code's native OTEL export (the OTLP endpoint
configured by `OTEL_EXPORTER_OTLP_ENDPOINT` in `.claude/settings.json`) flowing through
`otel-collector-config.yml` into Prometheus — **not** from `HARNESS_PUSHGATEWAY_URL`
(9091), which carries the harness's own hook metrics.

## The metric

`claude_code.token.usage` (OTEL counter, unit `tokens`) → in Prometheus as
`claude_code_token_usage_tokens_total`, label `type` ∈
`input | output | cacheRead | cacheCreation` (camelCase), plus `model` and `session_id`.

```
cache_hit_rate = cacheRead / (input + cacheRead + cacheCreation)
```

The metric name is confirmed by the existing `grafana/dashboards/harness-overview.json`,
which already queries `claude_code_token_usage_tokens_total` with a `{{ model }}` label.

> If queries return no data, run `{__name__=~"claude_code_token_usage.*"}` in Prometheus
> and adjust the metric name in `cache-alerts.rules.yml` and the dashboard — some
> collector configs drop the `_tokens` unit suffix (giving `claude_code_token_usage_total`).

## When an alert fires

A drop in hit rate almost always means the **cached prefix was invalidated**. Usual
suspects, in order of likelihood:

1. **Tool / plugin / MCP churn mid-session** — a plugin or MCP server was enabled or
   disabled, or a tool definition changed, during a run. Settle `enabledPlugins` /
   `.mcp.json` before long `/auto` runs.
2. **`CLAUDE.md` edited mid-session** — cached per-project; editing it busts the prefix
   for every later turn. Apply `session-learnings` suggestions between sessions.
3. **Model swap on the main loop** — `/model`-switching the orchestrator mid-session
   rebuilds the cache. Switch models via subagents instead.
4. **Dynamic value in cached content** — a timestamp/date/random value that leaked into
   the system prompt or `CLAUDE.md` instead of being passed in a message.

Thresholds (70% warning / 40% critical) are starting points — calibrate to your own
steady-state baseline.
