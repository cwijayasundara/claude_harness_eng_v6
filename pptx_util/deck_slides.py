"""Slide definitions for the Telemetry & Team Velocity deck (11 slides)."""

from .deck_primitives import (
    ACC,
    BODY_FG,
    MUTED_FG,
    OK_BG,
    OK_FG,
    ERR_BG,
    chrome,
    six,
    tbl,
    call,
    txt,
    card,
    fbox,
    arr,
    darr,
)

TS = 11


def s1(p):
    s = p.slides.add_slide(p.slide_layouts[6])
    chrome(
        s,
        1,
        TS,
        "Unified Telemetry Architecture",
        "Two data planes · Per-user attribution · Zero manual config",
    )
    six(
        s,
        [
            (
                "Native OTEL (automatic)",
                "8 metrics + 24 events via OTLP.\nTokens, cost, sessions, commits,\nPRs, LOC, tool decisions, active time.\nBeta: distributed spans/traces.",
            ),
            (
                "Harness-Custom (9 metrics)",
                "record-run.js -> 9 Prometheus metrics:\nagent_runs, turns, commands, tool_events,\nskill_usage, skill_info, pending_reviews,\niteration_current, story_active.",
            ),
            (
                "Commit Trailers (git)",
                "Every commit auto-tagged:\nHarness-Lane, Mode, Iteration, Group.\nJoin key for Jira / GitHub / CI.",
            ),
            (
                "Per-User Attribution",
                "HARNESS_USER from git config user.name\nvia settings.json. Every metric carries\na user label. Grafana filters by member.",
            ),
            (
                "Shared Team Server",
                "Docker Compose: Collector (:4317),\nPrometheus (:9090), Pushgateway (:9091),\nGrafana (:3001). All devs push to same.",
            ),
            (
                "Pre-Built Dashboard",
                "25 Grafana panels across 9 sections.\n3 dropdown filters (user, lane, group).\nSkill tracking + native OTEL panels.",
            ),
        ],
    )


def s2(p):
    s = p.slides.add_slide(p.slide_layouts[6])
    chrome(
        s,
        2,
        TS,
        "Data Flow: Developer to Dashboard",
        "Every Claude Code session pushes to the same telemetry stack — no manual steps after /scaffold",
    )
    d = 1.30
    fbox(s, 0.45, d, 1.50, 0.50, "Developer A\nClaude Code", ACC[0])
    fbox(s, 0.45, d + 0.60, 1.50, 0.50, "Developer B\nClaude Code", ACC[1])
    fbox(s, 0.45, d + 1.20, 1.50, 0.50, "Developer C\nClaude Code", ACC[2])
    arr(s, 2.10, d + 0.68, 0.50, 0.35, MUTED_FG)
    card(s, 2.75, d - 0.10, 1.80, 1.90)
    txt(s, "OTLP (native)", 2.85, d, 1.60, 0.25, sz=9, b=True, c=ACC[0])
    txt(
        s,
        "8 metrics + 24 events\ntokens · cost · sessions\ncommits · PRs · LOC\ntool accept/reject\nactive time · spans (beta)",
        2.85,
        d + 0.28,
        1.60,
        1.20,
        sz=8,
        c=BODY_FG,
    )
    arr(s, 4.70, d + 0.68, 0.40, 0.35, MUTED_FG)
    card(s, 5.25, d - 0.10, 1.70, 0.80)
    txt(s, "OTEL Collector", 5.35, d, 1.50, 0.25, sz=10, b=True, c=ACC[0])
    txt(
        s,
        ":4317 gRPC\n:4318 HTTP\n:8889 Prom export",
        5.35,
        d + 0.28,
        1.50,
        0.50,
        sz=8,
        c=BODY_FG,
    )
    card(s, 5.25, d + 0.90, 1.70, 0.80)
    txt(s, "Pushgateway", 5.35, d + 1.00, 1.50, 0.25, sz=10, b=True, c=ACC[1])
    txt(
        s,
        ":9091\nrecord-run.js\n9 metrics + user label",
        5.35,
        d + 1.28,
        1.50,
        0.50,
        sz=8,
        c=BODY_FG,
    )
    arr(s, 7.10, d + 0.68, 0.40, 0.35, MUTED_FG)
    card(s, 7.65, d + 0.10, 1.80, 0.60, f=OK_BG)
    txt(s, "Prometheus :9090", 7.75, d + 0.15, 1.60, 0.25, sz=11, b=True, c=OK_FG)
    txt(
        s,
        "Unified query endpoint\nScrapes both sources",
        7.75,
        d + 0.40,
        1.60,
        0.30,
        sz=8,
        c=BODY_FG,
    )
    darr(s, 8.35, d + 0.80, 0.35, 0.30, OK_FG)
    card(s, 7.65, d + 1.20, 1.80, 0.55, f=ERR_BG)
    txt(s, "Grafana :3001", 7.75, d + 1.25, 1.60, 0.25, sz=11, b=True, c=ACC[1])
    txt(
        s,
        "25 panels · 9 sections\nTeam dashboard",
        7.75,
        d + 1.48,
        1.60,
        0.25,
        sz=8,
        c=BODY_FG,
    )
    call(
        s,
        0.45,
        3.95,
        9.10,
        0.50,
        "settings.json env activates OTEL. record-run.js pushes on every hook. HARNESS_USER from git config. Zero manual steps.",
    )
    txt(
        s,
        "JSONL backup: .claude/runs/*.jsonl · Trailers: Harness-Lane / Mode / Iteration / Group · Git hook: prepare-commit-msg",
        0.45,
        4.60,
        9.10,
        0.40,
        sz=9,
        c=MUTED_FG,
    )


