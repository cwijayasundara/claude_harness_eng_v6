---
name: scaffold
description: Initialize a new project with the Claude Harness Engine v4 scaffold.
---

# /scaffold — Project Initialization

When the user runs this command, follow these steps exactly:

## Step 1: Gather Project Info — Infer + Confirm

> **MANDATORY: Q1 + confirmation card always shown.** Even if the session has a "don't pause for clarifications" / "make the reasonable call and continue" directive, you MUST ask the free-text Q1 below AND show the confirmation card. The user invoked `/scaffold` to configure a project — that is an explicit request for input gathering, not an ambiguous instruction to clarify.
>
> Silently defaulting locks in choices the user can't easily reverse (tracker mode, framework packs, design calibration).

### Step 1.A — Ask the description (Q1, free text)

Ask exactly this question with a normal prompt (no `AskUserQuestion`):

> "What are you building? In 1–3 sentences, include: language/framework, project shape (web app / script / library / brownfield existing code), the primary user surface (CLI / web UI / API / nothing yet), and any team integrations that matter (Linear, Jira, etc.)."

Wait for the answer. It goes verbatim into CLAUDE.md and drives the inference in 1.B.

### Step 1.B — Infer a draft profile from Q1

Apply these rules. Be explicit and conservative — when the description is ambiguous, pick the safer middle option (the user will see and can change everything in 1.C).

**Stack:**
- "FastAPI" + ("React" or "Vite") → preset A
- "FastAPI" + ("Next" or "Next.js") → preset B
- "Express" + "React" → preset C
- "Python" + script/agent/CLI/library indicators → custom Python (3.12 · uv · ruff · mypy · pytest), no frontend, no DB
- "Node" / "TypeScript" + script/CLI indicators → custom Node, no frontend, no DB
- Otherwise → preset A (most common)

**Project type (drives calibration):**
- script · CLI · library · agent · tool · utility → D Minimal (`/lite` recommended, no `calibration-profile.json`)
- marketplace · consumer · SaaS · B2C · landing page → A Consumer-facing
- dashboard · admin · internal tool · back-office · B2B internal → B Internal tool
- API-only · backend service · microservice · no UI → C API-only (no UI scoring)
- Otherwise → B Internal tool

**Verification mode:**
- Project type = D Minimal OR C API-only → C Stub
- Mentions Docker / Compose / a full-stack preset → A Docker
- Mentions local dev / no Docker / uvicorn / npm run dev → B Local
- Otherwise → A Docker

**Plugins:** Always default to A (all 8). The "recommended" answer is rarely wrong for new projects.

**Tracker:** Default to A Local-only unless Q1 explicitly names a tracker:
- Mentions "Linear" → C Publish + sync
- Mentions "Jira" → B Publish-only (Jira sync isn't fully implemented yet)

**Framework skill pack — keyword match in Q1:**
- "LangChain" / "LangGraph" / "DeepAgents" / "LangSmith" → A LangChain pack
- "ADK" / "Agent Development Kit" / "Gemini Enterprise" / "Vertex AI Agents" → B Google ADK
- Both sets of terms → both packs
- Neither → C None

Graphify (the former Q6) is no longer asked here. It only matters for brownfield discovery — surface it inside `/brownfield`, not at scaffold time.

### Step 1.C — Show the confirmation card

Call `AskUserQuestion` ONCE with the inferred profile rendered as the `preview` of option A. Single-select, three options:

- **A) Scaffold with these choices** — accept the inferred profile as-is.
- **B) Change tracker mode only** — quick edit for the field hardest to infer.
- **C) Use the full 8-question wizard** — for unusual stacks or full control.

The `preview` for option A must be a markdown block in this exact shape (substitute inferred values):

```
## Inferred profile

  Description     {first 120 chars of Q1}

  Stack           {inferred stack summary, e.g. "Python 3.12 · uv · ruff · mypy · pytest"}
  Project type    {A / B / C / D — display name}
  Verification    {A / B / C — display name}
  Plugins         All 8 official (recommended)
  Tracker         {A / B / C / D — display name}
  Framework pack  {A / B / C — display name(s)}

  (Graphify is no longer asked at scaffold time; surface it via /brownfield.)
```

For option B's `preview`, show the same block but emphasise the Tracker line ("← will change"). For option C, the preview can just say "Falls through to the 8-question wizard. Inferred values become the defaults."

### Step 1.D — Branch on the user's choice

1. **"Scaffold with these choices"** → record all inferred answers as final. Proceed to Step 2.

2. **"Change tracker mode only"** → call `AskUserQuestion` with a single question listing the 4 tracker options (see wizard Q7 in Step 1.E below). Record the answer, then proceed to Step 2. Do NOT loop back to the confirmation card.

3. **"Use the full 8-question wizard"** → fall through to Step 1.E. Pre-pend the inferred answer to each question's description (e.g. "Inferred: A — change if needed") so the user sees what would have been picked.

If the user refuses to engage with the confirmation card ("just pick something", "use defaults"), treat that as informed consent for the inferred profile and proceed with option 1.

### Step 1.E — Wizard fallback (only if user picked option C)

Ask the following one at a time, using `AskUserQuestion` for each multi-choice question. Pre-pend the inferred answer in each question's description.

1. "What are you building?" — skip; already captured in Step 1.A.
2. "What's your tech stack?"
   - A) Python (FastAPI) + React (Vite) + PostgreSQL
   - B) Python (FastAPI) + Next.js + PostgreSQL
   - C) Node (Express) + React (Vite) + PostgreSQL
   - D) Custom (I'll specify)
3. "What type of project is this?" (calibration):
   - A) Consumer-facing app (high design bar)
   - B) Internal tool / dashboard (functional focus)
   - C) API-only / backend service (no UI scoring)
   - D) Minimal — CLI / library / single-script (recommends `/lite`)

If the user picks D, the full harness is still installed (in case scope grows) but the Step 10 report recommends `/lite` and `calibration-profile.json` is skipped.

4. "How will the evaluator reach the running app?":
   - A) Docker Compose (default)
   - B) Local dev servers
   - C) Stub / mock server
5. "Install complementary official Claude Code plugins?"
   - `superpowers` — Structured developer workflows used by the harness pipeline
   - `code-review` — Automated PR review with confidence scoring
   - `commit-commands` — `/commit`, `/commit-push-pr` git workflows
   - `security-guidance` — Real-time security pattern checking on edits
   - `pr-review-toolkit` — Specialized PR review agents (comments, tests, errors, types)
   - `frontend-design` — Aesthetic direction skill (does NOT replace `design-critic`)
   - `context7` — Up-to-date library/docs lookup MCP
   - `code-simplifier` — `/simplify` skill used during `/refactor`
   - A) Yes, install all eight (recommended)
   - B) Let me pick which ones
   - C) No, skip official plugins
6. "Enable optional external tracker orchestration?"
   - A) No, keep this project local-only
   - B) Publish generated story groups to Linear/Jira only
   - C) Publish + sync proof/status
   - D) Publish + external orchestrator dispatch
7. "Configure agent-framework skill packs?" (multi-select; default: None) — opt-in packs recorded in `project-manifest.json`, then installed manually from a normal terminal because Claude Code auto-mode blocks external `npx skills add` installs.
   - A) LangChain / LangGraph / DeepAgents — `cwijayasundara/agent_cli_langchain` (9 skills)
   - B) Google ADK — `google/agents-cli` (7 skills)
   - C) None

