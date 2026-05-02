# claude_harness_eng_v4

> GAN-inspired harness for autonomous long-running application development with Claude Code

A Claude Code plugin scaffold that implements best practices from [Anthropic](https://www.anthropic.com/engineering/harness-design-long-running-apps) and [OpenAI](https://openai.com/index/harness-engineering/) harness engineering research. Combines Karpathy's autoresearch ratcheting with a Generator-Evaluator architecture, agent teams, session chaining, and three-layer verification.

## Current Status

Version: `1.1.4`

Canonical repository:

```bash
git clone https://github.com/cwijayasundara/claude_harness_eng_v4.git
```

This repo has been tested as a local Claude Code plugin, a local marketplace plugin, and a scaffolded project install. It now contains both the v4 scaffold and the compatible optional `symphony_clone` tracker orchestrator.

Verified:

- Plugin manifest validates with `claude plugin validate .claude`.
- Scaffold target contains 7 agents, 25 skills, 15 hooks, 10 templates, and 6 seeded state files.
- Scaffold copies `.claude/.claude-plugin/plugin.json`, so the scaffolded `.claude/` is also plugin-valid.
- `.claude/settings.json`, `features.json`, `project-manifest.json`, and generated design schemas parse as JSON.
- Hook JavaScript files pass `node --check`.
- Simple SDLC smoke created BRD-derived stories, dependency graph, valid `features.json`, and minimal design contracts.
- Brownfield smoke produced `codebase-map.md`, `architecture-map.md`, `test-map.md`, `risk-map.md`, and `change-strategy.md`.
- Graph-grounded brownfield support adds `/code-map` and `/seam-finder`, producing deterministic code graphs, coupling reports, and ranked seam candidates for safer existing-code changes.
- Optional tracker mode scaffolds `.claude/tracker-config.json`, `.claude/state/tracker-runs/`, and the `tracker` / `tracker-publish` skill pair.
- `symphony_clone/` is checked in as a separate Docker-capable orchestrator project. It polls Linear, launches Claude Code workspaces, pushes branches, creates GitHub PRs, and posts proof comments.

Known caveat: non-interactive `claude -p` scaffold runs can be interrupted by upstream API retries. The scaffold copy path is validated, but long runs may need a retry or completion from the copied scaffold instructions if the API terminates mid-run.

## Features

- **Generator-Evaluator architecture** — Separate agents prevent self-evaluation bias
- **Karpathy ratcheting** — Monotonic progress; code only gets better, never worse
- **Agent teams** — Parallel story execution with shared task lists and messaging
- **Session chaining** — Builds span hours across multiple context windows
- **Three-layer evaluation** — API tests + Playwright browser interaction + Vision scoring
- **Sprint contracts** — Generator and evaluator negotiate "done" criteria before coding
- **Bounded clarification** — Load-bearing questions only, with a 10-question default and 15-question hard cap
- **Controlled vibe coding** — Small low-risk changes use a micro-contract and targeted verification instead of full SDLC ceremony
- **Graph-grounded brownfield discovery** — Existing repos get factual architecture, test, risk, deterministic code graph, coupling, and seam maps before broad edits
- **Optional tracker orchestration** — Publish approved story groups to Linear/Jira and let a standalone Symphony-style orchestrator launch Claude Code workspaces
- **Deep-module bias** — Prefer small public interfaces with meaningful hidden behavior; avoid pass-through abstractions
- **Public-interface testing** — Tests verify observable behavior, not private helper calls or internal wiring
- **TDD mandatory** — Tests first, 100% meaningful coverage target, 80% hard floor
- **Self-healing** — 10 error categories with targeted fixes before reverting
- **Superpowers integration** — Brainstorming, systematic debugging, TDD, and verification workflows at key pipeline stages
- **4 execution modes** — Full ($100-300), Lean ($30-80), Solo ($5-15), Turbo ($30-50)

## Repository Layout

This repository has two related deliverables:

```text
.claude/          Claude Code plugin/scaffold source
CLAUDE.md         Project-local Claude guide copied by the scaffold
design.md         Architecture reference copied/read by scaffolded projects
README.md         Repository setup and user guide
symphony_clone/   Optional standalone tracker orchestrator
```

The scaffolded target project receives the Claude Harness project contract, not the orchestrator app:

```text
Copied/generated into target repos:
  .claude/
  CLAUDE.md
  design.md
  project-manifest.json
  calibration-profile.json when UI scoring is enabled
  init.sh
  specs/ and state/output directories
  .claude/tracker-config.json only when tracker mode is enabled

Not copied into target repos:
  symphony_clone/
```

`symphony_clone` runs separately. It clones target repos on demand, then invokes Claude Code inside those isolated workspaces.

## Installation

### Option 1: Per-session plugin load

Use this when developing the harness or bootstrapping one fresh project.

```bash
# Clone the harness
git clone https://github.com/cwijayasundara/claude_harness_eng_v4.git ~/claude_harness_eng_v4

# Start Claude Code from your target project with the harness plugin loaded
cd /path/to/fresh-project
claude --plugin-dir ~/claude_harness_eng_v4/.claude
```

Then run:

```text
/claude_harness_eng_v4:scaffold
```

The scaffold command copies the harness into the target repository as project-local Claude Code configuration: `.claude/`, `CLAUDE.md`, `design.md`, `init.sh`, state files, and output directories.

### Option 2: Local marketplace install

Use this when you want the harness available without passing `--plugin-dir` each time.

Create a local marketplace with a copy of this repo's plugin root:

```bash
mkdir -p ~/claude-harness-marketplace/.claude-plugin ~/claude-harness-marketplace/plugins
cp -R ~/claude_harness_eng_v4/.claude ~/claude-harness-marketplace/plugins/claude_harness_eng_v4

cat > ~/claude-harness-marketplace/.claude-plugin/marketplace.json <<'EOF'
{
  "name": "local-harness",
  "owner": {
    "name": "Local"
  },
  "plugins": [
    {
      "name": "claude_harness_eng_v4",
      "source": "./plugins/claude_harness_eng_v4",
      "description": "Claude Harness Engine scaffold"
    }
  ]
}
EOF

claude plugin marketplace add ~/claude-harness-marketplace
claude plugin install claude_harness_eng_v4@local-harness --scope user
```

For team use, install with `--scope project` from the target repo so Claude Code records the plugin in that repo's `.claude/settings.json`.

When iterating on this scaffold locally, refresh the marketplace copy and update the installed plugin before smoke testing:

```bash
rm -rf ~/claude-harness-marketplace/plugins/claude_harness_eng_v4
cp -R ~/claude_harness_eng_v4/.claude ~/claude-harness-marketplace/plugins/claude_harness_eng_v4
claude plugin update claude_harness_eng_v4@local-harness --scope user
```

If `claude plugin list` shows multiple enabled `claude_harness_eng_v4` entries from older experiments, uninstall or disable the stale ones before testing. Claude slash-command resolution uses the plugin name, so duplicate same-named installs can run an older `/claude_harness_eng_v4:scaffold`.

### Option 3: Manual project copy

Use this only if you do not want to install or load the plugin:

```bash
SOURCE=~/claude_harness_eng_v4
cd /path/to/fresh-project

cp -R "$SOURCE/.claude" .
cp "$SOURCE/CLAUDE.md" .
cp "$SOURCE/design.md" .
cp "$SOURCE/README.md" .
```

After manual copy, start Claude Code from the fresh project with `claude`.

## Plugin Structure

The plugin is loaded from the `.claude/` directory. Claude Code auto-discovers components by convention:

```
.claude/
  .claude-plugin/
    plugin.json          ← Manifest (name, version, description only)
  skills/                ← Auto-discovered skill directories
  agents/                ← Auto-discovered agent definitions
  commands/              ← Auto-discovered commands
  hooks/                 ← Hook scripts
  settings.json          ← Project scaffold settings copied into target repos
```

**Important:** `plugin.json` should only contain metadata (`name`, `version`, `description`, `author`). Do NOT add explicit `skills`/`agents`/`commands` path fields — Claude Code discovers these automatically.

**Settings note:** `.claude/settings.json` is intended as the settings file for scaffolded projects. It contains project-scoped permissions, official plugin enablement, and hooks that reference `.claude/hooks/*` after the scaffold has been copied into the target repo.

## Quick Start

```bash
# 1. Navigate to (or create) your project directory
mkdir my-app && cd my-app

# 2. Start Claude Code with the harness plugin loaded
claude --plugin-dir ~/claude_harness_eng_v4/.claude
```

Then run inside Claude Code:

```text
/claude_harness_eng_v4:scaffold
# Choose your stack, project type, and verification mode

/claude_harness_eng_v4:build
# Phases 1-3 (BRD, spec, design) require your approval
# Phases 4-8 run autonomously via /auto
```

> **Note:** When loaded as a plugin, all commands are namespaced: `/claude_harness_eng_v4:<command>`. When working inside a scaffolded project (which has its own `.claude/skills/`), you can use the short form: `/scaffold`, `/build`, etc.

## User Guide

The scaffold supports two normal entry points:

1. Start from a BRD or rough requirements.
2. Start from already-written user stories.

Both paths converge on the same implementation contract:

```text
specs/stories/
  epics.md
  dependency-graph.md
  E1-S1.md
  E1-S2.md
  backlog-needs-breakdown.md   # optional
specs/design/
  component-map.md
  api-contracts.md
  data-models.md
features.json                  # root-level feature tracking
```

### Optional Path C: Publish Story Groups to Linear/Jira

Use this only when tracker orchestration was enabled during `/scaffold`.

After `/spec` and `/design` are approved, publish one tracker issue per dependency group:

```text
/tracker-publish --provider linear
```

The tracker issue represents a group such as `A` or `B`; the external orchestrator schedules groups, while `/auto --group <id>` creates the internal Claude Code agent team for the group's independent stories.

Tracker orchestration is optional. The default harness remains local-only and does not require Linear, Jira, Docker, or the standalone orchestrator.

Tracker mode adds these project-local files:

```text
.claude/tracker-config.json
.claude/state/tracker-map.json        # written by /tracker-publish
.claude/state/tracker-runs/<group>/   # result contract read by the orchestrator
```

The standalone orchestrator expects Claude Code to write:

```text
.claude/state/tracker-runs/<group>/result.json
```

with status `human_review` or `blocked`, proof summaries, test results, reports, branch, and commit metadata.

### Running the Optional Orchestrator

Use `symphony_clone` only after a target repo has been scaffolded and tracker mode has been enabled.

Minimal flow:

```bash
# 1. Scaffold a target repo and run /spec + /design there.
cd /path/to/target-repo
claude --plugin-dir ~/claude_harness_eng_v4/.claude
# then run /claude_harness_eng_v4:scaffold, /spec, /design, /tracker-publish

# 2. Configure the external orchestrator from this repo.
cd ~/claude_harness_eng_v4/symphony_clone
cp .env.example .env
$EDITOR .env

# 3. Run it.
docker compose up --build
```

Key `.env` values:

```text
LINEAR_API_KEY=...
LINEAR_PROJECT_SLUG=...
TARGET_REPO_URL=git@github.com:your-org/your-target-repo.git
READY_LABEL=agent-ready
CREATE_PR=true
STATUS_PORT=0
```

Set `STATUS_PORT=8787` if you want the lightweight dashboard/API. Keep real `.env` files out of Git.

### Path A: Start From a BRD

Use this when you have a product brief, requirements document, or rough idea rather than ready stories.

In your project repo:

```bash
mkdir -p specs/brd
$EDITOR specs/brd/brd.md
```

Then run inside Claude Code:

```text
/brd specs/brd/brd.md
```

Review the BRD output. After you approve it:

```text
/spec specs/brd/brd.md
```

`/spec` decomposes the BRD into epics, ready stories, dependency groups, and root `features.json`. Review the story set carefully. After you approve it:

```text
/design
```

`/design` creates the API contracts, data models, folder structure, mockups, and `specs/design/component-map.md`. After you approve the design:

```text
/auto
```

or target one group:

```text
/auto --group A
```

### Path B: Start From Existing User Stories

Use this when stories already exist in Linear, Jira, GitHub issues, a spreadsheet, or a product doc.

Create one story file per story:

```bash
mkdir -p specs/stories
cp .claude/templates/story.template.md specs/stories/E1-S1.md
```

Edit the file and fill in the metadata:

```markdown
# E1-S1 — User can reset password

## Metadata
- Epic: E1 — Authentication
- Layer: API
- Group: A
- Depends On: []
- Readiness: ready
- Breakdown Reason: null

## User Story
As a registered user, I want to reset my password so that I can regain account access.

## Description
Users who forget their password can request a reset link, receive a single-use token, and set a new password.

## Acceptance Criteria
- POST /api/auth/password-reset accepts a registered email and returns 202.
- The system stores a single-use reset token with a 30 minute expiry.
- POST /api/auth/password-reset/confirm accepts a valid token and new password and returns 204.
- Reusing a token returns 400.
```

Then run inside Claude Code:

```text
/spec specs/stories/E1-S1.md
```

`/spec` normalizes the story set, creates or updates `epics.md`, builds `dependency-graph.md`, and generates root `features.json`. After you approve the normalized stories, continue with:

```text
/design
/auto --group A
```

### How to Set `Readiness`

Set this directly in the story metadata:

```markdown
- Readiness: ready
- Breakdown Reason: null
```

Use `Readiness: ready` only when all of these are true:

- The story has one clear user goal.
- One teammate can implement it without further product decomposition.
- It has 3-6 concrete, testable acceptance criteria.
- It has a known layer: `Types`, `Config`, `Repository`, `Service`, `API`, or `UI`.
- Dependencies are explicit in `Depends On`.
- It can be mapped to owned files in `specs/design/component-map.md`.

Use `Readiness: needs_breakdown` when the story is too broad, vague, or combines multiple workflows:

```markdown
- Readiness: needs_breakdown
- Breakdown Reason: Combines password reset request, email delivery, token validation, and audit logging; split into smaller stories.
```

Stories marked `needs_breakdown` are planning backlog. They must not appear in `dependency-graph.md`, `component-map.md`, or `features.json` until they are split into ready stories.

### How Code Generation Handles Many Stories

Stories are implemented by dependency group, not all at once.

- Group `A`: foundational stories with no dependencies.
- Group `B`: stories that depend only on Group `A`.
- Group `C`: stories that depend on earlier groups.

Run one group manually:

```text
/implement A
```

or let the harness choose the next unfinished group:

```text
/auto
```

If a group contains multiple ready stories, the generator assigns one teammate per story, up to five concurrent teammates. File ownership comes from `specs/design/component-map.md`; every generated file must trace back to a story and acceptance criterion.

### Controlled Vibe Coding for Small Work

Use `/vibe` when the full SDLC pipeline would be too heavy for a small, safe change.

Good `/vibe` candidates:

- Documentation edits
- Test-only changes
- Small UI copy or empty-state fixes
- One-file bug fixes with a clear reproduction
- Lint/tooling corrections
- Minor validation or guard-clause fixes

Do not use `/vibe` for:

- New product workflows
- New public API contracts
- Database migrations
- Auth, permissions, billing, privacy, or security-sensitive behavior
- Changes likely to touch more than 3 source files
- Ambiguous requirements

Run inside Claude Code:

```text
/vibe "fix empty-state copy on invoices page"
```

The controlled vibe lane requires:

1. A class: `CV0` docs/config, `CV1` tests/tooling, or `CV2` small behavior.
2. A micro-contract appended to `.claude/state/vibe-log.md`.
3. Narrow edits only.
4. Targeted verification.
5. Reviewer enforcement through the existing hooks.

If the change grows past the micro-contract, stop and switch to `/improve`, `/fix-issue`, `/refactor`, or the full `/spec` → `/design` → `/auto` path.

### Brownfield Discovery for Existing Codebases

Use `/brownfield` before broad planning, refactoring, or feature work in an existing repo.

Run inside Claude Code:

```text
/brownfield
```

or focus it:

```text
/brownfield "map auth and billing before adding team invites"
```

It writes:

```text
specs/brownfield/
  codebase-map.md           # languages, frameworks, entry points, services
  code-graph.json           # deterministic file/import/symbol graph
  code-graph.meta.json      # producer, language counts, warnings, timestamp
  dependency-graph.md       # Mermaid render of file/module edges
  coupling-report.md        # fan-in, fan-out, cycles, unstable hubs
  architecture-map.md       # modules, layers, data flow; cites graph evidence
  test-map.md               # test commands, coverage signals, gaps
  risk-map.md               # domain risks + structural risks
  change-strategy.md        # recommended lane: /vibe, /improve, /refactor, /spec
  seams-<goal>.md           # ranked cut-points when /seam-finder is run
CONTEXT.md                  # optional domain glossary
```

`/brownfield` invokes `/code-map` internally. You can also run `/code-map` by itself before `/refactor` or `/improve`, and run `/seam-finder "<goal>"` to rank safe cut-points using observable boundary, funnel, read/write asymmetry, and goal-relevance scoring.

Producer chain for `/code-map`:

1. `graphify`, if installed by the user, for higher-fidelity tree-sitter graphs.
2. `hex-graph` MCP, if available.
3. Vendored zero-dependency Node.js scripts for Python, Node, TypeScript, Java, C#, and Go.

Optional graphify install:

```bash
npm install -g @safishamsi/graphify   # or: brew install graphify
graphify install                      # writes ~/.claude/skills/graphify/SKILL.md
```

Use the output to choose the right lane:

- `/vibe` for tiny safe edits
- `/fix-issue` for bugs with reproduction
- `/improve` for existing feature enhancements
- `/refactor` for behavior-preserving structural work
- `/spec` → `/design` → `/auto` for larger product changes

The brownfield rule is simple: map what exists before asking Claude to change it. Do not let agents invent a replacement architecture unless a story/design explicitly approves it.

## How It Works

The `/auto` loop picks the next unfinished group from the dependency graph, negotiates a sprint contract between generator and evaluator, spawns an agent team, and runs a 6-gate ratchet. On PASS it commits and moves on. On FAIL it self-heals up to 3 times, then reverts, extracts a learned rule, and escalates.

Edit `program.md` while `/auto` is running to steer mid-build.

See `design.md` for full architecture reference (system diagram, agent roles, hooks, state files, sprint contract format).

## Commands

| Command | Purpose |
|---------|---------|
| `scaffold` | Initialize project with harness |
| `clarify` | Bounded clarification for load-bearing product/design decisions |
| `vibe` | Controlled small-change lane with micro-contract and targeted verification |
| `brownfield` | Discover architecture, tests, risks, and change strategy for existing repos |
| `code-map` | Build deterministic dependency graph for brownfield/refactor work |
| `seam-finder` | Rank safe cut-points for a concrete goal |
| `brd` | Socratic interview -> BRD |
| `spec` | BRD -> stories + dependency graph + features.json |
| `design` | Architecture + schemas + mockups |
| `build` | Full 8-phase pipeline |
| `auto` | Autonomous ratcheting loop |
| `implement` | Code generation with agent teams |
| `evaluate` | Run app, verify sprint contract |
| `review` | Evaluator + security review |
| `test` | Test plan + Playwright E2E generation |
| `deploy` | Docker Compose + init.sh |
| `fix-issue` | GitHub issue workflow |
| `refactor` | Quality-driven refactoring |
| `improve` | Feature enhancement |
| `lint-drift` | Entropy scanner for pattern drift |
| `tracker` | Optional Linear/Jira orchestration overview |
| `tracker-publish` | Publish approved dependency groups to tracker issues |

> Prefix with `/claude_harness_eng_v4:` when using as a plugin (e.g., `/claude_harness_eng_v4:brd`). Use `/command` shorthand when inside a scaffolded project.

## Superpowers Integration

The harness integrates with the [Superpowers](https://github.com/obra/superpowers) plugin to augment key pipeline stages with structured developer workflows:

| Pipeline Stage | Superpowers Skill | What It Does |
|---|---|---|
| `/brd`, `/design` | `brainstorming` | Explores alternatives and hidden assumptions before committing to a direction |
| `/implement`, `/refactor` | `writing-plans` | Produces structured plans reviewed before code is written |
| `/implement` (teammates) | `test-driven-development` | Red-green-refactor cycle enforced in every agent prompt |
| `/fix-issue` | `systematic-debugging` | Root cause analysis before proposing fixes |
| `/auto` (self-healing) | `systematic-debugging` | Diagnoses failures before each fix attempt |
| `/auto`, `/evaluate` | `verification-before-completion` | Evidence-based checks before claiming PASS |

Superpowers is enabled automatically when scaffolding a project. The harness works without it, but with it agents explore before committing, debug before fixing, and verify before declaring success.

## Plugins

The scaffold configures these eight complementary plugins in `.claude/settings.json`:

| Plugin | Purpose | Conflict? |
|---|---|---|
| `superpowers` | Developer workflow patterns (TDD, debugging, planning) | No |
| `code-review` | PR review with confidence scoring | No |
| `commit-commands` | `/commit`, `/commit-push-pr` git workflows | No |
| `security-guidance` | Real-time XSS/eval/unsafe-code detection | No |
| `pr-review-toolkit` | Specialized PR review agents | No |
| `frontend-design` | Aesthetic-direction skill invoked by `ui-designer` and frontend teammates (scoring still owned by `design-critic`) | No |
| `context7` | Up-to-date library/docs lookup MCP | No |
| `code-simplifier` | `/simplify` skill for in-session cleanup during `/refactor` | No |

Plugins that conflict with harness functionality (`feature-dev`, `hookify`) are explicitly excluded by `/scaffold`.

## Requirements

- Claude Code v2.1.32+ (agent teams support)
- Node.js 18+ (for hooks)
- Docker + Docker Compose (for evaluation)
- Python 3.12+ / Node.js 20+ (for generated projects)

## Based On

- [Anthropic: Harness Design for Long-Running Application Development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [OpenAI: Harness Engineering](https://openai.com/index/harness-engineering/)
- [Steve Krenzel: AI is Forcing Us to Write Good Code](https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code)

## License

MIT
