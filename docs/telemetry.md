# Telemetry — Setup and Reference

Telemetry is **on by default in scaffolded projects**. `/scaffold` bakes the OTEL/Pushgateway env vars into the new project's `.claude/settings.json` and `.claude/settings.auto.json`, so Claude Code exports metrics and the `record-run.js` hook pushes harness metrics from the first run. Nothing in the build loop depends on it: the push has a 2s timeout and swallows connection errors, so until you start the stack it simply no-ops. To actually see dashboards you start the stack (below) and restart the session. (The harness's *own* repo stays telemetry-off; only the projects it scaffolds default on.) To turn it **off** for a project, remove the `CLAUDE_CODE_ENABLE_TELEMETRY` / `OTEL_*` / `HARNESS_PUSHGATEWAY_URL` keys from its `settings.json`. (The quick version is in the README's "Telemetry" section.)

## Start the telemetry stack (one per team)

The telemetry stack runs as a shared service. Start it once — every team member points their Claude Code instance to it.

```bash
docker compose -f telemetry_docker_compose.yml up -d
```

This launches four services:

| Service | Port | Purpose |
|---|---|---|
| OTEL Collector | 4317 (gRPC), 4318 (HTTP) | Receives native Claude Code OTLP metrics |
| Prometheus | 9090 | Stores and queries all metrics |
| Pushgateway | 9091 | Receives harness-custom metrics from each developer |
| **Grafana** | **3001** | **Dashboards — open `http://localhost:3001`** |

```
Developer A ──OTLP──▶                              ┌──▶ Prometheus (:9090)
Developer B ──OTLP──▶  OTEL Collector  ──scrape──▶  │
Developer C ──OTLP──▶                              │
                                                    │
Developer A ──push──▶                              │
Developer B ──push──▶  Pushgateway     ──scrape──▶  ┘
Developer C ──push──▶                                    │
                                                         ▼
                                                   Grafana (:3001)
```

**Grafana login:** `http://localhost:3001` — user: `admin`, password: `harness`. Pre-built dashboards load automatically: **Team Productivity**, **Prompt Cache Health**, and **SDLC Pipeline Progress** (`telemetry/grafana/dashboards/pipeline-progress.json`) — wave/feature/coverage/iteration/pending-review progress plus build velocity.

The pipeline dashboard reads the same `harness_*` metrics the build already pushes, plus two gauges (`harness_features_passing`/`harness_features_total` and `harness_coverage`/`harness_coverage_baseline`) emitted from the pipeline snapshot on every push (see `.claude/scripts/telemetry-pipeline-gauges.js`). For the same view without Grafana, run the CLI: `node .claude/scripts/pipeline-status.js status` (or `/status`).

Anonymous read access is enabled — team members can view dashboards without logging in.

## The telemetry env vars in `settings.json`

Claude Code reads env vars from `.claude/settings.json`, not from `.env` files. A fresh scaffold **writes these for you** (into both `settings.json` and `settings.auto.json`) — this section is for confirming them, or re-adding them if you turned telemetry off and want it back.

Open `.claude/settings.json` and confirm the `env` block contains:

```json
"env": {
  "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
  "OTEL_METRICS_EXPORTER": "otlp",
  "OTEL_LOGS_EXPORTER": "otlp",
  "OTEL_EXPORTER_OTLP_PROTOCOL": "grpc",
  "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4317",
  "OTEL_LOG_TOOL_DETAILS": "1",
  "HARNESS_PUSHGATEWAY_URL": "http://localhost:9091",
  "HARNESS_USER": "Your Name Here"
}
```

**Why `settings.json` and not `.env`?** Claude Code only loads environment variables from `settings.json`. A `.env` file is also created for shell scripts and documentation, but **`settings.json` is what actually activates telemetry in Claude Code sessions.**

**Every team member must have their own `HARNESS_USER`** in their `settings.json`. If `HARNESS_USER` is not set, the hook falls back to `git config user.name`, then OS username.

After changing `.claude/settings.json`, restart the active Claude Code session before expecting new hook telemetry. Claude Code may keep the previous hook configuration for an already-running session, so newly added `UserPromptSubmit` / `PostToolUse` telemetry hooks may not fire until the session is restarted.

**What flows where:**

| Metric source | Activated by | Pushed to |
|---|---|---|
| Native OTEL (tokens, cost, LOC, commits, PRs) | `CLAUDE_CODE_ENABLE_TELEMETRY=1` in `settings.json` | OTEL Collector → Prometheus |
| Harness-custom (lanes, agents, turns, reviews) | `record-run.js` hook (pushes only when `HARNESS_PUSHGATEWAY_URL` is set) | Pushgateway → Prometheus |
| JSONL run receipts | `record-run.js` hook (always active) | `.claude/runs/YYYY-MM-DD.jsonl` (local) |
| Commit trailers | `prepare-commit-msg` git hook (always active) | Git commit messages |

For a remote shared telemetry server, change the URLs in `settings.json`:
```json
"OTEL_EXPORTER_OTLP_ENDPOINT": "http://telemetry-server.internal:4317",
"OTEL_EXPORTER_OTLP_PROTOCOL": "grpc",
"HARNESS_PUSHGATEWAY_URL": "http://telemetry-server.internal:9091"
```

---

## Metrics available in Prometheus

Two sources of metrics land in Prometheus. Both are queryable from `http://localhost:9090/query`.

**Source 1 — Native Claude Code metrics** (via OTEL Collector):

| Prometheus metric name | What it covers |
|---|---|
| `claude_code_token_usage_tokens_total` | Tokens by type (input/output/cacheRead/cacheCreation), model, agent, skill |
| `claude_code_cost_usage_USD_total` | USD cost with same breakdowns |
| `claude_code_session_count_total` | Sessions (fresh/resume/continue) |
| `claude_code_lines_of_code_count_total` | LOC added/removed |
| `claude_code_commit_count_total` | Git commits |
| `claude_code_pull_request_count_total` | PRs created |
| `claude_code_code_edit_tool_decision_total` | Tool accept/reject rates |
| `claude_code_active_time_seconds_total` | User vs CLI active time (seconds) |

These appear after you run a Claude Code session with the `.env` loaded.

**Source 2 — Harness-custom metrics** (via Pushgateway):

| Prometheus metric name | Type | Labels | What it captures |
|---|---|---|---|
| `harness_agent_runs_total` | counter | **user**, kind, exit, lane, mode, agent, group, story, iteration, host | Every agent execution with outcome — the core velocity metric |
| `harness_conversation_turns_total` | counter | **user**, kind, lane, mode, group, story, iteration, host | Every conversation turn |
| `harness_iteration_current` | gauge | **user**, group, lane, mode | Current ratchet iteration per group — fewer is more efficient |
| `harness_story_active` | gauge | **user**, group, story, lane | Stories currently being worked on |
| `harness_skill_info` | gauge | skill, directory, path, description | Installed skill inventory pushed by replay and hook telemetry |
| `harness_skill_usage_total` | counter | **user**, skill, source, kind, command, tool, agent, lane, mode, group, story, iteration, host | Skill usage inferred from slash commands, hook payload skill fields, and skill path mentions |

These appear immediately when the harness runs — every subagent call and every turn pushes a metric.

Override Pushgateway URL: `export HARNESS_PUSHGATEWAY_URL=http://your-host:9091`

**Source 3 — Commit trailers** (not in Prometheus — for Jira/GitHub/CI):

Every commit gets: `Harness-Lane:`, `Harness-Mode:`, `Harness-Iteration:`, `Harness-Group:` — use these to filter in external dashboards.

---

## How to use the Prometheus UI

### Step 1: Verify targets are healthy

1. Open `http://localhost:9090/targets` in your browser
2. You should see two targets, both showing **UP**:
   - `otel-collector` (port 8889) — native Claude Code metrics
   - `harness-pushgateway` (port 9091) — harness-custom metrics
3. If either shows **DOWN**, check that `docker compose -f telemetry_docker_compose.yml up -d` is running

### Step 2: Run your first query

1. Open `http://localhost:9090/query`
2. Click the expression input box at the top
3. Type: `harness_agent_runs_total`
4. Click the blue **Execute** button
5. Results appear in the **Table** tab below

### Step 3: Read the result labels

Each result row is a unique time series identified by its labels. Example:

```
harness_agent_runs_total{
  user="Chaminda Wijayasundara",  ← who pushed this metric (from HARNESS_USER / git config)
  agent="generator",              ← which agent ran
  exit="ok",                      ← succeeded or failed ("ok" / "error")
  instance="abc-123",             ← Claude Code session ID
  job="claude_harness",           ← always "claude_harness"
  kind="subagent",                ← event type (subagent / subagent_stop)
  lane="change",                  ← which lane (/change, /vibe, /auto, etc.)
  mode="full"                     ← execution mode (full / lean)
}  →  value: 1
```

Every label combination creates a separate time series. The `user` label lets you filter by team member — essential for shared telemetry servers.

### Step 4: Switch to Graph view

1. After executing a query, click the **Graph** tab (next to Table)
2. Adjust the time range with the `- +` buttons or drag the time picker
3. Each label combination shows as a separate line

### Step 5: Try these queries

Type each one in the expression box and click Execute:

```
harness_agent_runs_total                          ← all agent runs (raw)
harness_conversation_turns_total                                  ← all turns
sum by (agent) (harness_agent_runs_total)          ← runs grouped by agent
sum by (exit) (harness_agent_runs_total)           ← success vs failure count
sum by (lane) (harness_agent_runs_total)           ← work distribution by lane
harness_agent_runs_total{exit="error"}             ← only failures
harness_agent_runs_total{agent="generator"}        ← only generator runs
```

### Step 6: Verify from the terminal

```bash
# Check targets are UP
curl -s http://localhost:9090/api/v1/targets | python3 -c "
import json,sys
for t in json.load(sys.stdin)['data']['activeTargets']:
    print(f\"  {t['labels']['job']:25s} {t['health']}\")"

# Query harness metrics via API
curl -s http://localhost:9090/api/v1/query \
  --data-urlencode 'query=harness_agent_runs_total' | python3 -m json.tool

# Check what's in the Pushgateway directly
curl -s http://localhost:9091/metrics | grep "^harness_"
```

---

## Measuring productivity with harness metrics

The metrics in Prometheus answer concrete questions about how effectively the harness is working. Here's how to read them.

### Understanding the metric labels

A single metric like this:

```
harness_agent_runs_total{user="Alice", agent="generator", exit="ok", lane="improve", mode="full", group="group-01"} 1
```

Tells you: **Alice's** Claude Code instance ran the **generator** agent once, it **succeeded** (`exit="ok"`), was working in the **/change** lane, using **full** execution mode, on dependency **group-01**.

A metric like this:

```
harness_agent_runs_total{user="Bob", agent="design-critic", exit="ok", lane="auto", mode="full", group="group-01"} 1
```

Tells you: **Bob's** instance ran the **design-critic** (GAN scoring loop) on the same group and it passed — meaning the UI quality gate succeeded.

### Key productivity questions and the queries that answer them

**1. "How much work is the harness doing autonomously?"**

```promql
sum(harness_agent_runs_total)                      -- total agent executions (all users)
sum by (user) (harness_agent_runs_total)            -- agent executions per team member
sum(harness_conversation_turns_total)                              -- total conversation turns
sum by (agent) (harness_agent_runs_total)           -- breakdown by agent type
sum by (user, agent) (harness_agent_runs_total)     -- which user is using which agents
```

Track these daily. Rising numbers with stable error rates = the harness is scaling your output.

**2. "What's the success rate? Is the harness struggling?"**

```promql
-- Overall success rate (target: > 90%)
sum(harness_agent_runs_total{exit="ok"}) / sum(harness_agent_runs_total)

-- Success rate per agent
sum by (agent) (harness_agent_runs_total{exit="ok"})
/
sum by (agent) (harness_agent_runs_total)

-- Which agents fail the most?
sum by (agent) (harness_agent_runs_total{exit="error"})
```

If `evaluator` or `security-reviewer` fail often, it means generated code isn't meeting quality gates — the ratchet is doing its job, but the generator may need steering via `.claude/program.md`.

**3. "Which lanes are getting used? Is work landing in the right place?"**

```promql
sum by (lane) (harness_agent_runs_total)
sum by (lane) (harness_conversation_turns_total)
```

Expected healthy distribution:
- `auto` / `improve` — bulk of the work
- `vibe` — small quick edits only
- `brownfield` — should appear before large changes to existing code
- If everything is in `vibe`, work is bypassing quality gates

**4. "Is the harness getting faster over time?"**

Compare across time windows:

```promql
-- Agent runs this week vs last week
sum(harness_agent_runs_total) -- current snapshot
-- Compare by looking at the Graph tab over 2-week range

-- Turns per group (fewer turns per group = more efficient)
sum by (group) (harness_conversation_turns_total)
```

The Karpathy ratchet accumulates `learned-rules.md` over time, so later groups should need fewer self-heal iterations than early groups.

**5. "How much design iteration is happening?"**

```promql
-- Design-critic runs (each run = one GAN scoring iteration)
sum(harness_agent_runs_total{agent="design-critic"})

-- Design-critic vs generator ratio (high = lots of rework)
sum(harness_agent_runs_total{agent="design-critic"})
/
sum(harness_agent_runs_total{agent="generator"})
```

Ratio > 2 means the design-critic is rejecting and re-requesting a lot — consider lowering the design score threshold in `calibration-profile.json`, or the UI requirements are too ambitious for the stack.

**6. "Which dependency groups are the hardest?"**

```promql
-- Errors per group
sum by (group) (harness_agent_runs_total{exit="error"})

-- Total effort per group (agent runs)
sum by (group) (harness_agent_runs_total)

-- Agent mix per group
sum by (group, agent) (harness_agent_runs_total)
```

Groups with high error counts or outsized agent-run counts are complexity hotspots. Consider breaking them into smaller groups or adding more specific learned rules.

**7. "How is each team member using the harness?"**

```promql
-- Runs per team member
sum by (user) (harness_agent_runs_total)

-- Success rate per team member
sum by (user) (harness_agent_runs_total{exit="ok"})
/
sum by (user) (harness_agent_runs_total)

-- Which lanes each person uses
sum by (user, lane) (harness_agent_runs_total)

-- Turns per team member (proxy for active usage)
sum by (user) (harness_conversation_turns_total)

-- Filter to a single user
harness_agent_runs_total{user="Alice"}
```

Use the Grafana dashboard dropdown to filter by user — the pre-built dashboard includes a `user` variable selector at the top.

### Weekly productivity scorecard

Run these queries weekly and track the trend:

| Metric | Query | Healthy target |
|---|---|---|
| Total agent runs | `sum(harness_agent_runs_total)` | Rising week-over-week |
| Overall success rate | `sum(harness_agent_runs_total{exit="ok"}) / sum(harness_agent_runs_total)` | > 90% |
| Generator success rate | `sum(harness_agent_runs_total{agent="generator",exit="ok"}) / sum(harness_agent_runs_total{agent="generator"})` | > 85% |
| Evaluator pass rate | `sum(harness_agent_runs_total{agent="evaluator",exit="ok"}) / sum(harness_agent_runs_total{agent="evaluator"})` | > 80% |
| Design-critic / generator ratio | `sum(harness_agent_runs_total{agent="design-critic"}) / sum(harness_agent_runs_total{agent="generator"})` | < 2.0 |
| Lane distribution | `sum by (lane) (harness_agent_runs_total)` | Bulk in auto/change, minimal in vibe |

### Cost tracking (native OTEL — available once Claude Code sessions run with .env)

```promql
sum(max_over_time(claude_code_cost_usage_USD_total[24h]))                  -- total USD / day
sum by (model) (max_over_time(claude_code_cost_usage_USD_total[24h]))      -- cost by model
sum by (type) (max_over_time(claude_code_token_usage_tokens_total[24h]))   -- tokens by type
sum(increase(claude_code_lines_of_code_count_total[24h]))                  -- LOC / day
increase(claude_code_commit_count_total[24h])                              -- commits / day
increase(claude_code_pull_request_count_total[24h])                        -- PRs / day

-- Cache hit ratio (higher = cheaper)
sum(max_over_time(claude_code_token_usage_tokens_total{type="cacheRead"}[24h]))
/
sum(max_over_time(claude_code_token_usage_tokens_total{type=~"cacheRead|input"}[24h]))
```

### Prometheus API calls for scripting and CI

```bash
# All harness metrics as JSON
curl -s http://localhost:9090/api/v1/query \
  --data-urlencode 'query=harness_agent_runs_total' | python3 -m json.tool

# Success rate as a single number
curl -s http://localhost:9090/api/v1/query \
  --data-urlencode 'query=sum(harness_agent_runs_total{exit="ok"}) / sum(harness_agent_runs_total)' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['result'][0]['value'][1])"

# Runs by agent as a table
curl -s http://localhost:9090/api/v1/query \
  --data-urlencode 'query=sum by (agent) (harness_agent_runs_total)' \
  | python3 -c "
import json,sys
for r in json.load(sys.stdin)['data']['result']:
    print(f\"  {r['metric'].get('agent','(none)'):20s} {r['value'][1]}\")"
```

> **Note:** Metric names in Prometheus replace dots with underscores and append `_total` for counters. If a query returns empty, run `{__name__=~"harness_.*"}` to discover the exact metric names in your instance.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `docker compose -f telemetry_docker_compose.yml up` fails | Ensure Docker is running. Check image pulls with `docker pull prom/prometheus:v3.2.1` |
| No metrics in Prometheus | Verify OTEL env vars are set. Check `http://localhost:9090/targets` — both jobs should show UP |
| Pushgateway metrics missing | `record-run.js` pushes fire-and-forget. Verify Pushgateway is reachable: `curl http://localhost:9091/metrics` |
| Stories/files are being written but dashboard metrics are not moving | Restart the active Claude Code session after updating `.claude/settings.json`; hook configuration may not reload mid-session |
| Grafana shows no data | Open `http://localhost:3001`, go to a dashboard panel, click Edit, verify the datasource is "Prometheus" and the query returns data |
| Metrics have no `user` label | Set `HARNESS_USER` in `.env` or verify `git config user.name` returns your name |

See also `telemetry/CACHE_MONITORING.md` for the prompt-cache hit-rate alert and dashboard.
