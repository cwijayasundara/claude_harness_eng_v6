# Claude Harness Engine v4

A Claude Code scaffold + runtime for **autonomous, long-running application development**. One scaffold, optional framework injection, two execution surfaces (a local Claude Code workspace or a Linear/Jira-driven agent factory).

Current version: `1.1.5`.

---

## TL;DR

```
┌──────────────────────────────────────────────────────────────────────────┐
│  1. Install the harness as a Claude Code plugin                          │
│  2. Run /scaffold inside any project — answer 8 questions                │
│  3. Optionally inject framework skill packs (LangChain · Google ADK)     │
│  4. Plan with /brd → /spec → /design  (or /lite for small projects,      │
│     /brownfield for existing code)                                       │
│  5. Run /auto in one of two modes:                                       │
│        a. Local      — humans drive Claude Code directly                 │
│        b. Factory    — Linear/Jira queues groups, symphony_clone         │
│                        spins up isolated Claude Code workspaces          │
└──────────────────────────────────────────────────────────────────────────┘
```

The same scaffold produces the same artifacts in both modes — only **who picks the next group** and **where the proof lands** changes.

---

## Why this exists

Autonomous code generation fails in three predictable ways: agents grade their own work, quality silently regresses across iterations, and complex projects exhaust the context window. v4 addresses each one structurally:

- **GAN separation** — generator writes code, evaluator runs the app. Neither can do the other's job. No self-grading.
- **Karpathy ratchet** — every metric (tests, lint, coverage, architecture, eval verdict, design score) only moves forward.
- **Session chaining** — append-only state (`program.md`, `learned-rules.md`, `claude-progress.txt`, `features.json`) carries continuity across context windows for ~700–1000 tokens per recovery.

---

## What's in the box

| Component | Count | Notes |
|---|---:|---|
| Slash commands (true) | 1 | Just `/scaffold`. Everything else is a skill. |
| Skills (virtual commands) | 26 | Greenfield, brownfield, lite, vibe, improvement, tracker |
| Specialized agents | 7 | planner, generator, evaluator, design-critic, ui-designer, test-engineer, security-reviewer |
| Lifecycle hooks | 15 | Pre/post tool, pre-commit, Stop, TeammateIdle |
| Templates | 10 | Sprint contract, story, init.sh, tracker config, etc. |
| Official Claude Code plugins (default-on) | 8 | superpowers, code-review, commit-commands, security-guidance, pr-review-toolkit, frontend-design, context7, code-simplifier |
| Framework skill packs (opt-in) | 2 | LangChain/LangGraph/DeepAgents (9 skills); Google ADK (7 skills) |
| Tracker orchestrator (opt-in) | 1 | `symphony_clone/` — Docker service that drives Linear/Jira |

---

## Installation

```bash
git clone https://github.com/cwijayasundara/claude_harness_eng_v4.git ~/claude_harness_eng_v4
```

Load it as a Claude Code plugin from any project directory:

```bash
claude --plugin-dir ~/claude_harness_eng_v4/.claude
```

Then inside Claude Code, run the bootloader:

```
/scaffold
```

`/scaffold` asks 8 questions, generates `project-manifest.json` + `calibration-profile.json`, copies the whole `.claude/` tree, writes `CLAUDE.md`, `design.md`, `init.sh`, `features.json`, and `claude-progress.txt`, and initializes git. After it finishes, every other workflow is reachable as a skill (virtual slash command).

---

## The 8 scaffold questions

1. **What are you building?** — used for `CLAUDE.md`.
2. **Tech stack** — Python/FastAPI + React/Vite, Python/FastAPI + Next.js, Node/Express + React/Vite, or custom.
3. **Project type** — consumer-facing (high design bar), internal tool (functional focus), API-only (no UI scoring), or **minimal** (CLI/library/single-script — recommends `/lite`).
4. **Verification mode** — Docker Compose, local dev servers, or stub/mock server.
5. **Official Claude Code plugins** — install all 8, pick a subset, or skip.
6. **Graphify** — install the higher-fidelity tree-sitter code graph tool? (Falls back to zero-dependency vendored scripts.)
7. **Tracker orchestration** — no / publish-only / publish + sync / publish + external dispatch.
8. **Framework skill packs** — none, LangChain/LangGraph/DeepAgents, Google ADK, or both.