## Step 2: Generate project-manifest.json

Based on their answers, write `project-manifest.json` to the project root. Fill in:
- name: from their description
- stack.backend: language, version, framework, package_manager, linter, typechecker, test_runner
- stack.frontend: same fields
- stack.database: primary, secondary
- stack.deployment: method ("docker-compose"), services list
- evaluation: api_base_url, ui_base_url, health_check, design_score_threshold (7), design_max_iterations (10), test_corpus_dir
- execution: default_mode ("full"), max_self_heal_attempts (3), max_auto_iterations (50), coverage_threshold (80), session_chaining (true), agent_team_size ("auto"), teammate_model ("sonnet")
- lsp: detected language servers and install commands (see below)
- verification: mode, health_check, and mode-specific config (see below)

### LSP Config (auto-detected from stack)

Infer the recommended LSP servers from the stack chosen in Step 1. Write an `lsp` block into `project-manifest.json`:

```json
"lsp": {
  "servers": [
    { "language": "python", "server": "pyright", "binary": "pyright", "install": "npm i -g pyright" },
    { "language": "typescript", "server": "typescript-language-server", "binary": "typescript-language-server", "install": "npm i -g typescript-language-server typescript" }
  ]
}
```

Use this mapping table to populate the `servers` array — include only the languages present in the stack:

| Language | LSP Server | Binary on `$PATH` | Install Command |
|----------|------------|-------------------|-----------------|
| Python | pyright | `pyright` | `npm i -g pyright` |
| TypeScript / JavaScript | typescript-language-server | `typescript-language-server` | `npm i -g typescript-language-server typescript` |
| Go | gopls | `gopls` | `go install golang.org/x/tools/gopls@latest` |
| Java | jdtls | `jdtls` | `brew install jdtls` (macOS) or download from eclipse.org |
| C# | omnisharp-roslyn | `OmniSharp` | `dotnet tool install -g omnisharp` |
| Rust | rust-analyzer | `rust-analyzer` | `rustup component add rust-analyzer` |

For preset stacks:
- **A/B** (Python + TypeScript): include pyright + typescript-language-server
- **C** (Node + TypeScript): include typescript-language-server only
- **Custom Python**: include pyright only
- **Custom Node/TypeScript**: include typescript-language-server only
- **Custom (other)**: match from the table above or leave `servers: []` with a comment

### Verification Config (based on the verification-mode decision)

**If Docker (A):**
```json
"verification": {
  "mode": "docker",
  "health_check": { "url": "http://localhost:3000/health", "retries": 5, "backoff_seconds": 2 },
  "docker": { "compose_file": "docker-compose.yml", "services": ["backend", "frontend"] }
}
```

**If Local (B):**
```json
"verification": {
  "mode": "local",
  "health_check": { "url": "http://localhost:3000/health", "retries": 5, "backoff_seconds": 2 },
  "local": { "backend_url": "http://localhost:8000", "frontend_url": "http://localhost:3000", "start_commands": [] }
}
```

**If Stub (C):**
```json
"verification": {
  "mode": "stub",
  "health_check": { "url": "http://localhost:4000/health", "retries": 5, "backoff_seconds": 2 },
  "stub": { "schema_source": "specs/design/api-contracts.schema.json", "auto_generate_mock_server": true }
}
```

### Generate calibration-profile.json (based on the project-type decision)

**If Consumer-facing app (A):**
```json
{
  "scoring": {
    "weights": { "design_quality": 1.5, "originality": 1.5, "craft": 1.5, "functionality": 1.0 },
    "threshold": 8,
    "per_criterion_minimum": 5
  },
  "iteration": {
    "max_iterations": 10,
    "plateau_window": 3,
    "plateau_delta": 0.3,
    "pivot_after_plateau": true
  }
}
```

**If Internal tool (B):**
```json
{
  "scoring": {
    "weights": { "design_quality": 0.75, "originality": 0.5, "craft": 0.5, "functionality": 1.5 },
    "threshold": 6,
    "per_criterion_minimum": 4
  },
  "iteration": {
    "max_iterations": 5,
    "plateau_window": 3,
    "plateau_delta": 0.3,
    "pivot_after_plateau": false
  }
}
```

**If API-only (C):** Do not create `calibration-profile.json` (no UI scoring needed).

**If Minimal (D):** Do not create `calibration-profile.json` (no UI scoring needed). The Step 10 report should lead with `/lite` as the recommended entry point.

Preset mappings:
- A) backend: python/3.12/fastapi/uv/ruff/mypy/pytest, frontend: typescript/react/vite/npm/eslint/tsc/vitest, db: postgresql
- B) backend: python/3.12/fastapi/uv/ruff/mypy/pytest, frontend: typescript/nextjs/16/npm/eslint/tsc/vitest, db: postgresql
- C) backend: javascript/node/express/npm/eslint/tsc/jest, frontend: typescript/react/vite/npm/eslint/tsc/vitest, db: postgresql

## Step 3: Copy Scaffold Files

First, locate the plugin source directory by finding the newest installed local-harness copy. Prefer the Claude plugin cache over broad filesystem search so stale clones do not shadow the active plugin.

```bash
# Prefer the newest local marketplace cache for this plugin.
PLUGIN_SOURCE=$(find ~/.claude/plugins/cache/local-harness/claude_harness_eng_v4 -maxdepth 3 -path "*/.claude-plugin/plugin.json" -print 2>/dev/null | sort -V | tail -1 | sed 's|/.claude-plugin/plugin.json||')

# Fallback for --plugin-dir development sessions.
if [ -z "$PLUGIN_SOURCE" ]; then
  PLUGIN_SOURCE=$(find ~/claude_harness_eng_v4/.claude ~/Documents/rnd_2026/claude_scaffold_research/claude_harness_eng_v4/.claude -maxdepth 3 -path "*/.claude-plugin/plugin.json" -exec grep -l '"name": "claude_harness_eng_v4"' {} \; 2>/dev/null | head -1 | sed 's|/.claude-plugin/plugin.json||')
fi

echo "Found plugin at: $PLUGIN_SOURCE"
```

If `$PLUGIN_SOURCE` is empty, ask the user: "Where is the claude_harness_eng_v4 repo cloned? I need the path to copy scaffold files." Then set `PLUGIN_SOURCE=/path/they/give/.claude`.

Resolve the harness root (one level above `.claude/`) before validation:

```bash
HARNESS_ROOT=$(dirname "$PLUGIN_SOURCE")
```

Before copying, validate the source:

