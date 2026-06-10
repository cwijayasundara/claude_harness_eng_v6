<!-- Project CLAUDE.md template, copied + adapted by /scaffold Step 5. Replace {placeholders} with the chosen stack's values. -->

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
| Testing patterns | `.claude/skills/code-gen/references/test-strategy.md` |
| Brownfield discovery | `specs/brownfield/` and `.claude/skills/brownfield/SKILL.md` |
| Evaluation rubric | `.claude/skills/evaluate/SKILL.md` |
| Sprint contract format | `.claude/skills/evaluate/references/contract-schema.json` |
| Playwright patterns | `.claude/skills/evaluate/references/playwright-patterns.md` |
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
| `/build --lite` | Compressed greenfield lane for small projects (CLI / library / single-script) |
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

`.claude/workflows/*.js` files auto-register as `/<name>` slash commands — deterministic multi-agent orchestration (fan-out → verify → synthesize), shared via git. The harness ships **no** built-in workflows: earlier `/harness-eval`, `/harness-review`, `/harness-brownfield-map`, and `/harness-implement-group` each merely duplicated an existing skill (`/evaluate`, `/review`, `/brownfield`, `/implement`) — the weaker duplicate at that — so they were removed to avoid two confusing lanes for one task. Use the skill forms; author your own workflow when you have a genuinely new fan-out.

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
- Small new projects (CLI tools, single-script utilities, small libraries) should use `/build --lite` instead of `/brd → /spec → /design`; see `.claude/skills/build/references/lite-lane.md`
- Small low-risk fixes may use `/vibe` instead of the full SDLC pipeline; see `.claude/skills/vibe/SKILL.md`
- TDD mandatory: test first, then implement
- 100% meaningful coverage target, 80% floor
- Functions ≤ 30 lines, files ≤ 300 lines (enforced by pre-write-gate)
- Static typing everywhere (zero `any`)
- See `.claude/skills/code-gen/SKILL.md` for full rules

## Git

Branch: `<type>/<description>` (e.g., `feat/user-auth`)
Commits: conventional format (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`)