Questions 5–8 are the **injection points**: they decide which optional capability sets travel into the project.

---

## End-to-end design

```
┌───────────────────────────────────────────────────────────────────────────┐
│  0. AUTHORING                                                             │
│  /scaffold writes the work contract:                                      │
│    .claude/{agents,skills,hooks,templates,state}                          │
│    specs/{brd,stories,design,brownfield,reviews}                          │
│    features.json · claude-progress.txt · CLAUDE.md · design.md            │
│  Optional injections at scaffold time:                                    │
│    • Official plugins (Q5)                                                │
│    • Graphify for richer brownfield graphs (Q6)                           │
│    • Tracker config for Linear/Jira (Q7)                                  │
│    • Framework skill packs in .agents/skills/ (Q8)                        │
└───────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  1. PLANNING (lane-selected)                                              │
│    Greenfield large : /brd  →  /spec  →  /design        (3 human gates)   │
│    Greenfield small : /lite (one approval, ≤5 stories, single group)      │
│    Brownfield       : /brownfield → /code-map → /seam-finder              │
│    Tiny safe edits  : /vibe (micro-contract)                              │
│                                                                            │
│  Output:                                                                  │
│    dependency-graph.md · component-map.md · features.json                 │
└───────────────────────────────────────────────────────────────────────────┘
                                  │
              ┌───────────────────┴───────────────────┐
              ▼                                       ▼
┌─────────────────────────────────┐  ┌─────────────────────────────────────┐
│  2a. LOCAL RUNTIME              │  │  2b. AGENT-FACTORY RUNTIME           │
│                                 │  │                                      │
│  Engineer runs /auto in         │  │  /tracker-publish writes one Linear/ │
│  Claude Code. Each iteration:   │  │  Jira issue per dependency group.    │
│                                 │  │                                      │
│  generator → evaluator →        │  │  symphony_clone (Docker) polls,      │
│  design-critic → security →     │  │  claims a ready group, clones the    │
│  test-engineer                  │  │  repo, runs `claude --print …`       │
│                                 │  │  inside, opens a PR, comments back,  │
│  Diffs reviewed in chat / git.  │  │  moves the issue to Human Review.    │
└─────────────────────────────────┘  └─────────────────────────────────────┘
              │                                       │
              └───────────────────┬───────────────────┘
                                  ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  3. EXECUTION (identical in both runtimes)                                │
│  /auto loops the Karpathy ratchet per group:                              │
│    1. Recover state (program.md · learned-rules.md · features.json)       │
│    2. Negotiate sprint contract (generator → evaluator, exactly 2 calls)  │
│    3. Spawn agent team (phased DAG, ≤5 parallel teammates)                │
│    4. Run 6 ratchet gates                                                 │
│    5. Self-heal failed gates (max 3 attempts, different strategy each)    │
│    6. Update state, commit, emit proof                                    │
└───────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  4. DELIVERY                                                              │
│  Local mode    : commits on main / feature branch                         │
│  Factory mode  : agent/<issue-key> branch + GitHub PR + Linear proof      │
│                                                                            │
│  Humans always own merge and Done.                                        │
└───────────────────────────────────────────────────────────────────────────┘
```

The 6 ratchet gates: unit tests → lint+types → coverage ≥ baseline → architecture alignment → evaluator verdict (API + Playwright) → design-critic score. Modes Full/Lean/Solo/Turbo decide how many gates fire and how often.

---

## Local runtime — the default

```bash
cd ~/my-new-app
claude --plugin-dir ~/claude_harness_eng_v4/.claude
```

```
/scaffold                    # one time
/brd                         # OR /lite for small projects, /brownfield for existing code
/spec                        # human gate
/design                      # human gate
/auto                        # autonomous ratchet loop
```

Proof lands on disk: `iteration-log.md`, `features.json`, `specs/reviews/`, plus the commits themselves. The engineer reviews diffs and merges as usual.

This is the **right default** for solo engineers, small pods, and prototypes.

---

## Agent-factory runtime — Linear or Jira

