# Claude Harness Engine v4 — Getting Started

A Claude Code plugin for autonomous, long-running application development. GAN-inspired generator-evaluator architecture with Karpathy ratcheting — quality only moves forward.

Current version: `1.1.5`

---

## Step 1: Clone the harness

```bash
git clone https://github.com/cwijayasundara/claude_harness_eng_v4.git ~/claude_harness_eng_v4
```

## Step 2: Load as a Claude Code plugin

From your target project directory:

```bash
cd ~/my-project
claude --plugin-dir ~/claude_harness_eng_v4/.claude
```

## Step 3: Scaffold your project

Inside Claude Code:

```
/scaffold
```

This asks a few questions about your stack and project type, then generates:
- `.claude/` directory (7 agents, 28 skills, 15 hooks, 10 templates)
- `project-manifest.json` + `calibration-profile.json`
- `CLAUDE.md`, `design.md`, `init.sh`, `features.json`
- `telemetry_docker_compose.yml` + `telemetry/` config
- Git initialized with harness commit hooks

## Step 4: Start the telemetry stack (one per team)

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

**Grafana login:** `http://localhost:3001` — user: `admin`, password: `harness`. A pre-built "Claude Harness — Team Productivity" dashboard is loaded automatically.

Anonymous read access is enabled — team members can view dashboards without logging in.

## Step 5: Verify telemetry env vars are in `settings.json`

**This is the critical step.** Claude Code reads env vars from `.claude/settings.json`, not from `.env` files. `/scaffold` adds them automatically, but verify they're present:

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
| Harness-custom (lanes, agents, turns, reviews) | `record-run.js` hook (always active) | Pushgateway → Prometheus |
| JSONL run receipts | `record-run.js` hook (always active) | `.claude/runs/YYYY-MM-DD.jsonl` (local) |
| Commit trailers | `prepare-commit-msg` git hook (always active) | Git commit messages |

For a remote shared telemetry server, change the URLs in `settings.json`:
```json
"OTEL_EXPORTER_OTLP_ENDPOINT": "http://telemetry-server.internal:4317",
"OTEL_EXPORTER_OTLP_PROTOCOL": "grpc",
"HARNESS_PUSHGATEWAY_URL": "http://telemetry-server.internal:9091"
```

## Step 6: Choose your lane and build

Pick the lane that matches your situation:

| Situation | Command | What happens |
|---|---|---|
| **New project, large scope** | `/brd` then `/spec` then `/design` then `/auto` | Full SDLC pipeline with human gates |
| **New project, small scope** (CLI, library, single-script) | `/lite` | Compressed lane: mini-BRD, 3-5 stories, single group |
| **Existing codebase, broad changes** | `/brownfield` then `/code-map` then `/seam-finder` | Map the codebase before touching it |
| **Tiny safe edit** (< 3 files, < 150 lines) | `/vibe` | Micro-contract, narrow diff, targeted verify |
| **Fix a GitHub issue** | `/fix-issue` | Branch, reproduce, fix, test, PR |
| **Improve existing feature** | `/improve` | Story-driven enhancement with verification |
| **Refactor for quality** | `/refactor` | Quality-driven refactoring with ratchet gate |

### Optional: richer AST graphs with Understand-Anything