def s3(p):
    s = p.slides.add_slide(p.slide_layouts[6])
    chrome(
        s,
        3,
        TS,
        "Internal Pipeline Architecture",
        "How telemetry flows from hook events and OTEL runtime to Prometheus and Grafana",
    )
    txt(s, "HARNESS-CUSTOM PATH", 0.45, 1.18, 3.00, 0.20, sz=10, b=True, c=ACC[1])
    card(s, 0.45, 1.42, 2.00, 1.05)
    txt(s, "Hook Events", 0.55, 1.47, 1.80, 0.25, sz=11, b=True, c=ACC[0])
    txt(
        s,
        "UserPromptSubmit\nPostToolUse (Edit|Write\n  |Bash|Task)\nStop\nSubagentStop",
        0.55,
        1.72,
        1.80,
        0.70,
        sz=8,
        c=BODY_FG,
    )
    arr(s, 2.58, 1.85, 0.35, 0.25, MUTED_FG)
    card(s, 3.05, 1.42, 2.00, 1.05)
    txt(s, "record-run.js", 3.15, 1.47, 1.80, 0.25, sz=11, b=True, c=ACC[1])
    txt(
        s,
        "Reads state markers:\n  lane, mode, iteration,\n  group, story\nInfers skills from catalog\nAppends JSONL receipt",
        3.15,
        1.72,
        1.80,
        0.70,
        sz=8,
        c=BODY_FG,
    )
    arr(s, 5.18, 1.85, 0.35, 0.25, MUTED_FG)
    card(s, 5.65, 1.42, 2.15, 1.05)
    txt(s, "telemetry-memory.js", 5.75, 1.47, 1.95, 0.25, sz=11, b=True, c=ACC[2])
    txt(
        s,
        "appendLedger()\nseedLedgerFromRuns()\nbuildSnapshot():\n  ledger -> Prometheus\n  text format (0.0.4)",
        5.75,
        1.72,
        1.95,
        0.70,
        sz=8,
        c=BODY_FG,
    )
    arr(s, 7.93, 1.85, 0.35, 0.25, MUTED_FG)
    card(s, 8.40, 1.42, 1.15, 1.05, f=OK_BG)
    txt(s, "Pushgateway", 8.48, 1.47, 1.00, 0.25, sz=9, b=True, c=OK_FG)
    txt(
        s,
        ":9091\nHTTP POST\njob=claude\n_harness\n_memory",
        8.48,
        1.72,
        1.00,
        0.70,
        sz=7,
        c=BODY_FG,
    )
    card(s, 3.05, 2.60, 2.00, 0.38)
    txt(s, ".claude/runs/*.jsonl", 3.15, 2.62, 1.80, 0.18, sz=8, b=True, c=MUTED_FG)
    txt(s, "Local backup + ledger", 3.15, 2.80, 1.80, 0.16, sz=7, c=MUTED_FG)
    darr(s, 3.95, 2.50, 0.25, 0.12, MUTED_FG)
    txt(s, "NATIVE OTEL PATH", 0.45, 3.15, 3.00, 0.20, sz=10, b=True, c=ACC[3])
    card(s, 0.45, 3.38, 2.00, 0.85)
    txt(s, "Claude Code Runtime", 0.55, 3.43, 1.80, 0.25, sz=11, b=True, c=ACC[3])
    txt(
        s,
        "ENABLE_TELEMETRY=1\nOTEL_METRICS_EXPORTER\n  =otlp\nOTLP_ENDPOINT=:4317",
        0.55,
        3.68,
        1.80,
        0.55,
        sz=7,
        c=BODY_FG,
    )
    arr(s, 2.58, 3.72, 0.35, 0.25, MUTED_FG)
    card(s, 3.05, 3.38, 2.00, 0.85)
    txt(s, "OTLP gRPC / HTTP", 3.15, 3.43, 1.80, 0.25, sz=11, b=True, c=ACC[4])
    txt(
        s,
        "8 counters (metrics)\n24 log events\nSpans (beta, enhanced\ntelemetry flag)",
        3.15,
        3.68,
        1.80,
        0.55,
        sz=8,
        c=BODY_FG,
    )
    arr(s, 5.18, 3.72, 0.35, 0.25, MUTED_FG)
    card(s, 5.65, 3.38, 2.15, 0.85, f=OK_BG)
    txt(s, "OTEL Collector", 5.75, 3.43, 1.95, 0.25, sz=11, b=True, c=OK_FG)
    txt(
        s,
        "Receives: :4317 gRPC\n           :4318 HTTP\nExports:  :8889 Prom\nresource_to_telemetry",
        5.75,
        3.68,
        1.95,
        0.55,
        sz=7,
        c=BODY_FG,
    )
    arr(s, 7.93, 3.72, 0.35, 0.25, MUTED_FG)
    card(s, 8.40, 3.38, 1.15, 0.85, f=OK_BG)
    txt(s, "Prometheus", 8.48, 3.43, 1.00, 0.22, sz=9, b=True, c=OK_FG)
    txt(
        s,
        ":9090\nScrapes\n:8889 +\n:9091\n15s interval",
        8.48,
        3.65,
        1.00,
        0.55,
        sz=7,
        c=BODY_FG,
    )
    darr(s, 8.85, 2.52, 0.25, 0.82, OK_FG)
    card(s, 5.65, 4.40, 3.90, 0.55, f=ERR_BG)
    txt(s, "Grafana :3001", 5.75, 4.42, 1.60, 0.22, sz=11, b=True, c=ACC[1])
    txt(
        s,
        "PromQL queries · 25 panels · 9 sections · 3 filters",
        7.40,
        4.47,
        2.10,
        0.45,
        sz=8,
        c=BODY_FG,
    )
    arr(s, 8.85, 4.28, 0.25, 0.15, ACC[1])
    txt(
        s,
        "Docker Compose: 4 services · prometheus_data + grafana_data volumes · 90-day TSDB retention · anonymous viewer enabled",
        0.45,
        5.05,
        9.10,
        0.20,
        sz=8,
        c=MUTED_FG,
    )