Use this when you want a visible queue, parallel execution across machines, and a tracker-based human-review surface.

### Step 1. Publish (one time, inside Claude Code)

```
/tracker-publish
```

The skill reads the approved `specs/stories/dependency-graph.md` + `specs/design/component-map.md` and creates **one Linear/Jira issue per dependency group**. Group dependencies become tracker blocker links. The mapping is written to `.claude/state/tracker-map.json`.

Each group issue carries: harness command (`/auto --group <id>`), story list, acceptance criteria, feature IDs, and expected proof.

### Step 2. Spin up `symphony_clone`

```bash
cd ~/claude_harness_eng_v4/symphony_clone
cp .env.example .env
$EDITOR .env                 # LINEAR_API_KEY, TARGET_REPO_URL, workflow states, …
docker compose up --build
```

The orchestrator (Docker container, polling Linear via GraphQL) does this every tick:

1. Lists candidate issues for the configured project + ready state.
2. Filters to issues with the `agent-ready` label and all blockers terminal.
3. Claims one (`MAX_CONCURRENT_RUNS=1` by default), moves it to `In Progress`.
4. Clones the target repo to `/workspaces/<issue-key>`, creates `agent/<issue-key>`.
5. Runs `claude --print --permission-mode bypassPermissions "<generated prompt>"`. The prompt tells Claude Code to follow `.claude/skills/auto/SKILL.md` and run the group.
6. Reads `.claude/state/tracker-runs/<group>/result.json`.
7. Pushes the branch, opens a GitHub PR via `gh`, comments proof back to Linear, moves the issue to `Human Review` (or `Blocked` on failure).

### Step 3. Human review

Reviewers see the proof comment + PR in Linear. Merging happens in GitHub. **The orchestrator never marks anything `Done`.** That decision stays human.

### What's deliberately bounded

- **Polling only** today — no webhook receiver (`POLL_INTERVAL_MS` default 60s).
- **One tracker issue per dependency group**, not per story. The harness already creates story-level agent teams inside `/auto`.
- **Linear is implemented first.** Jira is a stub.
- **Retry with exponential backoff** before moving an issue to `Blocked` (`MAX_RETRY_ATTEMPTS`, `RETRY_BASE_DELAY_MS`, `RETRY_MAX_DELAY_MS`).
- **State alias mapping** — different Linear workspaces use different state names. `REVIEW_STATE_CANDIDATES` and `BLOCKED_STATE_CANDIDATES` let the orchestrator match whatever your workflow calls them.

`symphony_clone/` is **versioned alongside the harness but never copied into target projects by `/scaffold`**. It's infrastructure, not application code.

---

## Optional framework skill packs

`/scaffold` question 8 asks whether to inject framework-specific skill packs. They land in `.agents/skills/` (next to `.claude/skills/`) and are triggered automatically by framework-specific phrasing.

| Pack | Skills | Trigger examples |
|---|---:|---|
| `cwijayasundara/agent_cli_langchain` | 9 | "scaffold a langgraph agent", "add LangSmith evals", "deploy a deepagents app" |
| `google/agents-cli` | 7 | "start a new ADK project", "deploy my ADK agent", "publish to Gemini Enterprise" |

These don't replace the harness — the same `/auto` ratchet still runs. They give framework-aware code generation on top of harness-grade discipline.

Install command (executed by `/scaffold`):

```bash
npx --yes skills add -y --agent claude-code <github-org/repo>
```

The selected packs are recorded in `project-manifest.json#framework_skill_packs` for future enhance/upgrade flows.

---

## Lane selection

| Lane | Use when | Cost | Outputs |
|---|---|---|---|
| `/brownfield` + `/code-map` + `/seam-finder` | Any substantial work in an existing codebase | Cheap | `code-graph.json`, architecture/risk/change maps, ranked seams |
| `/lite` | New project, ≤5 stories, single group, no DB/auth/billing | Small | BRD-lite, 3–5 ready stories in Group A, minimal design |
| `/vibe` | Tiny safe edits (≤3 files, <150 lines, no new workflow) | Tiny | Micro-contract + narrow diff + targeted verify |
| `/brd → /spec → /design → /auto` | Everything else | Highest | Full SDLC pipeline |

