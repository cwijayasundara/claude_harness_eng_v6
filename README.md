# Claude Harness Engine v5

A Claude Code plugin for building and changing software with a generator/evaluator loop, ratcheting quality gates, and explicit human review before merge.

Current version: `2.0.0`

## Start Here

```bash
git clone https://github.com/cwijayasundara/claude_harness_eng_v5.git ~/claude_harness_eng_v5
cd ~/my-project
claude --plugin-dir ~/claude_harness_eng_v5/.claude
```

Then, inside Claude Code:

```text
/scaffold
```

Run `/scaffold` once per target project. If your Claude Code UI shows a namespaced command, use `/claude_harness_eng_v5:scaffold`.

Every project gets the lean `core` scaffold by default: `/build`, `/auto`, `/gate`, plus the minimal brownfield spine (`/feature`, `/brownfield`, `/code-map`, `/change`, `/refactor`, `/vibe`, tracker publishing). Use `/scaffold --full` only when you explicitly want the optional harness surface.

## Dashboard

### 1. Pick The Scaffold

```
What are you installing into?
├── Normal product repo / app / service / CLI       → /scaffold
├── Existing repo that will keep receiving changes  → /scaffold
├── You want the old brownfield profile name        → /scaffold --brownfield
├── You want optional ops/extras copied too         → /scaffold --full
└── You want telemetry env + dashboard files        → /scaffold --telemetry
```

Default answer: use `/scaffold`. Sprint 2+ is brownfield, so the lean core already includes the existing-code route.

### 2. Pick The Work Route

```
Are you building something NEW?
├── Yes → small scope (CLI, library, ≤5 stories)?  → /build --lite
│         otherwise                                 → /build
│
└── No (existing codebase) → normal route: /feature "<request>"
          first time here? /feature refreshes the DeepWiki/code-map first, then:
          ├── tiny safe edit (≤3 files, <150 lines, no auth/API) → /vibe
          ├── changed behavior (add --issue N for a GitHub bug)  → /change
          ├── structure only, no behavior change                 → /refactor
          └── big enough to need specs                           → /build (brownfield-aware)
```

Not sure? Describe the request plainly. The harness should classify the lane before it edits.

## Command Cards

| Command | Use when | What happens |
|---|---|---|
| `/scaffold` | New target repo setup | Installs the lean core harness, settings, hooks, state seeds, manifest, and project guide |
| `/build --lite "<idea>"` | Small greenfield project | Short interview, compact plan, one group, then `/auto` |
| `/build <prd> --lite --auto` | Small PRD, hands-off | Headless lite: compressed plan (≤5 stories, one group, no interview/gate) -> PR; auto-escalates to the full `--auto` pipeline if the PRD exceeds lite scope |
| `/build <prd>` | Normal greenfield build | BRD -> stories -> design/test plan -> `/auto`, with human gates |
| `/build <prd> --auto` | PRD is ready and you want hands-off | PRD -> PR with no human approval gates; machine gates still block red builds |
| `/feature` | Normal existing-code feature/change. Run as `/feature "<request>"` | Refreshes committed DeepWiki/code-map, creates or publishes story, routes to the right lane, gates, opens PR |
| `/brownfield` | Discovery-only map of an existing repo | Delegates graph/wiki generation to `/code-map`, writes short architecture/test/risk/change strategy, stops before code |
| `/code-map` | Agent needs deterministic repo map only | Produces `code-graph.json`, `symbol-map.md`, and `wiki/WIKI.md` |
| `/vibe` | Very small safe edit | Controlled fast lane for tiny changes |
| `/change` | Behavior change in existing code | Test-first change route; use `--issue N` for a GitHub bug |
| `/refactor` | No behavior change | Behavior-preserving cleanup with coverage and refactor-purity gates |
| `/gate` | Before merge or after manual edits | Evaluator + diff review, with security review only when the diff crosses a security/data/API boundary; renamed from old harness `/review` to avoid native `/review` collision |
| `/status` | See progress | Reads current pipeline state; also available as `npm run status` |

## Approval Modes