def s4(p):
    s = p.slides.add_slide(p.slide_layouts[6])
    chrome(
        s,
        4,
        TS,
        "9 Custom Prometheus Metrics",
        "Pushed by record-run.js via telemetry-memory.js on every hook event · Per-user attribution",
    )
    tbl(
        s,
        [
            ["Metric", "Type", "Key Labels", "What It Tells You"],
            [
                "harness_agent_runs_total",
                "counter",
                "user, agent, exit, kind,\nlane, mode, group, story, iter",
                "Agent velocity. Every subagent\nexecution with pass/fail.",
            ],
            [
                "harness_conversation_turns_total",
                "counter",
                "user, kind (prompt | turn\n| subagent_stop), lane, mode",
                "Conversation turns. Proxy\nfor active engagement.",
            ],
            [
                "harness_command_invocations_total",
                "counter",
                "user, command, lane,\nmode, group, story, iter",
                "Slash command usage. Which\nskills and lanes used most.",
            ],
            [
                "harness_tool_events_total",
                "counter",
                "user, tool, exit, lane,\nmode, group, story, iter",
                "Tool-level activity. Edit,\nWrite, Bash, Task volume.",
            ],
            [
                "harness_skill_usage_total",
                "counter",
                "skill, directory, source,\nkind, command, user, lane",
                "Skill activations. Command\nvs hook-inferred usage.",
            ],
            [
                "harness_skill_info",
                "gauge",
                "skill, directory,\npath, description",
                "Skill inventory metadata.\nInfo metric for PromQL joins.",
            ],
            [
                "harness_pending_reviews",
                "gauge",
                "user, lane, mode,\ngroup, story",
                "Reviews waiting. Green < 3,\nyellow < 5, red >= 5.",
            ],
            [
                "harness_iteration_current",
                "gauge",
                "user, group,\nlane, mode",
                "Current ratchet iteration.\nFewer = more efficient.",
            ],
            [
                "harness_story_active",
                "gauge",
                "user, group,\nstory, lane",
                "Stories in progress.\nTeam WIP at a glance.",
            ],
        ],
        0.45,
        1.15,
        9.10,
        3.80,
        [2.8, 0.7, 2.3, 3.2],
    )
    txt(
        s,
        "Also: instance (project dir), job (claude_harness_memory), host. Override: HARNESS_PUSHGATEWAY_URL.",
        0.45,
        5.05,
        9.10,
        0.20,
        sz=8,
        c=MUTED_FG,
    )