```bash
test -f "$PLUGIN_SOURCE/.claude-plugin/plugin.json"
test -d "$PLUGIN_SOURCE/skills/brownfield"
test -d "$PLUGIN_SOURCE/skills/code-map"
test -f "$PLUGIN_SOURCE/skills/code-map/scripts/import_understand_graph.js"
test -f "$PLUGIN_SOURCE/scripts/telemetry-memory.js"
test -f "$PLUGIN_SOURCE/scripts/replay-telemetry.js"
test -d "$PLUGIN_SOURCE/skills/seam-finder"
test -d "$PLUGIN_SOURCE/skills/vibe"
test -d "$PLUGIN_SOURCE/workflows"
test -f "$PLUGIN_SOURCE/workflows/harness-review.js"
test -f "$PLUGIN_SOURCE/workflows/harness-implement-group.js"
test -f "$PLUGIN_SOURCE/workflows/harness-brownfield-map.js"
test -f "$PLUGIN_SOURCE/workflows/harness-eval.js"
test -f "$PLUGIN_SOURCE/templates/context.template.md"
test -f "$PLUGIN_SOURCE/templates/claude-security-guidance.template.md"
test -f "$PLUGIN_SOURCE/templates/security-patterns.template.yaml"
test -f "$PLUGIN_SOURCE/templates/story.template.md"
SKILL_COUNT=$(find "$PLUGIN_SOURCE/skills" -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ')
TEMPLATE_COUNT=$(find "$PLUGIN_SOURCE/templates" -maxdepth 1 -type f | wc -l | tr -d ' ')
WORKFLOW_COUNT=$(find "$PLUGIN_SOURCE/workflows" -maxdepth 1 -name '*.js' | wc -l | tr -d ' ')
test "$SKILL_COUNT" = "27"
test "$TEMPLATE_COUNT" = "16"
test "$WORKFLOW_COUNT" = "4"
test -f "$PLUGIN_SOURCE/git-hooks/prepare-commit-msg"
test -f "$PLUGIN_SOURCE/git-hooks/pre-commit"
test -f "$HARNESS_ROOT/README.md"
test -f "$HARNESS_ROOT/telemetry_docker_compose.yml"
test -f "$HARNESS_ROOT/telemetry/otel-collector-config.yml"
test -f "$HARNESS_ROOT/telemetry/prometheus.yml"
test -f "$HARNESS_ROOT/telemetry/cache-alerts.rules.yml"
test -f "$HARNESS_ROOT/telemetry/grafana/dashboards/harness-overview.json"
test -f "$HARNESS_ROOT/telemetry/grafana/dashboards/cache-health.json"
test -f "$HARNESS_ROOT/telemetry/grafana/provisioning/dashboards/dashboards.yml"
test -f "$HARNESS_ROOT/telemetry/grafana/provisioning/datasources/prometheus.yml"
```

If any validation command fails, stop and report: "The resolved plugin source is stale or incomplete; refresh the local marketplace and update the plugin before scaffolding."

Once you have the source path, create `.claude/` in the target project and copy:

```bash
mkdir -p .claude
cp -r $PLUGIN_SOURCE/.claude-plugin/ .claude/.claude-plugin/
cp -r $PLUGIN_SOURCE/agents/ .claude/agents/
cp -r $PLUGIN_SOURCE/skills/ .claude/skills/
cp -r $PLUGIN_SOURCE/hooks/ .claude/hooks/
cp -r $PLUGIN_SOURCE/scripts/ .claude/scripts/
cp -r $PLUGIN_SOURCE/state/ .claude/state/
cp -r $PLUGIN_SOURCE/templates/ .claude/templates/
cp -r $PLUGIN_SOURCE/workflows/ .claude/workflows/
cp $PLUGIN_SOURCE/architecture.md .claude/architecture.md
cp $PLUGIN_SOURCE/program.md .claude/program.md
cp $PLUGIN_SOURCE/settings.json .claude/settings.json
```

Copy the telemetry stack (OTEL Collector + Prometheus + Pushgateway):

```bash
cp "$HARNESS_ROOT/telemetry_docker_compose.yml" ./telemetry_docker_compose.yml
mkdir -p telemetry
cp "$HARNESS_ROOT/telemetry/otel-collector-config.yml" ./telemetry/
cp "$HARNESS_ROOT/telemetry/prometheus.yml" ./telemetry/
cp "$HARNESS_ROOT/telemetry/cache-alerts.rules.yml" ./telemetry/
cp "$HARNESS_ROOT/telemetry/CACHE_MONITORING.md" ./telemetry/
rm -rf ./telemetry/grafana && cp -r "$HARNESS_ROOT/telemetry/grafana" ./telemetry/
cp "$HARNESS_ROOT/README.md" ./SCAFFOLD_README.md
mkdir -p docs
cp "$HARNESS_ROOT/docs/telemetry.md" "$HARNESS_ROOT/docs/testing.md" "$HARNESS_ROOT/docs/extras.md" ./docs/
```

**Important:** Do NOT run `mkdir -p` on any of the file paths inside `telemetry/` — that would create directories where files should be. The `cp` commands above handle the file creation directly.

**Important:** You MUST actually run these copy commands via Bash. Do NOT skip this step or try to generate the files from memory. The source files contain hooks, agent definitions, and skill instructions that must be copied exactly.

### Add Official Plugins to settings.json (based on the plugins decision)

After copying settings.json, add the `enabledPlugins` block based on the user's answer:

**If Yes (all eight) or selected plugins:**
Merge the selected official plugins into the project's existing `.claude/settings.json` `enabledPlugins` object:
```json
"enabledPlugins": {
  "superpowers@claude-plugins-official": true,
  "code-review@claude-plugins-official": true,
  "commit-commands@claude-plugins-official": true,
  "security-guidance@claude-plugins-official": true,
  "pr-review-toolkit@claude-plugins-official": true,
  "frontend-design@claude-plugins-official": true,
  "context7@claude-plugins-official": true,
  "code-simplifier@claude-plugins-official": true
}
```

Do not replace the whole `enabledPlugins` object if it already exists. Preserve existing project/plugin entries such as `claude_harness_eng_v4@local-harness`; otherwise a project-scoped plugin install can be disabled by the scaffold copy.

If the user chose "Let me pick," only include the plugins they selected.

**If No:** Do not add `enabledPlugins` to settings.json.

These plugins are complementary to the harness and do not conflict:
- `superpowers` — structured workflows used by the harness pipeline for brainstorming, planning, TDD, debugging, and verification
- `code-review` — PR review (our harness does sprint evaluation, not PR review)
- `commit-commands` — git workflows (our harness manages commits in `/auto`, but manual commits need this)
- `security-guidance` — real-time, in-session security review (per-edit pattern match + background diff/commit reviews). **Advisory only — it never blocks** (per its docs); findings are fed to Claude as suggestions. It complements but does not replace enforcement: the deterministic `pre-write-gate` hook blocks secrets before they reach disk, and the **`security-reviewer` agent is the enforced gate** (its `security-verdict.json` fails `/evaluate` and the `/auto` loop on any critical/high finding). Sharpen the plugin with a project threat model in `.claude/claude-security-guidance.md` and custom deterministic patterns in `.claude/security-patterns.yaml`. The plugin itself **cannot block** (advisory by design), but the harness `pre-write-gate` hook reads that same patterns file and **hard-blocks** any rule you flag `block: true` — so the plugin warns on every pattern and the hook enforces the subset you choose.
- `pr-review-toolkit` — specialized PR agents for after the harness finishes building
- `frontend-design` — aesthetic-direction skill. Invoked by `ui-designer` during `/design` and by frontend teammates during `/implement` to avoid raw-Tailwind-default UI. The `design-critic` GAN loop still owns scoring and iteration control — `frontend-design` does not replace it.
- `context7` — up-to-date library/docs lookup MCP. Useful when teammates need current API references for third-party libraries.
- `code-simplifier` — in-session `/simplify` skill used during `/refactor` for reuse, quality, and efficiency cleanup.

**Do NOT install** these official plugins (they conflict with harness functionality):
- `feature-dev` — competes with our `/brd` -> `/spec` -> `/design` -> `/implement` pipeline
- `hookify` — dynamically generated hooks could interfere with our purpose-built hooks

