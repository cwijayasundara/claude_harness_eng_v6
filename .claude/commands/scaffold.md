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
7. "Install agent-framework skill packs?" (multi-select; default: None) — opt-in packs installed project-locally via `npx skills` into `.claude/skills/` (when `-a claude-code` is passed, they land alongside the harness skills).
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
- verification: mode, health_check, and mode-specific config (see below)

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

Before copying, validate the source:

```bash
test -f "$PLUGIN_SOURCE/.claude-plugin/plugin.json"
test -d "$PLUGIN_SOURCE/skills/brownfield"
test -d "$PLUGIN_SOURCE/skills/code-map"
test -d "$PLUGIN_SOURCE/skills/seam-finder"
test -d "$PLUGIN_SOURCE/skills/vibe"
test -f "$PLUGIN_SOURCE/templates/context.template.md"
test -f "$PLUGIN_SOURCE/templates/story.template.md"
SKILL_COUNT=$(find "$PLUGIN_SOURCE/skills" -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ')
TEMPLATE_COUNT=$(find "$PLUGIN_SOURCE/templates" -maxdepth 1 -type f | wc -l | tr -d ' ')
test "$SKILL_COUNT" = "26"
test "$TEMPLATE_COUNT" = "10"
```

If any validation command fails, stop and report: "The resolved plugin source is stale or incomplete; refresh the local marketplace and update the plugin before scaffolding."

Once you have the source path, create `.claude/` in the target project and copy:

```bash
mkdir -p .claude
cp -r $PLUGIN_SOURCE/.claude-plugin/ .claude/.claude-plugin/
cp -r $PLUGIN_SOURCE/agents/ .claude/agents/
cp -r $PLUGIN_SOURCE/skills/ .claude/skills/
cp -r $PLUGIN_SOURCE/hooks/ .claude/hooks/
cp -r $PLUGIN_SOURCE/state/ .claude/state/
cp -r $PLUGIN_SOURCE/templates/ .claude/templates/
cp $PLUGIN_SOURCE/architecture.md .claude/architecture.md
cp $PLUGIN_SOURCE/program.md .claude/program.md
cp $PLUGIN_SOURCE/settings.json .claude/settings.json
```

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
- `security-guidance` — real-time edit-time security patterns (XSS, eval, unsafe HTML) that complement our `detect-secrets` hook
- `pr-review-toolkit` — specialized PR agents for after the harness finishes building
- `frontend-design` — aesthetic-direction skill. Invoked by `ui-designer` during `/design` and by frontend teammates during `/implement` to avoid raw-Tailwind-default UI. The `design-critic` GAN loop still owns scoring and iteration control — `frontend-design` does not replace it.
- `context7` — up-to-date library/docs lookup MCP. Useful when teammates need current API references for third-party libraries.
- `code-simplifier` — in-session `/simplify` skill used during `/refactor` for reuse, quality, and efficiency cleanup.

**Do NOT install** these official plugins (they conflict with harness functionality):
- `feature-dev` — competes with our `/brd` -> `/spec` -> `/design` -> `/implement` pipeline
- `hookify` — dynamically generated hooks could interfere with our purpose-built hooks

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

Then edit `.claude/tracker-config.json` based on the selected mode:

- Publish only: set `enabled: true`, `mode: "publish-only"`.
- Publish + sync: set `enabled: true`, `mode: "sync"`.
- Publish + external orchestrator dispatch: set `enabled: true`, `mode: "orchestrate"`.

