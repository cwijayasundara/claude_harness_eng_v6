# claude_harness_eng_v4

A Claude Code plugin scaffold for autonomous long-running application development.

## What This Is

A GAN-inspired harness combining Karpathy ratcheting + Anthropic/OpenAI harness engineering best practices:
- Generator-Evaluator architecture (no self-evaluation bias)
- Agent teams for parallel story execution
- Session chaining for multi-context-window builds
- Three-layer evaluation (API + Playwright + Vision with weighted scoring)
- Superpowers integration (brainstorming, TDD, debugging, verification at key stages)
- 4 execution modes: Full, Lean, Solo, Turbo

## Installation

1. Clone: `git clone <repo-url> ~/claude_harness_eng_v4`
2. Load as plugin: `claude --plugin-dir ~/claude_harness_eng_v4/.claude`
3. Scaffold a project: `/claude_harness_eng_v4:scaffold`

## Commands

| Command | Purpose |
|---------|---------|
| `/scaffold` | Initialize project with harness |
| `/vibe` | Controlled small-change lane |
| `/brownfield` | Map an existing codebase before broad edits |
| `/brd` | Socratic interview -> BRD |
| `/spec` | BRD -> stories + dependency graph + features.json |
| `/design` | Architecture + schemas + mockups (parallel with `/test`) |
| `/test` | Test plan + cases + fixtures + Playwright E2E |
| `/build` | Full 10-phase pipeline |
| `/auto` | Autonomous ratcheting loop (4 modes) |
| `/implement` | Code generation with agent teams |
| `/evaluate` | Run app, verify sprint contract |
| `/review` | Evaluator + security review |
| `/test` | Test plan + Playwright E2E |
| `/deploy` | Docker Compose + init.sh |
| `/fix-issue` | GitHub issue workflow |
| `/refactor` | Quality-driven refactoring |
| `/improve` | Feature enhancement |
| `/lint-drift` | Entropy scanner for pattern drift |

## Agents (8)

| Agent | Role | Model |
|-------|------|-------|
| planner | BRD, specs, architecture, feature list | Opus |
| generator | Code + tests, spawns agent teams | Sonnet |
| evaluator | Runs app, verifies sprint contracts | Opus |
| design-critic | GAN scoring (4 weighted criteria, max 10 iter) | Opus |
| security-reviewer | OWASP vulnerability scan (enforced gate) | Opus |
| ui-designer | React+Tailwind mockups | Sonnet |
| test-engineer | Test plans + Playwright E2E | Sonnet |
| codebase-explorer | Read-only discovery, dependency tracing | Sonnet |

## Superpowers Integration

The harness integrates with the [Superpowers](https://github.com/obra/superpowers) plugin at these pipeline stages:

| Stage | Skill | Purpose |
|---|---|---|
| `/brd`, `/design` | `brainstorming` | Explore alternatives before committing |
| `/implement`, `/refactor` | `writing-plans` | Structured plans before code |
| `/implement` (teammates) | `test-driven-development` | Red-green-refactor in every agent |
| `/fix-issue`, `/auto` (heal) | `systematic-debugging` | Root cause analysis before fixing |
| `/auto` (done), evaluator | `verification-before-completion` | Evidence before claiming PASS |

## Coding Principles (Karpathy Guidelines)

These behavioral rules apply to all code generation — in agents, skills, and direct responses.

### Controlled Vibe Coding

Use `/vibe` for small, low-risk changes where the full SDLC pipeline would be disproportionate. `/vibe` still requires a micro-contract, narrow scope, targeted verification, and reviewer enforcement. Escalate to `/improve`, `/fix-issue`, `/refactor`, or the full pipeline for new workflows, public API changes, migrations, auth/security/privacy work, ambiguous requirements, or changes likely to touch more than 3 source files.

### Brownfield Discovery

Use `/brownfield` before broad planning, refactoring, or feature work in existing codebases. It creates factual architecture, test, risk, and change-strategy maps under `specs/brownfield/` so agents preserve existing contracts and choose the right lane. `/vibe` may still be used for tiny low-risk fixes, but it must respect any brownfield risk map already present.

### 1. Think Before Coding
- State assumptions explicitly. If uncertain, ask — don't guess.
- When a request is ambiguous, present multiple interpretations and let the user choose.
- Push back on unnecessary complexity. "Do you actually need X, or is Y sufficient?"

### 2. Simplicity First
- Minimum code that solves the stated problem. Nothing speculative.
- No unrequested features, single-use abstractions, premature flexibility, or speculative error handling.
- The bar: would an experienced engineer consider this overcomplicated?
- Avoid fake abstractions: a module should hide useful behavior behind a small interface, not just forward calls.

### 3. Surgical Changes
- Modify only what the request requires. Don't "improve" adjacent code, comments, or formatting.
- Match existing style conventions in the file being edited.
- When your changes orphan imports or variables, remove only what *your* changes made unused — not pre-existing dead code.
- Every altered line must trace directly to the user's request.

### 4. Goal-Driven Execution
- Transform vague goals into verifiable success criteria before writing code.
- "Add validation" → "Write tests for invalid inputs, then make them pass."
- Plan multi-step work with clear checkpoints. Loop toward measurable outcomes.
- Tests verify public behavior through API routes, UI flows, CLIs, or exported module interfaces. Do not couple tests to private helpers or internal call order.

> These guidelines bias toward caution over speed. Success = fewer unnecessary diffs, simpler code on first attempt, clarifying questions before implementation.

## Large Codebase Best Practices

The harness follows [Anthropic's guidance for large codebases](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start):

- **Hierarchical CLAUDE.md** — Root CLAUDE.md for project-wide rules; subdirectory CLAUDE.md files for scoped test/lint commands (generated by `/scaffold` Step 5.B for multi-module projects)
- **File exclusions** — `.gitignore` is the exclusion mechanism (Claude Code respects it by default via `respectGitignore: true`)
- **Read-only exploration** — Use the `codebase-explorer` agent for discovery before editing; separates exploration from modification
- **Session learnings** — Stop hook (`session-learnings.js`) reviews accumulated rules and suggests CLAUDE.md updates
- **State archival** — Run `node .claude/scripts/archive-state.js` to archive oversized state files to `.claude/state/archive/`
- **Codebase map** — `CODEBASE_MAP.md` documents top-level directory structure for navigation
- **LSP integration** — `/scaffold` auto-detects LSP servers from the stack (pyright, typescript-language-server, gopls, etc.), writes them to `project-manifest.json`, and checks availability in `init.sh`
- **MCP servers** — `.mcp.json` template for connecting to internal tools, databases, and documentation
- **Subdirectory commands** — Scope test/lint commands per module to avoid running full suites on minor changes

## Key Files

- `.claude/program.md` — Karpathy human-agent bridge (edit to steer /auto)
- `.claude/settings.json` — Hook config, permissions, enabled plugins
- `.claude/workflows/` — Dynamic workflows (each `.js` → a `/<name>` command; `/scaffold` copies these into target projects). See `.claude/workflows/README.md`
- `design.md` — Full architecture reference (copied to target projects)
- `README.md` — Installation and usage guide