### Generate .mcp.json (MCP Server Configuration)

Copy the MCP config template to the project root as a starting point for connecting to internal tools, databases, and documentation:

```bash
cp $PLUGIN_SOURCE/templates/mcp-config.template.json .mcp.json
```

All servers are disabled by default. The user enables servers they need and configures connection details. Add `.mcp.json` to version control so all team members get the same MCP server configuration.

### Generate Security Threat-Model Files

Copy the security starter files to `.claude/` (read by both the `security-guidance` plugin and the `security-reviewer` gate):

```bash
cp $PLUGIN_SOURCE/templates/claude-security-guidance.template.md .claude/claude-security-guidance.md
cp $PLUGIN_SOURCE/templates/security-patterns.template.yaml .claude/security-patterns.yaml
```

`claude-security-guidance.md` holds the project threat model; its `MUST`/`NEVER` rules are advisory in the plugin but become **blocking** findings in the `security-reviewer` gate. `security-patterns.yaml` adds deterministic per-edit warning patterns (plugin-only, advisory). Commit both. Tell the user to fill in the project-specific rules and note that `security-patterns.yaml` requires PyYAML in the plugin's Python — otherwise rename it to `security-patterns.json` (same schema).

## Step 4: Create Output Directories

```bash
mkdir -p specs/brd specs/stories specs/design/mockups specs/design/amendments specs/reviews specs/test_artefacts specs/brownfield sprint-contracts e2e
```

### Optional Tracker Orchestration Files

If the user chose any tracker orchestration option other than "No":

```bash
cp .claude/templates/tracker-config.template.json .claude/tracker-config.json
mkdir -p .claude/state/tracker-runs
```

Then write `.claude/tracker-config.json` with the chosen mode flipped on. Do not leave the file shipped from the template (`enabled: false`) — that silently disables `/tracker-publish` and confuses users.

Use the Edit or Write tool to make these changes explicitly:

- Mode B (Publish only): set `enabled: true`, `mode: "publish-only"`.
- Mode C (Publish + sync): set `enabled: true`, `mode: "sync"`.
- Mode D (Publish + external orchestrator dispatch): set `enabled: true`, `mode: "orchestrate"`.

If the user named a specific provider in Q1 ("Linear", "Jira"), also overwrite `provider` to match. Leave `project_slug` as the template placeholder — the user must fill it in themselves (their tracker workspace slug is not knowable from the scaffold interview).

Do not write tracker API keys into `.claude/tracker-config.json`. Use environment variables such as `LINEAR_API_KEY`, `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, and `GITHUB_TOKEN`. Surface the remaining prerequisites in the Step 10 report (see "Tracker Setup Addendum" below).

### Optional Agent-Framework Skill Packs

If the user selected one or more skill packs (LangChain or Google ADK) at the confirmation card or wizard, record the selection in `project-manifest.json` and print the manual install commands in the Step 10 report.

Do not run `npx skills add` from `/scaffold`. Claude Code auto-mode commonly blocks external `npx` installs even when command permissions are allowlisted, so attempting it during scaffold creates a noisy denial and a misleading partial-success report. The reliable path is:

1. Scaffold writes the harness files and records selected packs.
2. The user runs the listed `npx --yes skills add ...` command in a normal terminal.
3. The user returns to Claude Code and runs `/install-framework-packs --list` to verify.

**Important:** The manual commands must be run inside the target project directory. Do NOT use `-g`/`--global` — the user has explicitly chosen to scope framework skills per-project so the harness scaffold remains generic.

**CLI syntax (critical):** the **package source goes FIRST** as a positional argument. Putting flags before the package will fail with `ERROR  Missing required argument: source`. Use `-y` only AFTER the package source.

**A) LangChain / LangGraph / DeepAgents — 9 skills**

```bash
npx --yes skills add cwijayasundara/agent_cli_langchain -a claude-code -s '*' -y
```

Expected: 9 skills under `.claude/skills/langchain-agents-*` (scaffold, workflow, langchain-code, langgraph-code, deepagents-code, middleware, langsmith-evals, deploy, observability). Source: <https://github.com/cwijayasundara/agent_cli_langchain>. Two skills (`deepagents-code`, `deploy`) carry a "Med Risk" Snyk flag — surface this in the install report and recommend the user review those SKILL.md files before letting them drive code generation.

**B) Google ADK — 7 skills**

```bash
npx --yes skills add google/agents-cli -a claude-code -s '*' -y
```

Expected: 7 skills under `.claude/skills/google-agents-cli-*` (scaffold, workflow, adk-code, eval, deploy, observability, publish).

Verify manual installs with:

```bash
ls .claude/skills/ | grep -E '^(langchain-agents|google-agents-cli)-' | wc -l
```

#### Manual install block

If one or more framework packs were selected, print this block verbatim and ADD it to the Step 10 report under a "Manual follow-ups" heading:

```text
[!] Framework skill pack(s) require a manual terminal install.
    Claude Code auto-mode blocks external npx installs during /scaffold.

  cd <project-root>
  npx --yes skills add cwijayasundara/agent_cli_langchain -a claude-code -s '*' -y   # if LangChain
  npx --yes skills add google/agents-cli -a claude-code -s '*' -y                     # if Google ADK

After running, verify (the packs land in .claude/skills/ alongside the harness skills):
  ls .claude/skills/ | grep -E '^(langchain-agents|google-agents-cli)-'
  /install-framework-packs --list
```

#### Record selected packs in project-manifest.json

Record the user's *choice* under a top-level `framework_skill_packs` array in `project-manifest.json`. This lets future `/scaffold enhance` operations and the Step 10 report see the intent regardless of install status:

```json
"framework_skill_packs": ["langchain", "google-adk"]
```

Omit the field if the user picked None.

## Step 5: Generate CLAUDE.md

Write CLAUDE.md tailored to chosen stack. This is a slim table of contents (~70 lines) that
directs agents to the right reference files via progressive disclosure. Do not inline full rules
here — agents discover details by reading the referenced skill files.

When filling in the LSP Integration section of the template, replace the placeholders:
- `{lsp_install_commands}` — one bullet per server from the `lsp.servers` array in the manifest. Format: `- \`{install_command}\` — {language} ({server_name})`
- `{lsp_verify_command}` — a one-liner that checks all binaries, e.g. `pyright --version && typescript-language-server --version`

### CLAUDE.md Template

