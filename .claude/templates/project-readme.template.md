# {{PROJECT_NAME}} — Building with the Claude Harness

This project was scaffolded with the **Claude Harness Engine v5** — a generator-evaluator
("GAN") build pipeline with Karpathy ratcheting: the agent that writes code never grades its
own work, and quality gates only ever tighten. This guide is your project-specific manual for
driving it. (For the harness internals, see `.claude/skills/*/SKILL.md` and `docs/`.)

## Your project

| | |
|---|---|
| **Name** | {{PROJECT_NAME}} |
| **Stack** | {{STACK_SUMMARY}} |
| **Shape** | {{PROJECT_TYPE_LABEL}} |
| **Cost posture** | {{POSTURE}} |

The posture above was chosen from your project shape and lives in `project-manifest.json`
(`execution.model_tier`, `execution.ceremony`, `verification.mode`). Change it there any time —
see *Cost posture & model tiers* below.

## The four ideas

1. **One decision:** are you building something new, or changing existing code? Pick a lane below.
2. **The ratchet blocks regressions** — tests, coverage, lint/types, and security gates only ever tighten.
3. **A separate evaluator verifies** — the agent that writes code never grades its own work.
4. **You merge** — the harness produces commits and proof in `specs/reviews/`; it never merges on its own.

## Start here

The recommended first command for a **{{PROJECT_TYPE_LABEL}}** project:

```
{{RECOMMENDED_START}}
```

Prefer a quick, low-ceremony change to existing code? Use `/vibe "<small change>"` (≤3 files, no
auth/API). Working in an existing codebase? Run `/brownfield` first to map it before planning.

## Build lanes — how much human approval?

`/build` runs the full pipeline (BRD → stories → design → tests → the `/auto` ratchet loop → PR).
How many times it stops for you depends on the flag:

| Lane | Command | Human gates |
|---|---|---|
| Gated (default) | `/build <prd>` | Approve BRD, stories, design+tests — then it builds to a PR |
| Semi-auto | `/build <prd> --autonomous` | One plan-approval gate, then runs to an open PR |
| Full-auto | `/build <prd> --auto` | None — PRD straight to PR |

In **every** lane the machine gates still run (ratchet, security, pre-PR verify) and no PR opens
over a red build. `--auto` and `--autonomous` need a **PRD file** (`docs/prd-format.md`) — they
cannot run the interview headless.

## Build lanes — how big is the project?

| Scope | Command | What it does |
|---|---|---|
| Full | `/build <prd>` | The full 11-phase pipeline |
| Lite (interactive) | `/build --lite "<one-line desc>"` | Compressed lane for a small project: single runtime, one module, no DB/auth, ≤5 stories |
| Lite + headless | `/build --lite --auto <prd>` | The compressed lane, hands-off to a PR. Auto-escalates to the full `--auto` pipeline if the PRD outgrows the lite caps |

Flag order does not matter — `--lite --auto` and `--auto --lite` are the same command. `--lite`
composes with `--autonomous` too. The lite lane only compresses *planning ceremony*; the ratchet,
evaluator, security, and pre-PR verify run unchanged.

`--mode full|lean` is orthogonal: both run every gate; `lean` only skips the design-critic vision
loop (irrelevant for a no-UI project). Add `--pod N` for one PR per independent story cluster.

## Cost posture & model tiers

One field — `execution.model_tier` in `project-manifest.json` — sets the cost/quality posture by
stamping each agent's model pin (run `node .claude/scripts/model-tier.js <tier> --apply .claude/agents`
after editing):

| Tier | Generation | Judgment (evaluator + reviewers + planner) |
|---|---|---|
| `cost` | Sonnet 4.6 | Opus 4.8 |
| `balanced` | Opus 4.7 | Opus 4.8 |
| `max-quality` | Opus 4.8 | Opus 4.8 |

Your project defaults to **{{MODEL_TIER}}**. Lite-shaped projects (CLI / library / single-script)
default to `cost` + `trimmed` ceremony + `local` verification; full-stack projects keep
`balanced` / `full` / `docker`. Full rationale: `docs/model-allocation.md`.

## Telemetry & dashboards (on by default)

This project ships with telemetry **enabled** — the env vars are already in `.claude/settings.json`
and `.claude/settings.auto.json`, so Claude Code exports metrics and the `record-run` hook pushes
harness metrics from the first run. Until you start the stack the push simply no-ops (2s timeout,
no errors). To **see** the dashboards:

```bash
docker compose -f telemetry_docker_compose.yml up -d
# OTEL collector :4317 · Prometheus :9090 · Pushgateway :9091 · Grafana :3001 (admin/harness)
```

Then restart the Claude session so it picks up the env. Set `HARNESS_USER` in `settings.json` to
label your metrics (otherwise the hook derives it from git / the OS user). Full setup, the metric
catalog, and PromQL queries: `docs/telemetry.md`. To turn telemetry off, remove the
`CLAUDE_CODE_ENABLE_TELEMETRY` / `OTEL_*` / `HARNESS_PUSHGATEWAY_URL` keys from `settings.json`.

## Command quick reference

| Command | Use |
|---|---|
| `/build` | Greenfield (or brownfield-aware) build; `--lite` small, `--auto` headless |
| `/vibe` | Controlled small change (≤3 files, no auth/API) |
| `/change` | Behavior change on existing code (test-first); `--issue N` for a GitHub bug |
| `/refactor` | Behavior-preserving cleanup with ratchet gate |
| `/brownfield` | Map an existing codebase before changing it; `--seams "<goal>"` ranks safe cut-points |
| `/gate` | On-demand pre-merge quality gate (evaluator + security) |
| `/status` | SDLC pipeline progress — snapshot, live `watch`, or `timeline` (`--json`; also `npm run status`) |

The internal pipeline stages (`/brd`, `/spec`, `/design`, `/test`, `/implement`, `/evaluate`,
`/deploy`) are normally run for you by `/build`; invoke them directly only as a power user.

## Key files

| Path | What it is |
|---|---|
| `project-manifest.json` | Stack, cost posture, verification mode, LSP servers |
| `.claude/program.md` | Steer an in-flight `/auto` run by editing this — no need to stop it |
| `.claude/settings.json` | Hooks, permissions, env (interactive); `settings.auto.json` for headless runs |
| `specs/` | BRD, stories, design, test plan produced by the planning stages |
| `specs/reviews/` | Evaluator + security verdicts (the proof behind each PR) |
| `claude-progress.txt` | Current pipeline state; `next_action` tells you what's next |
| `docs/` | `prd-format.md`, `telemetry.md`, `model-allocation.md`, and more |

## Troubleshooting

- **A run stalls** — auto-continue fails open loudly with a `STUCK` warning rather than looping
  forever. Run `/status` to see where it stopped.
- **`/evaluate` only runs API checks** — the Playwright plugin isn't enabled; add
  `"playwright@claude-plugins-official": true` to `.claude/settings.json`'s `enabledPlugins`.
- **Headless `--auto` needs isolation** — `settings.auto.json` allows broad `Bash`; run unattended
  builds in a container/VM with no host secrets mounted. Interactive `settings.json` uses a curated
  allowlist instead.
- **Empty Grafana** — the stack isn't up (`docker compose -f telemetry_docker_compose.yml up -d`)
  or the session wasn't restarted after scaffolding. See `docs/telemetry.md`.