| Mode | Command | Human gates |
|---|---|---|
| Gated | `/build <prd>` | Approve BRD, stories, design/test plan |
| Semi-auto | `/build <prd> --autonomous` | One plan approval gate |
| Full-auto | `/build <prd> --auto` | Zero human gates |

Machine gates always stay on: tests, lint/types, coverage, architecture, evaluator, design critic when enabled, adaptive review, and diff review. The generator does not grade itself, and the harness does not merge for you.

For long unattended PRD-to-PR runs, prefer the resilient chain launcher from a scaffolded project:

```bash
node .claude/scripts/build-chain.js docs/prd.md
```

It starts a fresh `claude -p` process per build wave and survives single-session wall-clock limits.

## Existing-Code Flow

For sprint-by-sprint product work on an existing repo, start with `/feature "<request>"`.

`/feature` keeps the committed DeepWiki fresh, creates or publishes the story when a tracker is configured, checks the existing design before planning changes, delegates to `/vibe`, `/change`, `/refactor`, or `/build` by scope, runs tests and gates, and leaves the issue in Human Review with the PR linked.

Use `/brownfield` directly only when you want discovery without implementation. Use `/brownfield --seams "<goal>"` when you need safe cut-points before a risky change. Use `/brownfield --full` only for heavier CI/flag/perf inventory and evaluator scoring.

## Harness vs native Claude Code commands

| Need | Native Claude Code | Harness |
|---|---|---|
| Review a GitHub PR | `/review` | Use native `/review` |
| Run blocking pre-merge quality checks | - | `/gate` |
| Eyeball/run the app | `/run`, `/verify` | `/evaluate` when you need scored verification |
| Mechanical cleanup | `/simplify` | `/refactor` wraps `/simplify` with behavior-preservation gates |
| Generate only CLAUDE.md | `/init` | `/scaffold` for full harness bootstrap |

Rule: native commands own atomic actions; the harness owns orchestration, ratcheting, and writer/grader separation.

## What The Harness Protects

- TDD before production edits
- Coverage ratchet and per-diff coverage checks
- Lint/type/layer gates
- Security review before PR when the diff touches security/data/API boundaries
- Fresh-context diff review
- Brownfield discipline: architecture claims cite `code-graph.json`
- Human review before merge

## Optional Power-Ups

| Power-up | How to enable | Details |
|---|---|---|
| Telemetry dashboards | `/scaffold --telemetry` | [docs/telemetry.md](docs/telemetry.md) |
| Framework skill packs | Select during scaffold, then install manually | [docs/extras.md](docs/extras.md) |
| Tracker orchestration | Configure Linear/Jira/Azure DevOps | [docs/extras.md](docs/extras.md) |
| Unattended backlog-to-merge | Run `symphony_clone/` separately | `symphony_clone/README.md` |
| Artifact-only docs/mockups/research | Use `harness-lite` | `harness-lite/README.md` |

## Testing This Harness

```bash
npm test                 # fast unit/contract suite, no live Claude
npm run test:e2e:fast    # e2e contracts + safe helper tests
npm run test:routes      # scaffold + lite-auto + full-auto + gated + feature routes (live Claude)
npm run test:e2e:live    # all live route/smoke checks (live Claude, costs tokens)
npm run test:e2e:cert    # certification stack
npm run test:e2e:all     # fast -> live -> cert
```

E2E logs land in `test/e2e/results/logs/`; summary JSON lands at `test/e2e/results/e2e-pack-summary.json`. Details: [docs/testing.md](docs/testing.md).

## Deep Links

| Topic | Where |
|---|---|
| PRD format | [docs/prd-format.md](docs/prd-format.md) |
| Model/cost posture | [docs/model-allocation.md](docs/model-allocation.md) |
| Behavior preservation | [docs/behavior-preservation.md](docs/behavior-preservation.md) |
| Native command boundaries | [docs/native-command-integration.md](docs/native-command-integration.md) |
| Prompt standards | [docs/prompting-standards.md](docs/prompting-standards.md) |
| Harness architecture | [design.md](design.md) |
| Full skill instructions | `.claude/skills/<name>/SKILL.md` |