For brownfield refactors, the scaffold can consume an [Understand-Anything](https://github.com/Lum1104/Understand-Anything/tree/main) knowledge graph when that Claude Code plugin is installed in the target repo. This is useful when you need AST-backed call, symbol, inheritance, and dependency evidence before changing an existing system.

1. Install the plugin in Claude Code:
   ```text
   /plugin marketplace add Lum1104/Understand-Anything
   /plugin install understand-anything
   ```
2. Run the plugin’s analysis workflow in the target repo:
   ```text
   /understand
   ```
   This writes:
   ```text
   .understand-anything/knowledge-graph.json
   ```
3. Run `/code-map` or import the graph directly:
   ```bash
   node .claude/skills/code-map/scripts/import_understand_graph.js \
     --in .understand-anything/knowledge-graph.json \
     --out specs/brownfield/code-graph.json
   node .claude/skills/code-map/scripts/build_graph.js \
     --render-mermaid specs/brownfield/code-graph.json \
     --out specs/brownfield/dependency-graph.md
   node .claude/skills/code-map/scripts/build_graph.js \
     --coupling-report specs/brownfield/code-graph.json \
     --out specs/brownfield/coupling-report.md
   ```
4. Run `/brownfield`, then `/seam-finder "<change goal>"` before `/improve` or `/refactor`.
5. For visual exploration, run `/understand-dashboard` from the plugin. For keeping graphs fresh, use `/understand --auto-update` or re-run `/understand` before large releases.

Understand-Anything is optional. If its graph is absent, `/code-map` falls back to the vendored deterministic extractor, then `/brownfield` still writes the same `specs/brownfield/` artifacts.

## Step 7: Let `/auto` run the ratchet loop

Once planning is done, `/auto` loops autonomously per dependency group:

1. Recovers state from prior sessions
2. Negotiates a sprint contract (generator + evaluator)
3. Spawns an agent team (up to 5 parallel teammates)
4. Runs 6 ratchet gates: tests → lint/types → coverage → architecture → evaluator → design-critic
5. Self-heals failed gates (max 3 attempts, different strategy each time)
6. Commits, updates state, moves to next group

Execution modes: **Full** (all gates), **Lean** (skip design-critic), **Solo** (single agent), **Turbo** (parallel groups).

## Step 8: Review and merge

- Proof lands in `specs/reviews/`, `iteration-log.md`, `features.json`, plus the commits
- Review diffs in git as usual — the harness never merges on its own

---

## Optional: Tracker-driven agent factory (Linear/Jira)

For teams that want a visible queue, parallel execution, and tracker-based review:

1. During `/scaffold`, choose tracker mode B/C/D
2. After planning, run `/tracker-publish` — creates one Linear/Jira issue per dependency group
3. Start the orchestrator:
   ```bash
   cd ~/claude_harness_eng_v4/symphony_clone
   cp .env.example .env && $EDITOR .env
   docker compose up --build
   ```
4. The orchestrator polls the tracker, claims ready groups, runs Claude Code in isolated workspaces, opens PRs, and posts proof back to the tracker
5. Humans review PRs and mark issues Done — the orchestrator never does

---

## Optional: Framework skill packs

During `/scaffold`, opt into framework-specific skill packs:

| Pack | Skills | Use when |
|---|---|---|
| LangChain / LangGraph / DeepAgents | 9 | Building LangChain agents, LangGraph workflows, or DeepAgents apps |
| Google ADK | 7 | Building Google Agent Development Kit agents |

These inject framework-aware code generation on top of the harness discipline. Same `/auto` ratchet still runs.

`/scaffold` records selected packs in `project-manifest.json` but does not run `npx skills add` from inside Claude Code. The auto-mode classifier blocks external installs, so run the selected pack command in a normal terminal:

```bash
npx --yes skills add cwijayasundara/agent_cli_langchain -a claude-code -s '*' -y   # LangChain
npx --yes skills add google/agents-cli -a claude-code -s '*' -y                     # Google ADK
```

Then verify: `/install-framework-packs`

---

## Command reference

| Command | Purpose |
|---|---|
| `/scaffold` | Bootstrap a project (only true slash command) |
| `/brd` | Socratic interview → Business Requirements Document |
| `/spec` | BRD → stories + dependency graph + features.json |
| `/design` | Architecture + schemas + UI mockups |
| `/build` | Full 8-phase pipeline |
| `/auto` | Autonomous ratcheting loop |
| `/lite` | Compressed lane for small new projects |
| `/vibe` | Controlled small-change lane |
| `/brownfield` | Map an existing codebase before changing it |
| `/code-map` | Build deterministic dependency graph |
| `/seam-finder` | Rank safe cut-points for a goal |
| `/implement` | Code generation with agent teams |
| `/evaluate` | Run app, verify sprint contract |
| `/review` | Evaluator + security review |
| `/test` | Test plan + Playwright E2E |
| `/deploy` | Docker Compose + init.sh |
| `/fix-issue` | GitHub issue → branch → fix → test → PR |
| `/refactor` | Quality-driven refactoring with ratchet gate |
| `/improve` | Feature enhancement with verification |
| `/lint-drift` | Entropy scanner for pattern drift |
| `/tracker-publish` | Publish dependency groups to Linear/Jira |
| `/install-framework-packs` | Verify configured framework packs and print manual install commands for missing packs |

---

## Agent team

| Agent | Role | Model |
|---|---|---|
| Planner | Sprint planning, story breakdown | Opus |
| Generator | Feature implementation, spawns teammates | Sonnet |
| Evaluator | Runs app, API + Playwright verification | Opus |
| Design Critic | GAN scoring loop (max 10 iterations) | Opus |
| UI Designer | React + Tailwind mockups | Sonnet |
| Test Engineer | Test plans + Playwright E2E | Sonnet |
| Security Reviewer | OWASP vulnerability audit | Sonnet |

---

## Coding principles enforced by hooks

1. **TDD mandatory** — failing tests first, then implement
2. **100% meaningful coverage**, 80% hard floor
3. **Functions < 50 lines, files < 300 lines**
4. **Static typing everywhere** — no `any`
5. **Strict layered architecture** — one-way dependencies (Types → Config → Repository → Service → API → UI)
6. **No silent fallbacks** — typed errors, callers decide
7. **Surgical changes** — only what the request requires
8. **Brownfield discipline** — dependency claims must cite `code-graph.json` evidence

15 hooks enforce these in real time. 6 ratchet gates enforce at commit time.

---

## Key files in your scaffolded project

| File | Purpose |
|---|---|
| `telemetry_docker_compose.yml` | Telemetry stack: OTEL Collector + Prometheus + Pushgateway |
| `telemetry/` | OTEL Collector + Prometheus configuration |
| `.claude/program.md` | Human-agent bridge — edit mid-run to steer `/auto` |
| `.claude/architecture.md` | Layered architecture rules |
| `.claude/settings.json` | Hook config, permissions, enabled plugins |
| `.claude/state/learned-rules.md` | Accumulated rules from past failures (never deleted) |
| `project-manifest.json` | Stack, evaluation config, execution mode, framework packs |
| `calibration-profile.json` | Design scoring weights/thresholds |
| `features.json` | Granular pass/fail registry |
| `claude-progress.txt` | Session chaining recovery context |
| `specs/stories/dependency-graph.md` | Group ordering — source of truth for `/auto` |
| `specs/design/component-map.md` | File ownership per story |
| `design.md` | Full architecture reference |

---

## Telemetry reference

### Metrics available in Prometheus

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
| `harness_pending_reviews` | gauge | **user**, lane, mode, group, story, iteration, host | Pending review count at turn end |
| `harness_iteration_current` | gauge | **user**, group, lane, mode | Current ratchet iteration per group — fewer is more efficient |
| `harness_story_active` | gauge | **user**, group, story, lane | Stories currently being worked on |
| `harness_skill_info` | gauge | skill, directory, path, description | Installed skill inventory pushed by replay and hook telemetry |
| `harness_skill_usage_total` | counter | **user**, skill, source, kind, command, tool, agent, lane, mode, group, story, iteration, host | Skill usage inferred from slash commands, hook payload skill fields, and skill path mentions |

These appear immediately when the harness runs — every subagent call and every turn pushes a metric.

Override Pushgateway URL: `export HARNESS_PUSHGATEWAY_URL=http://your-host:9091`

**Source 3 — Commit trailers** (not in Prometheus — for Jira/GitHub/CI):

Every commit gets: `Harness-Lane:`, `Harness-Mode:`, `Harness-Iteration:`, `Harness-Group:` — use these to filter in external dashboards.

---

### How to use the Prometheus UI

#### Step 1: Verify targets are healthy

1. Open `http://localhost:9090/targets` in your browser
2. You should see two targets, both showing **UP**:
   - `otel-collector` (port 8889) — native Claude Code metrics
   - `harness-pushgateway` (port 9091) — harness-custom metrics
3. If either shows **DOWN**, check that `docker compose -f telemetry_docker_compose.yml up -d` is running

#### Step 2: Run your first query

1. Open `http://localhost:9090/query`
2. Click the expression input box at the top
3. Type: `harness_agent_runs_total`
4. Click the blue **Execute** button
5. Results appear in the **Table** tab below

#### Step 3: Read the result labels

Each result row is a unique time series identified by its labels. Example:

```
harness_agent_runs_total{
  user="Chaminda Wijayasundara",  ← who pushed this metric (from HARNESS_USER / git config)
  agent="generator",              ← which agent ran
  exit="ok",                      ← succeeded or failed ("ok" / "error")
  instance="abc-123",             ← Claude Code session ID
  job="claude_harness",           ← always "claude_harness"
  kind="subagent",                ← event type (subagent / subagent_stop)
  lane="improve",                 ← which lane (/improve, /vibe, /auto, etc.)
  mode="full"                     ← execution mode (full / lean / solo / turbo)
}  →  value: 1
```

Every label combination creates a separate time series. The `user` label lets you filter by team member — essential for shared telemetry servers.

#### Step 4: Switch to Graph view

1. After executing a query, click the **Graph** tab (next to Table)
2. Adjust the time range with the `- +` buttons or drag the time picker
3. Each label combination shows as a separate line

#### Step 5: Try these queries

Type each one in the expression box and click Execute:

```
harness_agent_runs_total                          ← all agent runs (raw)
harness_conversation_turns_total                                  ← all turns
harness_pending_reviews                              ← current pending review count
sum by (agent) (harness_agent_runs_total)          ← runs grouped by agent
sum by (exit) (harness_agent_runs_total)           ← success vs failure count
sum by (lane) (harness_agent_runs_total)           ← work distribution by lane
harness_agent_runs_total{exit="error"}             ← only failures
harness_agent_runs_total{agent="generator"}        ← only generator runs
```

#### Step 6: Verify from the terminal

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

### Measuring productivity with harness metrics

The metrics in Prometheus answer concrete questions about how effectively the harness is working. Here's how to read them.

#### Understanding the metric labels

A single metric like this:

```
harness_agent_runs_total{user="Alice", agent="generator", exit="ok", lane="improve", mode="full", group="group-01"} 1
```

Tells you: **Alice's** Claude Code instance ran the **generator** agent once, it **succeeded** (`exit="ok"`), was working in the **/improve** lane, using **full** execution mode, on dependency **group-01**.

A metric like this:

```
harness_agent_runs_total{user="Bob", agent="design-critic", exit="ok", lane="auto", mode="full", group="group-01"} 1
```

Tells you: **Bob's** instance ran the **design-critic** (GAN scoring loop) on the same group and it passed — meaning the UI quality gate succeeded.

#### Key productivity questions and the queries that answer them

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

**7. "Are reviews piling up?"**

```promql
harness_pending_reviews
```

Rising pending reviews means the harness is producing faster than humans can review. Either add reviewers or switch to Lean/Solo mode to slow output.

**8. "How is each team member using the harness?"**

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

#### Weekly productivity scorecard

Run these queries weekly and track the trend:

| Metric | Query | Healthy target |
|---|---|---|
| Total agent runs | `sum(harness_agent_runs_total)` | Rising week-over-week |
| Overall success rate | `sum(harness_agent_runs_total{exit="ok"}) / sum(harness_agent_runs_total)` | > 90% |
| Generator success rate | `sum(harness_agent_runs_total{agent="generator",exit="ok"}) / sum(harness_agent_runs_total{agent="generator"})` | > 85% |
| Evaluator pass rate | `sum(harness_agent_runs_total{agent="evaluator",exit="ok"}) / sum(harness_agent_runs_total{agent="evaluator"})` | > 80% |
| Design-critic / generator ratio | `sum(harness_agent_runs_total{agent="design-critic"}) / sum(harness_agent_runs_total{agent="generator"})` | < 2.0 |
| Pending reviews | `harness_pending_reviews` | < 5 |
| Lane distribution | `sum by (lane) (harness_agent_runs_total)` | Bulk in auto/improve, minimal in vibe |

#### Cost tracking (native OTEL — available once Claude Code sessions run with .env)

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

#### Prometheus API calls for scripting and CI

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

## End-to-End Testing

The harness includes a full E2E test suite that builds a real project through the entire pipeline, validates artifacts with LLM-based assertions, and checks telemetry.

### Quick run

```bash
./test/e2e/run.sh
```

This auto-starts the telemetry stack (Docker Compose) if not running, then executes all 8 stages.

### What it tests

| Stage | What | Model | Budget |
|---|---|---|---|
| 1 - Scaffold | Project structure created | Haiku | $0.50 |
| 2 - BRD | Business requirements document generated | Haiku | $1.00 |
| 2b - BRD LLM | LLM validates BRD quality (advisory) | Haiku | $0.15 |
| 3 - Spec | Stories + features.json decomposed from BRD | Haiku | $1.00 |
| 3b - Spec LLM | LLM validates spec quality (advisory) | Haiku | $0.15 |
| 4 - Design | Architecture artifacts generated | Haiku | $1.50 |
| 5 - Auto/Solo | Working code built (todo CLI app) | Sonnet | $5.00 |
| 6 - Brownfield | Codebase discovery maps generated | Haiku | $1.00 |
| 7 - Telemetry | Prometheus metrics exist | — | — |
| 8 - Grafana | Dashboard loads, Phase Quality panels visible | — | — |

**Total runtime:** ~15-20 minutes. **Total cost:** ~$5-10 per run.

### Keep artifacts for debugging

```bash
E2E_KEEP_ARTIFACTS=1 ./test/e2e/run.sh
```

Artifacts are saved in a temp directory printed at the start of the run.

### Run without telemetry stack

Stages 7-8 gracefully skip if Prometheus/Grafana aren't running:

```bash
node --test test/e2e/harness-pipeline.test.js --timeout 1200000
```

### Unit tests (fast, no API calls)

```bash
node --test test/phase-eval-unit.test.js        # 36 tests — rubrics, schema, hooks, skills
node --test test/phase-eval-integration.test.js  # 8 tests — telemetry snapshot, Grafana, deck
node --test test/scaffold-command.test.js        # 9 tests — scaffold config validation
```

### Test file structure

```
test/
  e2e/
    harness-pipeline.test.js       # Main orchestrator (8 stages)
    run.sh                         # One-command runner with auto-start
    helpers/
      claude-runner.js             # Spawn claude -p with model/budget
      llm-validator.js             # LLM artifact quality checks (Haiku)
      prometheus-checker.js        # Prometheus HTTP API queries
      grafana-checker.js           # Grafana REST API dashboard checks
    fixtures/
      todo-cli-brd-prompt.md       # Canned BRD input (deterministic)
      validation-criteria.json     # Per-stage LLM validation rules
    results/                       # Screenshots, logs (gitignored)
  phase-eval-unit.test.js          # Unit tests for phase ratchet evaluators
  phase-eval-integration.test.js   # Integration tests (telemetry, Grafana, deck)
  scaffold-command.test.js         # Scaffold configuration tests
```

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
| Framework pack is `PENDING MANUAL INSTALL` | Run manually in a regular terminal (not Claude Code): `npx --yes skills add <repo> -a claude-code -s '*' -y`, then verify with `/install-framework-packs --list` |
| Scaffold says "plugin source stale" | Update the harness: `cd ~/claude_harness_eng_v4 && git pull` |
| `/auto` runs but quality regresses | Check `.claude/program.md` — edit to steer. Check `learned-rules.md` for accumulated rules |

---

## Further reading

| Document | Where |
|---|---|
| Architecture reference | `design.md` in your project |
| Orchestrator operator guide | `symphony_clone/README.md` in the harness repo |
| Any skill's full instructions | `.claude/skills/<name>/SKILL.md` |
| Any agent's definition | `.claude/agents/<name>.md` |
| Stakeholder slide deck | `Claude_Harness_Engine_Design.pptx` in the harness repo |
| Metrics slide deck | `matrices.pptx` in the harness repo |
