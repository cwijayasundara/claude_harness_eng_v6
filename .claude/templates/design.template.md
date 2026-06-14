<!-- Project design.md template, copied + adapted by /scaffold Step 6. Stack-specific bits are filled in at scaffold time. -->

# Claude Harness Engine v5 — Design Reference

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
| Planner          | `.claude/agents/planner.md`   | Sprint planning, story breakdown, architecture |
| Generator        | `.claude/agents/generator.md` | Feature implementation; also test authoring (`skills/test/references/test-authoring.md`) and UI mockups (`skills/design/references/ui-mockups.md`) |
| Evaluator        | `.claude/agents/evaluator.md` | Runtime mode: API + Playwright verification. Artifact mode: rubric-scores planning docs |
| Design Critic    | `.claude/agents/design-critic.md` | Visual design scoring (Karpathy loop) |
| Security Reviewer| `.claude/agents/security-reviewer.md` | Vulnerability auditing             |
| Codebase Explorer| `.claude/agents/codebase-explorer.md` | Read-only brownfield discovery     |

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

> **Note:** The deterministic hooks above are the *only* always-on enforcement. The generator, evaluator, design-critic, and reviewer **agents** run solely when a slash command (`/build`, `/implement`, `/evaluate`, `/gate`, `/vibe`, …) invokes them or when the model chooses to — a raw ad-hoc edit is guarded by hooks alone. Do not add `disableWorkflows` and do not assume agent-level validation fires without a command.

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