```markdown
# {project-name}

{description from user input}

## Quick Reference

**Backend:** `cd backend && uv run pytest -x -q` | `uv run ruff check --fix .` | `uv run mypy src/`
**Frontend:** `cd frontend && npm test` | `npm run lint` | `npm run typecheck`
**Full stack:** Start backend + frontend (see init.sh)

## Architecture

Strict layered architecture: Types → Config → Repository → Service → API → UI.
One-way dependencies only. See `.claude/architecture.md` for full rules.

## Where to Find Things

| What | Where |
|------|-------|
| Architecture rules | `.claude/architecture.md` |
| Quality principles | `.claude/skills/code-gen/SKILL.md` |
| Testing patterns | `.claude/skills/testing/SKILL.md` |
| Brownfield discovery | `specs/brownfield/` and `.claude/skills/brownfield/SKILL.md` |
| Evaluation rubric | `.claude/skills/evaluation/SKILL.md` |
| Sprint contract format | `.claude/skills/evaluation/references/contract-schema.json` |
| Playwright patterns | `.claude/skills/evaluation/references/playwright-patterns.md` |
| Human control knobs | `.claude/program.md` |
| Dynamic workflows | `.claude/workflows/` (each `.js` → a `/<name>` command) |
| Small work lane | `.claude/skills/vibe/SKILL.md` |
| Code graph mapping | `.claude/skills/code-map/SKILL.md` |
| Seam ranking | `.claude/skills/seam-finder/SKILL.md` |
| Session recovery | `claude-progress.txt` |
| Feature tracking | `features.json` |
| Learned rules | `.claude/state/learned-rules.md` |
| Controlled vibe log | `.claude/state/vibe-log.md` |

## Pipeline Commands

| Command | Purpose |
|---------|---------|
| `/brd` | Socratic interview → BRD |
| `/spec` | BRD → stories + features.json |
| `/design` | Architecture + schemas + mockups (parallel with `/test`) |
| `/test` | Test plan + cases + fixtures (`--plan-only`) or Playwright E2E (`--e2e-only`) |
| `/build` | Full 10-phase pipeline |
| `/lite` | Compressed greenfield lane for small projects (CLI / library / single-script) |
| `/vibe` | Controlled small-change lane |
| `/brownfield` | Map an existing codebase before changing it |
| `/code-map` | Build deterministic dependency graph for brownfield/refactor work |
| `/seam-finder` | Rank safe cut-points for a concrete goal |
| `/auto` | Autonomous ratcheting loop |
| `/implement` | Code gen with agent teams |
| `/evaluate` | Run app, verify contract |
| `/review` | Evaluator + security review |
| `/deploy` | Docker Compose + init.sh |

## Dynamic Workflows

`.claude/workflows/*.js` files auto-register as `/<name>` slash commands — deterministic multi-agent orchestration (fan-out → verify → synthesize), shared via git. Shipped with the harness:

| Command | Mirrors | Purpose |
|---------|---------|---------|
| `/harness-review` | `/review` | Multi-dimension review of the diff (correctness · security · architecture · quality), adversarially verified |
| `/harness-implement-group <group-id>` | `/implement` | Parallel TDD build of a sprint group's stories in isolated worktrees, each acceptance-reviewed |
| `/harness-brownfield-map [scope]` | `/brownfield` | Multi-lens codebase survey (structure · entry points · deps · tests · risk) synthesized into `specs/brownfield/` maps |
| `/harness-eval <contract-id>` | `/evaluate` | Three-layer verification (API · UI · schema) run in parallel against the running app → one PASS/FAIL verdict |

Enablement is plan/runtime-gated, not a project setting: requires Pro+ (toggle in `/config` on Pro; default-on for Max/Team/Enterprise), and is triggered by the word `workflow` in a prompt, a saved `/<name>` command, or `/effort ultracode` (auto-orchestration). Workflows use substantially more tokens than a normal turn. Do **not** add `disableWorkflows` to `.claude/settings.json` — that turns the feature off. See `.claude/workflows/README.md` to add your own.

## LSP Integration

LSP servers give agents go-to-definition, find-references, and type diagnostics — dramatically better than grep for symbol navigation. Install the servers listed in `project-manifest.json` under `lsp.servers`:

{lsp_install_commands}

Verify: `{lsp_verify_command}`

## Large Codebase Navigation

- Claude Code respects `.gitignore` for file navigation — keep it comprehensive
- For monorepos, add subdirectory CLAUDE.md files with scoped test/lint commands
- Install recommended LSP servers (see "LSP Integration" above) for symbol-level navigation
- Use the `codebase-explorer` agent for read-only discovery before making broad changes
- State files are auto-archived when they grow large — see `.claude/scripts/archive-state.js`
- Run `node .claude/scripts/archive-state.js` periodically in long-running projects

## Code Style

- For existing codebases, run `/brownfield` before broad planning or refactoring
- Small new projects (CLI tools, single-script utilities, small libraries) should use `/lite` instead of `/brd → /spec → /design`; see `.claude/skills/lite/SKILL.md`
- Small low-risk fixes may use `/vibe` instead of the full SDLC pipeline; see `.claude/skills/vibe/SKILL.md`
- TDD mandatory: test first, then implement
- 100% meaningful coverage target, 80% floor
- Functions < 50 lines, files < 300 lines
- Static typing everywhere (zero `any`)
- See `.claude/skills/code-gen/SKILL.md` for full rules

## Git

Branch: `<type>/<description>` (e.g., `feat/user-auth`)
Commits: conventional format (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`)
```

### Step 5.B: Generate Subdirectory CLAUDE.md Files (monorepo/multi-module projects)

If the project has separate `backend/` and `frontend/` directories (presets A, B, C), generate scoped CLAUDE.md files for each subdirectory. These load additively as Claude navigates the tree.

**backend/CLAUDE.md** (Python projects):
```markdown
# Backend

## Test & Lint Commands (run from this directory)

- `uv run pytest -x -q` — run tests
- `uv run ruff check --fix .` — lint
- `uv run mypy src/` — type check

## Conventions

- FastAPI route handlers in `src/api/`
- Business logic in `src/services/` — never import from `api/`
- Database access in `src/repository/` — never import from `services/`
- All functions must have type annotations
```

**frontend/CLAUDE.md** (TypeScript projects):
```markdown
# Frontend

## Test & Lint Commands (run from this directory)

- `npm test` — run tests
- `npm run lint` — lint
- `npm run typecheck` — type check

## Conventions

- Components in `src/components/` — one component per file
- API client calls in `src/api/` — never call fetch directly from components
- Shared types in `src/types/`
- No `any` types — use `unknown` and narrow
```

For single-root projects (custom Python/Node, project type D), skip this step — the root CLAUDE.md is sufficient.

**Codebase map:** Also generate a `CODEBASE_MAP.md` at the project root using the template from `.claude/templates/codebase-map.template.md`. Tailor the directories table and test commands to match the actual project stack inferred in Step 1.B.

## Step 6: Generate design.md

Architecture reference document (~200-300 lines):
- System architecture ASCII diagram
- Karpathy ratchet loop diagram
- Agent roles table (7 agents)
- Hook execution order (consolidated per-event hooks + git commit gates)
- State files description
- Sprint contract format summary
- Quality principles (6)

### design.md Template

```markdown
# Claude Harness Engine v4 — Design Reference

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User / CI                            │
└─────────────────────┬───────────────────────────────────────┘
                      │ slash commands
┌─────────────────────▼───────────────────────────────────────┐
│                   Orchestrator (Claude)                      │
│  /brd → /spec → /design → /build → /test → /evaluate        │
└──┬──────────┬──────────┬──────────┬──────────┬──────────────┘
   │          │          │          │          │
   ▼          ▼          ▼          ▼          ▼
Planner   Generator  Evaluator  Test Eng  Security Rev
   │          │          │          │          │
   └──────────┴──────────┴──────────┴──────────┘
                         │
              ┌──────────▼──────────┐
              │     State Layer      │
              │  features.json       │
              │  claude-progress.txt │
              │  learned-rules.md    │
              │  failures.md         │
              │  iteration-log.md    │
              └──────────────────────┘
```

## Karpathy Ratchet Loop

```
        ┌──────────────────────────────────┐
        │         Build Feature            │
        └──────────────┬───────────────────┘
                       │
        ┌──────────────▼───────────────────┐
        │       Evaluate vs Design         │◄──────────┐
        └──────────────┬───────────────────┘           │
                       │                               │
              score ≥ threshold?                       │
                  /         \                          │
                Yes           No                       │
                 │             │                       │
        ┌────────▼──┐  ┌───────▼────────┐             │
        │  Proceed  │  │  Design Critic  │             │
        └───────────┘  │  suggests fix   │             │
                       └───────┬─────────┘             │
                               │                       │
                       ┌───────▼─────────┐             │
                       │  Generator      │─────────────┘
                       │  applies fix    │  (max 5 iterations)
                       └─────────────────┘
```

## Agent Roles

| Agent            | File                          | Responsibility                         |
|------------------|-------------------------------|----------------------------------------|
| Planner          | `.claude/agents/planner.md`   | Sprint planning, story breakdown       |
| Generator        | `.claude/agents/generator.md` | Feature implementation                 |
| Evaluator        | `.claude/agents/evaluator.md` | API + Playwright verification          |
| Design Critic    | `.claude/agents/design-critic.md` | Design scoring (Karpathy loop)     |
| UI Designer      | `.claude/agents/ui-designer.md`   | Mockups, design tokens             |
| Test Engineer    | `.claude/agents/test-engineer.md` | Test authoring and execution       |
| Security Reviewer| `.claude/agents/security-reviewer.md` | Vulnerability auditing         |

## Hook Registration (settings.json)

Hooks key off the **tool name only** — there is no per-command or per-agent gating, so these fire on every matching edit whether it came from `/implement`, `/vibe`, an agent teammate, or a raw ad-hoc edit. Enforcement is uniform. Blocking hooks exit 2; advisory hooks exit 0 with a `Fix:` message.

One consolidated hook per event (each dispatches its checks in-process from `.claude/hooks/lib/`):

| Event matcher | Hook | Blocks? | Purpose |
|---|---|---|---|
| `PreToolUse Write\|Edit\|MultiEdit` | `pre-write-gate.js` | yes | Everything that must block BEFORE disk, first failure wins: scope (in-project paths only) → `.env` protection → secret scan on the inserted content only → `security-patterns.{json,yaml}` rules flagged `block: true` (`HARNESS_PATTERN_BLOCK=off`) → 300-line file cap → 30-line function cap → TDD test-first (`HARNESS_TDD_GATE=off`) |
| `PostToolUse Edit\|Write\|MultiEdit` | `verify-on-save.js` | yes | Queue the file in `pending-reviews.jsonl` (silent), then layer check (Python one-way imports), ruff/mypy or eslint on the saved file — report-only, never `--fix` |
| `UserPromptSubmit · Stop · SubagentStop` | `record-run.js` | no | Telemetry journal — off the per-edit hot path |
| `Stop` | `review-on-stop.js` | yes | Force clean-code + security reviewer before turn ends (consumes `pending-reviews.jsonl`); emits session-learnings advisories when clean |

Commit-time gates are real **git hooks** (installed in Step 8), not Claude Code hooks — they block the commit before it exists and fire once however the commit was invoked:

| Git hook | Purpose |
|---|---|
| `pre-commit` | Staged-file layer scan → sprint-contract `VERDICT: PASS` check → project-wide `tsc --noEmit` (TS) → pytest coverage ratchet vs baseline / 80% floor (Python; `HARNESS_COVERAGE_GATE=off` to bypass). Skips entirely when no source files are staged |
| `prepare-commit-msg` | Harness-Lane/Mode/Iteration/Group trailers from `.claude/state/current-*` markers |

> **Note:** The deterministic hooks above are the *only* always-on enforcement. The generator, evaluator, design-critic, and reviewer **agents** run solely when a slash command (`/build`, `/implement`, `/evaluate`, `/review`, `/vibe`, …) invokes them or when the model chooses to — a raw ad-hoc edit is guarded by hooks alone. Do not add `disableWorkflows` and do not assume agent-level validation fires without a command.

## TDD Enforcement (two complementary layers)

1. **`pre-write-gate.js` (test-first layer) — deterministic, on by default.** The PreToolUse gate blocks writing any source file with no accompanying test, checking test *existence* across common conventions (co-located `test_`/`_test`/`.test`/`.spec`, an adjacent `__tests__/` or `tests/`, and the `src/`→`tests/` mirror). Package markers, config, and `.d.ts` files are exempt. It cannot prove a test was failing first (red-green ordering). Bypass for legacy/brownfield: `HARNESS_TDD_GATE=off`.

2. **`tdd-guard` — LLM-judged red-green ordering, opt-in.** The third-party [tdd-guard](https://github.com/nizos/tdd-guard) plugin reads live test results and uses an LLM to judge whether an edit violates TDD discipline (implementation before a failing test, over-implementing). It complements layer 1: *existence* vs. *discipline*. It is opt-in because it needs an interactive plugin install plus per-project test reporters, which a scaffold cannot provision. Enable it from a normal terminal / prompt (not auto-mode):

   ```
   /plugin marketplace add nizos/tdd-guard
   /plugin install tdd-guard@tdd-guard
   /tdd-guard:setup        # registers its own PreToolUse hook + configures reporters
   ```

   Add the matching reporter — pytest: `uv add --dev tdd-guard-pytest`; vitest: `npm i -D tdd-guard-vitest` (add `new VitestReporter(path.resolve(__dirname))` to `vitest.config.ts`); jest: `npm i -D tdd-guard-jest`. It stores state in `.claude/tdd-guard/data/` (git-ignored) and uses the Claude Code session model by default (`VALIDATION_CLIENT=sdk`; set `VALIDATION_CLIENT=api` + `TDD_GUARD_ANTHROPIC_API_KEY` for CI). Toggle mid-session with `tdd-guard on` / `tdd-guard off`.

   > Do **not** also add a `tdd-guard` command to `settings.json` — `/tdd-guard:setup` registers its own PreToolUse hook, and a hand-added duplicate would double-invoke it (an uninstalled binary would error on every edit). The harness's `pre-write-gate` and tdd-guard coexist as separate PreToolUse hooks.

## State Files

| File                  | Purpose                                              |
|-----------------------|------------------------------------------------------|
| `features.json`       | Feature registry with status tracking                |
| `specs/brownfield/`   | Existing-codebase maps for brownfield work           |
| `claude-progress.txt` | Session progress and current pipeline position       |
| `learned-rules.md`    | Accumulated rules from past failures (ratchet memory)|
| `vibe-log.md`         | Micro-contract history for controlled small changes  |
| `pending-reviews.jsonl` | Hook-created review ledger for files changed this turn |
| `failures.md`         | Failure log for pattern analysis                     |
| `iteration-log.md`    | Evaluator iteration history per feature              |
| `coverage-baseline.txt` | Test coverage baseline for regression detection   |

## Sprint Contract Format

A sprint contract (`sprint-contracts/{group-id}.json`) defines a unit of work:

```json
{
  "contract_id": "group-01",
  "group_name": "Authentication",
  "stories": ["auth-01", "auth-02", "auth-03"],
  "acceptance_criteria": [...],
  "dependencies": [],
  "estimated_complexity": "medium",
  "approved": false
}
```

The git `pre-commit` gate blocks commits until the sprint contract is satisfied (`approved: true` + evaluator `VERDICT: PASS`).

## Quality Principles

1. **Correctness first** — all tests must pass before a feature is considered done
2. **Type safety** — strict typing enforced by hooks on every save
3. **Layered architecture** — one-way dependency boundaries enforced by the verify-on-save hook and the git pre-commit gate
4. **Test coverage** — coverage gate enforced at ≥ 80%; regressions block merges
5. **Security by default** — secrets detection runs on every commit; env files are protected
6. **Iterative improvement** — Karpathy ratchet ensures quality only moves forward
```

## Step 7: Generate init.sh

Read init-sh.template, replace placeholders based on manifest:
- {{BACKEND_INSTALL}}: e.g. `cd backend && uv sync && cd ..`
- {{FRONTEND_INSTALL}}: e.g. `cd frontend && npm ci && cd ..`
- {{DOCKER_COMPOSE_CMD}}: `docker compose up -d --build`
- {{LSP_HEALTH_CHECKS}}: one check per server from `lsp.servers` in the manifest
- {{HEALTH_CHECKS}}: curl commands for each service URL from manifest

Write to `init.sh` and `chmod +x init.sh`.

Placeholder mappings by preset:
- A/B (uv): `{{BACKEND_INSTALL}}` → `cd backend && uv sync && cd ..`
- C (npm): `{{BACKEND_INSTALL}}` → `cd backend && npm ci && cd ..`
- All presets: `{{FRONTEND_INSTALL}}` → `cd frontend && npm ci && cd ..`
- Health checks: use `api_base_url` and `ui_base_url` from manifest evaluation section

LSP health check template — generate one block per entry in `lsp.servers`:
```bash
if command -v {binary} &>/dev/null; then
  echo "  ✓ {server} ($({binary} --version 2>/dev/null || echo 'version unknown'))"
else
  echo "  ✗ {server} not found — install with: {install}"
fi
```

If `lsp.servers` is empty, replace `{{LSP_HEALTH_CHECKS}}` with `echo "  (no LSP servers configured — add to project-manifest.json lsp.servers if needed)"`.

## Step 8: Initialize Git

```bash
git init
```

Install the harness commit-trailer git hook and enable Claude Code native telemetry:

```bash
cp $PLUGIN_SOURCE/git-hooks/prepare-commit-msg .git/hooks/prepare-commit-msg
cp $PLUGIN_SOURCE/git-hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/prepare-commit-msg .git/hooks/pre-commit
mkdir -p .claude/runs
```

**Native OTEL telemetry** — Claude Code ships 8 metrics (tokens, cost, sessions, commits, PRs, LOC, tool acceptance, active time) and 24 event types. These env vars must be set **both** in `.claude/settings.json` (so Claude Code loads them automatically) and in `.env` (for shell scripts and docker compose).

**Step A — Add telemetry env vars to `.claude/settings.json`'s `env` block.** This is the critical step — Claude Code only reads env vars from `settings.json`, not from `.env` files. Use the Edit tool to merge these into the existing `env` object (do NOT overwrite keys already present like `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`):

```json
"env": {
  "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
  "OTEL_METRICS_EXPORTER": "otlp",
  "OTEL_LOGS_EXPORTER": "otlp",
  "OTEL_EXPORTER_OTLP_PROTOCOL": "grpc",
  "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4317",
  "OTEL_LOG_TOOL_DETAILS": "1",
  "HARNESS_PUSHGATEWAY_URL": "http://localhost:9091",
  "HARNESS_USER": "<resolved from git config user.name>"
}
```

Resolve `HARNESS_USER` by running `git config user.name` via Bash and inserting the result.

**Step B — Also create a `.env` file** for shell scripts and documentation:

```bash
GIT_USER=$(git config user.name 2>/dev/null || echo "unknown")
cat > .env << ENVEOF
# --- Claude Code native telemetry ---
CLAUDE_CODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_LOG_TOOL_DETAILS=1

# --- Harness-custom telemetry ---
HARNESS_PUSHGATEWAY_URL=http://localhost:9091
HARNESS_USER=${GIT_USER}
ENVEOF
```

You MUST complete both steps. Each team member's `settings.json` and `.env` must have their own `HARNESS_USER` so metrics are attributed correctly in the shared Prometheus/Grafana stack.

The telemetry stack is included at `telemetry_docker_compose.yml`. Start it with:

```bash
docker compose -f telemetry_docker_compose.yml up -d
```

This launches an OTEL Collector (receives native OTLP on :4317), Prometheus (scrapes at :9090), Pushgateway (receives custom harness metrics on :9091), and Grafana (dashboards at :3001). All team members point to the same telemetry server — the `user` label on every metric identifies who pushed it.

If the user does not want Docker, suggest `OTEL_METRICS_EXPORTER=prometheus` (scrape at `http://localhost:9464/metrics`) or `OTEL_METRICS_EXPORTER=console` for local debugging. The Grafana community dashboard is at `grafana.com/grafana/dashboards/24993`.

**What native OTEL covers (do NOT build custom):** tokens · cost · sessions · commits · PRs · LOC · tool accept/reject · active time · per-API-call latency · cost attribution by model/agent/skill.

**What the harness adds on top (custom, via record-run.js + commit trailers):**
- `Harness-Lane:` / `Harness-Mode:` / `Harness-Iteration:` / `Harness-Group:` commit trailers — segmentation key for lane-level dashboards in Jira/ADO/GitHub. Auto-injected by the `prepare-commit-msg` hook from `.claude/state/current-*` markers.
- `.claude/runs/*.jsonl` run-receipts — harness-specific fields only: lane, mode, iteration, group, story, contract pass/fail. Lightweight journal, not a telemetry system.

Write `.gitignore`:
```
# Environment
.env
.env.local
.env.production

# Dependencies
node_modules/
.venv/
venv/

# Build artifacts
dist/
build/
.next/
out/
*.egg-info/

# Python caches
__pycache__/
*.pyc
.mypy_cache/
.ruff_cache/
.pytest_cache/

# Test output
.coverage
htmlcov/
playwright-report/
test-results/
coverage/

# IDE
.idea/
.vscode/
*.swp
*.swo

# Generated / large files Claude should skip
*.min.js
*.min.css
*.map
*.lock
package-lock.json

# Harness state (not source)
.claude/runs/
.claude/state/archive/
.claude/state/lane-router-last.txt
.claude/state/last-drift-scan.txt
.claude/tdd-guard/
.claude/claude-security-guidance.local.md
```

## Step 9: Initialize State Files

```bash
echo '[]' > features.json
```

Write `claude-progress.txt`:
```
=== Session 0 ===
date: {ISO 8601 now}
mode: full
groups_completed: []
groups_remaining: []
current_group: none
current_stories: []
sprint_contract: none
last_commit: none
features_passing: 0 / 0
coverage: 0%
learned_rules: 0
blocked_stories: none
next_action: Run /brd to start
```

## Step 10: Report

The skill count is 27. The Step 3 validation also asserts this — keep both in sync if you add or remove skills.

Tailor the "Next steps" ordering based on the project-type decision:

- If the user picked **D — Minimal** as the project type, lead with `/lite` and demote `/brd`.
- Otherwise, keep `/brd` as the default first action.

**Default report (questions 3 = A / B / C):**
```
✓ Claude Harness Engine v4 scaffolded successfully.

Installed:
  8 agents      → .claude/agents/
  27 skills     → .claude/skills/
  hooks         → .claude/hooks/ (one per event + lib/)
  16 templates  → .claude/templates/
  4 workflows   → .claude/workflows/  (/harness-review, /harness-implement-group, /harness-brownfield-map, /harness-eval)
  6 state files → .claude/state/
  1 manifest    → .claude/.claude-plugin/plugin.json

Telemetry stack:
  telemetry_docker_compose.yml    → OTEL Collector (:4317) + Prometheus (:9090) + Pushgateway (:9091)
  telemetry/                      → Collector + Prometheus config
  Start: docker compose -f telemetry_docker_compose.yml up -d

LSP servers (auto-detected from stack):
  {for each lsp.servers entry, run `command -v {binary}` and print one of:}
  ✓ {server} ({language})             — found at $(which {binary})
  ✗ {server} ({language})             — not found, install: {install}

Large codebase tips:
  - Add subdirectory CLAUDE.md files for monorepo modules (see Step 5.B pattern)
  - Run `node .claude/scripts/archive-state.js` if state files grow large
  - Use the codebase-explorer agent for read-only discovery before broad changes

Next steps:
  1. Run /brd to create your Business Requirements Document
  2. For an existing codebase, run /brownfield first
  3. Or run /build to execute the full pipeline
  4. For small new projects (CLI / library / single-script), use /lite
  5. For tiny safe changes, use /vibe with a micro-contract
```

**Minimal report (project type = D):**
```
✓ Claude Harness Engine v4 scaffolded successfully (minimal project mode).

Installed:
  8 agents      → .claude/agents/
  27 skills     → .claude/skills/
  hooks         → .claude/hooks/ (one per event + lib/)
  16 templates  → .claude/templates/
  4 workflows   → .claude/workflows/  (/harness-review, /harness-implement-group, /harness-brownfield-map, /harness-eval)
  6 state files → .claude/state/
  1 manifest    → .claude/.claude-plugin/plugin.json

Telemetry stack:
  telemetry_docker_compose.yml    → OTEL Collector (:4317) + Prometheus (:9090) + Pushgateway (:9091)
  telemetry/                      → Collector + Prometheus config
  Start: docker compose -f telemetry_docker_compose.yml up -d

LSP servers (auto-detected from stack):
  {for each lsp.servers entry, run `command -v {binary}` and print ✓ or ✗ — same format as default report}

Large codebase tips:
  - Run `node .claude/scripts/archive-state.js` if state files grow large
  - Use the codebase-explorer agent for read-only discovery before broad changes

Next steps:
  1. Run /lite "<one-paragraph project description>"  ← recommended for this project type
  2. Escalate to /brd → /spec → /design → /auto if scope grows past the /lite eligibility cap
  3. For tiny safe changes later, use /vibe with a micro-contract
```

### Tracker Setup Addendum

If the user selected tracker mode B (publish-only), C (publish + sync), or D (publish + external orchestrator dispatch), insert this block immediately after `Installed:` and before `Next steps:`. It MUST list every prerequisite the user still has to fulfil before `/tracker-publish` will do anything.

```
Tracker orchestration ({mode display name}):
  .claude/tracker-config.json     enabled=true, mode={mode}, provider={provider}
  
  Before /tracker-publish runs, you still need to:
  1. Set {provider}_API_KEY in your shell or .env (never commit it).
  2. Replace project_slug "replace-with-{provider}-project-slug" in tracker-config.json.
  3. Confirm the configured states ({readyState}, {runningState}, ...) exist in your tracker workflow.
  4. (If mode D) prepare an isolated workspace runner — see .claude/skills/tracker/SKILL.md and the symphony_clone README.
```

Substitute placeholders from the user's wizard answers and from the values written into `.claude/tracker-config.json` during Step 4. Use the actual provider name (Linear or Jira) in the prerequisite list. Do NOT print this block when the user selected mode A (Local-only).

Also append one line to Next steps when tracker mode ≠ A:

- After `Run /brd …` (or `Run /lite …` in minimal mode), insert: "Then /tracker-publish to mirror approved groups to {provider}; the orchestrator will not pick anything up until enabled=true and the project_slug is real."

If the user picked mode A, omit both the addendum and the extra Next steps line.

### Framework Skill Pack Addendum

If the user installed any framework skill packs (selected on the confirmation card or wizard), append a section after the `Installed:` block (before `Next steps:`), listing each pack with its skill count and install status. Example:

```
Framework skill packs (.claude/skills/):
  + LangChain / LangGraph / DeepAgents — 9 skills (cwijayasundara/agent_cli_langchain)   [PENDING MANUAL INSTALL]
  + Google ADK                          — 7 skills (google/agents-cli)                    [INSTALLED]
```

Use `INSTALLED` when the prefix directory contains the expected skill count. Use `PENDING MANUAL INSTALL` when the user selected the pack but the expected prefix directories are not present yet.

Also append a "Framework-specific entry points" hint to Next steps, since these packs ship their own scaffolders and workflow skills that complement the harness pipeline. Example additions:

- If LangChain pack selected and installed: "For LangChain/LangGraph/DeepAgents work, ask Claude to 'scaffold a langgraph agent' or 'build an agent using ADK middleware' — the framework's `*-scaffold` and `*-workflow` skills will trigger."
- If LangChain pack selected but pending: "After the manual LangChain pack install, ask Claude to 'scaffold a langgraph agent' or 'build an agent using ADK middleware'."
- If Google ADK pack selected and installed: "For Google ADK work, ask Claude to 'start a new ADK project' or 'deploy my ADK agent' — the `google-agents-cli-*` skills will trigger."
- If Google ADK pack selected but pending: "After the manual Google ADK pack install, ask Claude to 'start a new ADK project' or 'deploy my ADK agent'."

If the user picked None for framework packs, omit both additions.

### Final banner — print LAST when any selected pack is pending

If at least one selected framework pack is `PENDING MANUAL INSTALL`, the very last thing the scaffold prints (after the Files-written section, after Next steps, after everything) MUST be a prominent boxed banner. This banner is the user's primary signal that the scaffold is complete but the optional framework pack still needs a terminal install.

Print exactly this template for each pending pack (concatenate if there are multiple):

```
═══════════════════════════════════════════════════════════════════════════════
  [!] ACTION REQUIRED — Framework pack pending manual install
═══════════════════════════════════════════════════════════════════════════════

  Pack: <pack-display-name> (<repo>)
  Cause: Claude Code auto-mode blocks external npx installs during /scaffold.

  Finish the install in 2 steps:

  1) Open a normal terminal (NOT Claude Code) and run:

       cd <project-root>
       npx --yes skills add <repo> -a claude-code -s '*' -y

  2) Come back to Claude Code and run:

       /install-framework-packs --list

     This verifies the install completed and reports any remaining missing packs.

═══════════════════════════════════════════════════════════════════════════════
```

Banner rules:

- The banner MUST be the absolute last text printed in the scaffold report. Do not append further "Files written" or "Configuration" blocks below it.
- Use real Unicode box characters (`═`). Do not collapse to ASCII dashes.
- One banner per pending pack. If two packs are pending, print two banners back-to-back.
- If all selected packs are already installed, omit the banner entirely and end the report on Next steps.

If no framework packs were configured (the user picked None), neither this banner nor the addendum appears in the report.