Do not write tracker API keys into `.claude/tracker-config.json`. Use environment variables such as `LINEAR_API_KEY`, `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, and `GITHUB_TOKEN`.

### Optional Agent-Framework Skill Packs

If the user selected one or more skill packs (LangChain or Google ADK) at the confirmation card or wizard, install them via the open agent skills CLI (`npx skills`). With `-a claude-code`, the CLI installs the skills directly into `.claude/skills/<pack-prefix>-*/` alongside the harness skills — they're picked up automatically.

**Important:** Run these commands inside the target project directory. Do NOT use `-g`/`--global` — the user has explicitly chosen to scope framework skills per-project so the harness scaffold remains generic.

**CLI syntax (critical):** the **package source goes FIRST** as a positional argument. Putting flags before the package will fail with `ERROR  Missing required argument: source`. Use `-y` only AFTER the package source.

The `Bash(npx --yes skills add:*)` and `Bash(npx skills add:*)` permissions are allowlisted in `.claude/settings.json`. The auto-mode classifier may still block external package installs as a separate safety gate (independent of allowlist) — if that happens, fall through to the manual-fallback block below.

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

Verify the install ran successfully:

```bash
ls .claude/skills/ | grep -E '^(langchain-agents|google-agents-cli)-' | wc -l
```

#### Manual-fallback block (if install was denied or failed)

If the `npx skills add` command was denied (auto-mode classifier), errored, or could not run for any reason, do NOT skip silently. Print this block verbatim and ADD it to the Step 10 report under a "Manual follow-ups" heading:

```text
[!] Framework skill pack(s) were NOT installed automatically. Run this manually
    in a regular terminal (the auto-mode classifier blocks external installs):

  cd <project-root>
  npx --yes skills add cwijayasundara/agent_cli_langchain -a claude-code -s '*' -y   # if LangChain
  npx --yes skills add google/agents-cli -a claude-code -s '*' -y                     # if Google ADK

After running, verify (the packs land in .claude/skills/ alongside the harness skills):
  ls .claude/skills/ | grep -E '^(langchain-agents|google-agents-cli)-'
```

Also explain the most likely cause in one line based on the actual error: auto-mode classifier denial → "the classifier blocks external package installs regardless of settings.json allowlist; run the command in your own terminal"; network error → "check your network / npm proxy and retry"; node not installed → "install Node 20+ and retry".

#### Record selected packs in project-manifest.json

Whether the install succeeded automatically or fell through to the manual block, record the user's *choice* under a top-level `framework_skill_packs` array in `project-manifest.json`. This lets future `/scaffold enhance` operations and the Step 10 report see the intent regardless of install status:

```json
"framework_skill_packs": ["langchain", "google-adk"]
```

Omit the field if the user picked None.

## Step 5: Generate CLAUDE.md

Write CLAUDE.md tailored to chosen stack. This is a slim table of contents (~60 lines) that
directs agents to the right reference files via progressive disclosure. Do not inline full rules
here — agents discover details by reading the referenced skill files.

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
| `/design` | Architecture + schemas + mockups |
| `/build` | Full 8-phase pipeline |
| `/lite` | Compressed greenfield lane for small projects (CLI / library / single-script) |
| `/vibe` | Controlled small-change lane |
| `/brownfield` | Map an existing codebase before changing it |
| `/code-map` | Build deterministic dependency graph for brownfield/refactor work |
| `/seam-finder` | Rank safe cut-points for a concrete goal |
| `/auto` | Autonomous ratcheting loop |
| `/implement` | Code gen with agent teams |
| `/evaluate` | Run app, verify contract |
| `/review` | Evaluator + security review |
| `/test` | Test plan + Playwright E2E |
| `/deploy` | Docker Compose + init.sh |

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

## Step 6: Generate design.md

Architecture reference document (~200-300 lines):
- System architecture ASCII diagram
- Karpathy ratchet loop diagram
- Agent roles table (7 agents)
- Hook execution order (15 hooks)
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

## Hook Execution Order

| # | Hook                  | File                               | Trigger                        |
|---|-----------------------|------------------------------------|--------------------------------|
| 1 | protect-env           | `hooks/protect-env.js`             | Any file write                 |
| 2 | detect-secrets        | `hooks/detect-secrets.js`          | Pre-commit                     |
| 3 | scope-directory       | `hooks/scope-directory.js`         | File access                    |
| 4 | lint-on-save          | `hooks/lint-on-save.js`            | File save (.py, .ts)           |
| 5 | typecheck             | `hooks/typecheck.js`               | File save (.py, .ts)           |
| 6 | check-function-length | `hooks/check-function-length.js`   | File save                      |
| 7 | check-file-length     | `hooks/check-file-length.js`       | File save                      |
| 8 | check-architecture    | `hooks/check-architecture.js`      | File save                      |
| 9 | sprint-contract-gate  | `hooks/sprint-contract-gate.js`    | Pre-build                      |
|10 | pre-commit-gate       | `hooks/pre-commit-gate.js`         | Pre-commit                     |
|11 | task-completed        | `hooks/task-completed.js`          | Post-task                      |
|12 | teammate-idle-check   | `hooks/teammate-idle-check.js`     | Periodic                       |

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

The sprint-contract-gate hook blocks `/build` until `approved: true`.

## Quality Principles

1. **Correctness first** — all tests must pass before a feature is considered done
2. **Type safety** — strict typing enforced by hooks on every save
3. **Layered architecture** — one-way dependency boundaries enforced by check-architecture hook
4. **Test coverage** — coverage gate enforced at ≥ 80%; regressions block merges
5. **Security by default** — secrets detection runs on every commit; env files are protected
6. **Iterative improvement** — Karpathy ratchet ensures quality only moves forward
```