Each lane has an explicit escalation contract — if work outgrows the lane, stop and re-enter via the larger one. Lanes never silently grow.

---

## Commands

| Command | Purpose |
|---------|---------|
| `/scaffold` | Bootstrap a project (only true slash command) |
| `/brd` | Socratic interview → BRD |
| `/spec` | BRD → stories + dependency graph + features.json |
| `/design` | Architecture + schemas + mockups |
| `/build` | Full 8-phase pipeline |
| `/auto` | Autonomous ratcheting loop (Full/Lean/Solo/Turbo) |
| `/lite` | Compressed greenfield lane for small projects |
| `/vibe` | Controlled small-change lane |
| `/brownfield` | Map an existing codebase before changing it |
| `/code-map` | Build deterministic dependency graph |
| `/seam-finder` | Rank safe cut-points for a goal |
| `/implement` | Code gen with agent teams |
| `/evaluate` | Run app, verify contract |
| `/review` | Evaluator + security review |
| `/test` | Test plan + Playwright E2E |
| `/deploy` | Docker Compose + init.sh |
| `/fix-issue` | GitHub issue workflow |
| `/refactor` | Quality-driven refactoring |
| `/improve` | Feature enhancement |
| `/lint-drift` | Entropy scanner for pattern drift |
| `/tracker` | Tracker orchestration overview |
| `/tracker-publish` | Publish approved dependency groups to Linear/Jira |

---

## Key files in any scaffolded project

| File | Purpose |
|------|---------|
| `.claude/program.md` | Karpathy human-agent bridge. Edit mid-run to steer `/auto`. |
| `.claude/architecture.md` | Layered architecture rules (Types → … → UI) |
| `.claude/settings.json` | Hook config, permissions, enabled plugins |
| `.claude/state/learned-rules.md` | Monotonic rule store (never deleted) |
| `.claude/state/failures.md` | Raw failure data for pattern extraction |
| `.claude/state/pending-reviews.jsonl` | Files needing reviewer agents this turn |
| `.claude/state/tracker-map.json` | Local group/story → Linear/Jira mapping (tracker mode) |
| `.claude/state/tracker-runs/<group>/result.json` | Proof contract consumed by symphony_clone |
| `project-manifest.json` | Stack, evaluation config, execution mode, framework packs |
| `calibration-profile.json` | Design scoring weights/thresholds (skipped for API-only & minimal projects) |
| `features.json` | Granular pass/fail registry |
| `claude-progress.txt` | Session chaining recovery context |
| `specs/stories/dependency-graph.md` | Group ordering and dependencies — the source of truth for `/auto` |
| `specs/design/component-map.md` | File ownership per story (used by agent teams) |
| `specs/reviews/` | Evaluator + security review reports per group |
| `design.md` | Architecture reference (this repo's `design.md`, copied into the project) |
| `CLAUDE.md` | Slim table of contents for agents |

---

## Coding principles enforced

1. **TDD mandatory** — failing tests first.
2. **100% meaningful coverage**, 80% hard floor.
3. **Functions < 50 lines, files < 300 lines.**
4. **Static typing everywhere** (no `any`).
5. **Strict layered architecture** — one-way dependencies (Types → … → UI).
6. **No silent fallbacks** — typed errors; callers decide.
7. **Surgical changes** — only what the request requires.
8. **Brownfield discipline** — claims about dependencies must cite `code-graph.json` evidence.

The 15 hooks enforce these in real time. The 6 ratchet gates enforce them at commit time. Together they form a defense in depth that an autonomous loop can't drift out of.

---

## Documentation

- `design.md` — full architecture reference (this scaffold's design doc).
- `symphony_clone/README.md` — operator guide for the tracker orchestrator.
- `.claude/skills/<name>/SKILL.md` — every skill is self-documenting.
- `.claude/agents/<name>.md` — every agent's frontmatter declares its tools and model tier.
- `Claude_Harness_Engine_Design.pptx` — slide deck for stakeholder briefings.

---

## License & contributing

This is research code shared under the same license as Claude Code's plugin ecosystem. Contributions that respect the GAN separation, the ratchet, and the human-gate boundaries are very welcome.