def s5(p):
    s = p.slides.add_slide(p.slide_layouts[6])
    chrome(
        s,
        5,
        TS,
        "8 Native OTEL Metrics (Zero Custom Code)",
        "Activated by CLAUDE_CODE_ENABLE_TELEMETRY=1 · Exported via OTLP to Collector · All counters",
    )
    tbl(
        s,
        [
            ["Prometheus Name", "Covers", "Key Labels"],
            [
                "claude_code_token_usage_tokens_total",
                "Tokens by type, model, agent, skill",
                "type (input/output/cacheRead/\ncacheCreation), model, query_source,\nspeed, effort, agent.name, skill.name",
            ],
            [
                "claude_code_cost_usage_USD_total",
                "USD cost with same breakdowns",
                "model, query_source (main/subagent/\nauxiliary), speed, effort, agent.name,\nskill.name, plugin.name",
            ],
            [
                "claude_code_session_count_total",
                "Sessions (fresh/resume/continue)",
                "session.id, start_type",
            ],
            [
                "claude_code_lines_of_code_count_total",
                "LOC added / removed",
                "type (added/removed)",
            ],
            [
                "claude_code_commit_count_total",
                "Git commits created",
                "standard attributes",
            ],
            [
                "claude_code_pull_request_count_total",
                "PRs created",
                "standard attributes",
            ],
            [
                "claude_code_code_edit_tool_decision_total",
                "Tool accept / reject rates",
                "tool_name, decision (accept/reject),\nsource, language",
            ],
            [
                "claude_code_active_time_seconds_total",
                "Active time excluding idle (sec)",
                "type (user/cli)",
            ],
        ],
        0.45,
        1.15,
        9.10,
        3.10,
        [3.3, 2.5, 3.2],
    )
    call(
        s,
        0.45,
        4.35,
        9.10,
        0.60,
        'Standard attrs: session.id, organization.id, user.account_uuid, user.email, terminal.type, app.version (opt-in)\nCache hit = sum(token{type="cache_read"}) / sum(token{type=~"cache_read|input"}).  Dashboard: grafana.com/dashboards/24993',
    )
    txt(
        s,
        "Beta spans: set CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1 for interaction / llm_request / tool / hook spans.",
        0.45,
        5.05,
        9.10,
        0.20,
        sz=8,
        c=MUTED_FG,
    )


def s6(p):
    s = p.slides.add_slide(p.slide_layouts[6])
    chrome(
        s,
        6,
        TS,
        "24 Native OTEL Events",
        "Log-based events emitted via OTLP alongside metrics · OTEL_LOG_TOOL_DETAILS=1 for full detail",
    )
    tbl(
        s,
        [
            ["Event Name", "When Emitted", "Key Attributes"],
            [
                "claude_code.user_prompt",
                "User submits a prompt",
                "prompt_length, command_name, prompt (if LOG_USER_PROMPTS)",
            ],
            [
                "claude_code.tool_result",
                "Tool completes execution",
                "tool_name, success, duration_ms, decision_type, error_type",
            ],
            [
                "claude_code.api_request",
                "API request succeeds",
                "model, cost_usd, duration_ms, input/output/cache tokens",
            ],
            [
                "claude_code.api_error",
                "API request fails",
                "model, error, status_code, attempt, request_id",
            ],
            [
                "claude_code.tool_decision",
                "Permission decision made",
                "tool_name, decision, source (config/hook/user)",
            ],
            [
                "claude_code.skill_activated",
                "Skill invoked (/ or proactive)",
                "skill.name, invocation_trigger, skill.source, plugin.name",
            ],
            [
                "claude_code.plugin_loaded",
                "Plugin enabled at session start",
                "plugin.name, scope, skill_path_count, has_hooks, has_mcp",
            ],
            [
                "claude_code.hook_execution_complete",
                "Hooks for event finish",
                "hook_event, num_hooks, num_success, total_duration_ms",
            ],
            [
                "claude_code.mcp_server_connection",
                "MCP server connects/fails",
                "status, transport_type, server_scope, duration_ms",
            ],
            [
                "claude_code.compaction",
                "Conversation compacted",
                "trigger (auto/manual), pre/post_tokens, duration_ms",
            ],
            [
                "claude_code.permission_mode_changed",
                "Permission mode changes",
                "from_mode, to_mode, trigger",
            ],
            [
                "claude_code.auth",
                "Login / logout completes",
                "action, success, auth_method, error_category",
            ],
        ],
        0.45,
        1.15,
        9.10,
        3.65,
        [2.8, 2.2, 4.0],
    )
    call(
        s,
        0.45,
        4.88,
        9.10,
        0.32,
        "+12 more: api_request/response_body, api_retries_exhausted, internal_error, plugin_installed, hook_registered, hook_execution_start, hook_plugin_metrics, at_mention, feedback_survey",
    )


ALL = [s1, s2, s3, s4, s5, s6]