## Step 7: Generate init.sh

Read init-sh.template, replace placeholders based on manifest:
- {{BACKEND_INSTALL}}: e.g. `cd backend && uv sync && cd ..`
- {{FRONTEND_INSTALL}}: e.g. `cd frontend && npm ci && cd ..`
- {{DOCKER_COMPOSE_CMD}}: `docker compose up -d --build`
- {{HEALTH_CHECKS}}: curl commands for each service URL from manifest

Write to `init.sh` and `chmod +x init.sh`.

Placeholder mappings by preset:
- A/B (uv): `{{BACKEND_INSTALL}}` → `cd backend && uv sync && cd ..`
- C (npm): `{{BACKEND_INSTALL}}` → `cd backend && npm ci && cd ..`
- All presets: `{{FRONTEND_INSTALL}}` → `cd frontend && npm ci && cd ..`
- Health checks: use `api_base_url` and `ui_base_url` from manifest evaluation section

## Step 8: Initialize Git

```bash
git init
```

Write `.gitignore`:
```
.env
.env.local
.env.production
node_modules/
__pycache__/
*.pyc
.coverage
htmlcov/
dist/
build/
.venv/
*.egg-info/
.mypy_cache/
.ruff_cache/
playwright-report/
test-results/
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

The skill count is now 26 (lite added). Update the totals printed below if more skills are added in the future.

Tailor the "Next steps" ordering based on the project-type decision:

- If the user picked **D — Minimal** as the project type, lead with `/lite` and demote `/brd`.
- Otherwise, keep `/brd` as the default first action.

**Default report (questions 3 = A / B / C):**
```
✓ Claude Harness Engine v4 scaffolded successfully.

Installed:
  7 agents      → .claude/agents/
  26 skills     → .claude/skills/
  15 hooks      → .claude/hooks/
  10 templates  → .claude/templates/
  6 state files → .claude/state/
  1 manifest    → .claude/.claude-plugin/plugin.json

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
  7 agents      → .claude/agents/
  26 skills     → .claude/skills/
  15 hooks      → .claude/hooks/
  10 templates  → .claude/templates/
  6 state files → .claude/state/
  1 manifest    → .claude/.claude-plugin/plugin.json

Next steps:
  1. Run /lite "<one-paragraph project description>"  ← recommended for this project type
  2. Escalate to /brd → /spec → /design → /auto if scope grows past the /lite eligibility cap
  3. For tiny safe changes later, use /vibe with a micro-contract
```

### Framework Skill Pack Addendum

If the user installed any framework skill packs (selected on the confirmation card or wizard), append a section after the `Installed:` block (before `Next steps:`), listing each pack with its skill count and storage path. Example:

```
Framework skill packs (.claude/skills/):
  + LangChain / LangGraph / DeepAgents — 9 skills (cwijayasundara/agent_cli_langchain)
  + Google ADK                          — 7 skills (google/agents-cli)
```

Also append a "Framework-specific entry points" hint to Next steps, since these packs ship their own scaffolders and workflow skills that complement the harness pipeline. Example additions:

- If LangChain pack installed: "For LangChain/LangGraph/DeepAgents work, ask Claude to 'scaffold a langgraph agent' or 'build an agent using ADK middleware' — the framework's `*-scaffold` and `*-workflow` skills will trigger."
- If Google ADK pack installed: "For Google ADK work, ask Claude to 'start a new ADK project' or 'deploy my ADK agent' — the `google-agents-cli-*` skills will trigger."

If the user picked None for framework packs, omit both additions.
