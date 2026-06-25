# {{PROJECT_NAME}} — Claude Harness Dashboard

This project was scaffolded with **Claude Harness Engine v5**.

| | |
|---|---|
| **Stack** | {{STACK_SUMMARY}} |
| **Shape** | {{PROJECT_TYPE_LABEL}} |
| **Posture** | {{POSTURE}} |

## Pick The Work Route

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

Recommended first command for this project:

```text
{{RECOMMENDED_START}}
```

## Command Cards

| Command | Use when | What happens |
|---|---|---|
| `/build --lite "<idea>"` | Small greenfield project | Short interview, compact plan, one group, then `/auto` |
| `/build <prd>` | Normal greenfield build | BRD -> stories -> design/test plan -> `/auto`, with human gates |
| `/build <prd> --auto` | PRD is ready and you want hands-off | PRD -> PR with no human approval gates; machine gates still block red builds |
| `/feature` | Normal existing-code feature/change. Run as `/feature "<request>"` | Refreshes committed DeepWiki/code-map, creates or publishes story, routes to the right lane, gates, opens PR |
| `/brownfield` | Discovery-only map of an existing repo | Delegates graph/wiki generation to `/code-map`, writes short architecture/test/risk/change strategy, stops before code |
| `/code-map` | Agent needs deterministic repo map only | Produces `code-graph.json`, `symbol-map.md`, and `wiki/WIKI.md` |
| `/vibe` | Very small safe edit | Controlled fast lane for tiny changes |
| `/change` | Behavior change in existing code | Test-first change route; use `--issue N` for a GitHub bug |
| `/refactor` | No behavior change | Behavior-preserving cleanup with coverage and refactor-purity gates |
| `/gate` | Before merge or after manual edits | Evaluator + security review |
| `/status` | See progress | Reads current pipeline state; also available as `npm run status` |

## Approval Modes

| Mode | Command | Human gates |
|---|---|---|
| Gated | `/build <prd>` | Approve BRD, stories, design/test plan |
| Semi-auto | `/build <prd> --autonomous` | One plan approval gate |
| Full-auto | `/build <prd> --auto` | Zero human gates |

Machine gates always stay on: tests, lint/types, coverage, architecture, evaluator, security, and diff review. The generator does not grade itself, and the harness does not merge for you.

## Existing-Code Flow

For sprint-by-sprint product work on an existing repo, start with `/feature "<request>"`.

Use `/brownfield` directly only when you want discovery without implementation. Use `/brownfield --seams "<goal>"` when you need safe cut-points before a risky change. Use `/brownfield --full` only for heavier CI/flag/perf inventory and evaluator scoring.

## Key Files

| Path | What it is |
|---|---|
| `project-manifest.json` | Stack, cost posture, verification mode, LSP servers |
| `.claude/program.md` | Steer an in-flight `/auto` run by editing this |
| `.claude/settings.json` | Hooks, permissions, env for interactive runs |
| `.claude/settings.auto.json` | Headless `--auto` profile; use only in an isolated runner |
| `specs/` | BRD, stories, design, test plan, reviews, brownfield maps |
| `claude-progress.txt` | Current pipeline state |

## Optional Power-Ups

| Power-up | How |
|---|---|
| Telemetry dashboards | Scaffold with `--telemetry`, then see `docs/telemetry.md` |
| Framework skill packs | Select during scaffold, then install manually; see `docs/extras.md` |
| Tracker orchestration | Configure Linear/Jira/Azure DevOps; see `docs/extras.md` |
| Cost/model posture | Edit `project-manifest.json`, then run `node .claude/scripts/model-tier.js <tier> --apply .claude/agents` |

## Troubleshooting

- **A run stalls** — run `/status`; auto-continue fails open with a `STUCK` warning instead of looping forever.
- **Headless `--auto` needs isolation** — `settings.auto.json` allows broad `Bash`; run it in a container/VM with no host secrets mounted.
- **Telemetry is empty** — telemetry is opt-in; enable it with `/scaffold --telemetry` or follow `docs/telemetry.md`.
