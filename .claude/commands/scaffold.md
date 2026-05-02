---
name: scaffold
description: Initialize a new project with the Claude Harness Engine v4 scaffold.
---

# /scaffold — Project Initialization

When the user runs this command, follow these steps exactly:

## Step 1: Gather Project Info

Ask the user these questions (one at a time):
1. "What are you building?" (brief description for CLAUDE.md)
2. "What's your tech stack?" with presets:
   - A) Python (FastAPI) + React (Vite) + PostgreSQL
   - B) Python (FastAPI) + Next.js + PostgreSQL
   - C) Node (Express) + React (Vite) + PostgreSQL
   - D) Custom (I'll specify)
3. "What type of project is this?" (for design calibration):
   - A) Consumer-facing app (high design bar)
   - B) Internal tool / dashboard (functional focus)
   - C) API-only / backend service (no UI scoring)
4. "How will the evaluator reach the running app?" (verification mode):
   - A) Docker Compose (default — app runs in containers)
   - B) Local dev servers (app runs via npm/uvicorn/etc.)
   - C) Stub / mock server (no runnable backend — serverless or external-only)
5. "Install complementary official Claude Code plugins?" (recommended: Yes)
   - `superpowers` — Structured developer workflows used by the harness pipeline
   - `code-review` — Automated PR review with confidence scoring
   - `commit-commands` — `/commit`, `/commit-push-pr` git workflows
   - `security-guidance` — Real-time security pattern checking on edits
   - `pr-review-toolkit` — Specialized PR review agents (comments, tests, errors, types)
   - `frontend-design` — Aesthetic direction skill (used by `ui-designer` + frontend teammates; does NOT replace `design-critic`)
   - `context7` — Up-to-date library/docs lookup MCP
   - `code-simplifier` — `/simplify` skill for in-session cleanup during `/refactor`
   - A) Yes, install all eight (recommended)
   - B) Let me pick which ones
   - C) No, skip official plugins
6. "Install graphify for higher-fidelity brownfield code graphs? (optional)" — only meaningful for existing codebases
   - `graphify` is a community user-scope skill that produces tree-sitter code graphs for more languages and richer call/inheritance edges.
   - When installed, `/code-map` detects it and prefers it over the vendored zero-dependency scripts.
   - Without it, v4 still works: vendored scripts produce file, import, symbol, coupling, and Python call-graph artifacts.
   - It is not a marketplace plugin and must not be added to `enabledPlugins`.
   - A) Yes, print the install command
   - B) No, use vendored scripts
7. "Enable optional external tracker orchestration?" (default: No)
   - A) No, keep this project local-only
   - B) Publish generated story groups to Linear/Jira only
   - C) Publish + sync proof/status
   - D) Publish + external orchestrator dispatch

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

### Verification Config (based on question 4)

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

### Generate calibration-profile.json (based on question 3)

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
test "$SKILL_COUNT" = "25"
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

### Add Official Plugins to settings.json (based on question 5)

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

### Graphify (question 6) — user-scope skill, not a marketplace plugin

If the user answered A) to question 6, do not modify `enabledPlugins`. Instead, append this exact installation reminder to the Step 10 report:

```text
Optional graphify install (higher-fidelity brownfield code graphs):
  npm install -g @safishamsi/graphify   # or: brew install graphify
  graphify install                      # writes ~/.claude/skills/graphify/SKILL.md

When installed, /code-map detects it automatically and prefers it over
the vendored Node.js scripts.
```

If the user answered B) to question 6, do not print the install reminder.

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

Print:
```
✓ Claude Harness Engine v4 scaffolded successfully.

Installed:
  7 agents      → .claude/agents/
  25 skills     → .claude/skills/
  15 hooks      → .claude/hooks/
  10 templates  → .claude/templates/
  6 state files → .claude/state/
  1 manifest    → .claude/.claude-plugin/plugin.json

Next steps:
  1. Run /brd to create your Business Requirements Document
  2. For an existing codebase, run /brownfield first
  3. Or run /build to execute the full pipeline
  4. For tiny safe changes, use /vibe with a micro-contract
```
