## SECTION 1: Usage, Prerequisites, and Agent Delegation

### Usage

```
/auto
/auto --mode lean

/auto --group D
/auto --parallel-groups 3
/auto --sequential
/auto --once
/auto --pod 3
/auto --single-pr
```

- `--mode` controls which ratchet gates are enforced. Default: `full`. Options: `full`, `lean` (`lean` skips only the per-iteration design-critic).
- `--group` resumes or targets a specific dependency group. If omitted, picks the next unfinished group from the dependency graph.
- `--parallel-groups N` enables cross-group parallelism: up to N independent dependency groups run concurrently as separate group-orchestrator subagents. Default: `3`. Set `1` (or pass `--sequential`) to force one-group-at-a-time behavior.
- `--sequential` shorthand for `--parallel-groups 1`. Use when you need deterministic group ordering for debugging.
- `--once` — **single-wave mode** for cross-process chaining: run exactly **one** wave (the next ready group, or up to `--parallel-groups N` ready groups), take it through all ratchet gates, commit, append the session block to `claude-progress.txt`, then **exit cleanly without looping to the next wave**. The driver (`.claude/scripts/build-chain.js`) re-spawns a fresh `claude -p` for the next wave. Use `--once --sequential` to shrink a link to a single group when a full wave is too large to finish under the per-link timeout.
- `--pod N` — **pod mode**: cross-group concurrency (implies `--parallel-groups N`, default `3`). PR granularity is decided automatically by `.claude/scripts/wave-plan.js` (`pr_mode`): when more than one cluster is unfinished, each cluster raises its **own stacked draft PR** instead of rolling its branch up to the trunk; a single remaining cluster (or `--single-pr`) yields one integrated PR. Each cluster is verified per-cluster (the Phase 9.5 deploy→API→E2E→fix ladder, scoped to that cluster). Dependent clusters **stack on their predecessor's branch** — they do **not** wait for any PR to merge. See Section 4B → *Pod mode*. Surfaced by `/build --autonomous --pod N`; `--single-pr` forces one integrated PR.
- `--single-pr` — forces **one integrated PR** regardless of cluster count. When `/auto` is invoked with `--single-pr`, it automatically passes the flag through to `.claude/scripts/wave-plan.js` so `pr_mode` resolves to `integrated` — even when multiple clusters are unfinished. In that case the parent merges all group branches into the trunk after the wave and opens a single PR, exactly as non-pod mode does. Overrides the per-cluster PR default. Takes effect ALWAYS — `/build path/to/prd.md --autonomous --pod 3 --single-pr` gives pod concurrency (up to 3 parallel clusters) but ONE integrated PR at the end.
- `--no-retro` — skip the automatic `/retro` invocation at session end (SECTION 11, Hard stop / Success only — a `--once` link never reaches these branches; see SECTION 10.1). `/retro` is report-only and interactive (agentic-flywheel §4.2) and never blocks completion, so this is rarely needed — use it when an outer caller (a `Workflow` script driving `/auto` as a sub-step, for example) wants to invoke `/retro` itself once, at its own boundary, instead of having it fire inside this session.

### Prerequisites

Before `/auto` can run, the following must exist:

- `specs/stories/` — approved story files with acceptance criteria.
- `specs/design/` — approved architecture artifacts including `api-contracts.md` and `component-map.md`.
- `.claude/program.md` — project constraints and conventions.
- `features.json` — feature tracking file (created by `/spec`).
- `specs/stories/dependency-graph.md` — group ordering and dependencies.
- `specs/stories/epics.md` — epic index and story membership.
- `claude-progress.txt` — session tracking file (created by `/build` phase 4).

If any prerequisite is missing, stop and report what is absent. Do not proceed with partial context.

**Execution contract [HARD BLOCK].** A valid
`.claude/state/task-envelope.json` must exist before `/auto` dispatches any
agent:

```bash
node .claude/scripts/task-envelope.js verify
node .claude/scripts/task-lifecycle.js status
```

The envelope binds the approved task/risk decision to allowed paths, forbidden
actions, evidence, approvals, budgets, and stopping conditions. A missing or
invalid envelope is not an implicit unrestricted task.

**Unattended containment [HARD BLOCK].** When
`HARNESS_UNATTENDED=1` (the `settings.auto.json` profile), also run:

```bash
node .claude/scripts/security-certification.js verify --profile unattended-core
node .claude/scripts/unattended-preflight.js
```

The certification must be current and match the exact unattended policy and
enforcement sources. Both commands must pass before any delegation. Preflight
verifies a fail-closed Claude sandbox,
subprocess credential scrubbing, a deny-by-default egress policy, container/CI
or externally attested isolation, absence of mounted host credential stores,
and required security scanners. A warning is not sufficient in headless mode.

**The planning phases must have closed their review loops [HARD BLOCK]:**

```bash
node .claude/scripts/plan-approval.js check --phase all
```

**One-time migration for in-flight projects.** `brd` joined the gated phases when `/brd` was de-forked, so a project whose `specs/brd/` predates that change has no receipt and this check will block. Record or waive it once:

```bash
node .claude/scripts/plan-approval.js record --phase brd --verdict approved --artifact specs/brd/brd.md
# or, for a lane that legitimately had no human intake:
node .claude/scripts/plan-approval.js waive --phase brd --lane --auto
```

A non-zero exit means a phase was never reviewed, is still in `changes-requested`, or — the case worth catching — was edited after approval, so the plan `/auto` is about to build is not the plan the human signed off. Stop and report which phase; do not build past it.

`--phase all` gates each of `spec`, `design`, and `test` **only when that phase produced artifacts** in this project, and prints the ones it skipped. The delta lanes that reach `/auto` through `/sprint` and `/feature` never run a test-planning phase, and blocking them for not producing an artifact they were never meant to produce would make the gate wrong rather than strict. Where a lane *does* carry a phase forward unchanged from an earlier sprint, its existing approval still holds — the digests match; regenerate the artifact and it needs review again.

Headless lanes satisfy this with a recorded waiver rather than a skip (`plan-approval.js waive --phase <p> --lane --auto`), written by `/build` when it resolves the lane. `/auto` accepts a waiver — the waiver *is* the audit trail for a run that had no human gates.

### Agent Delegation

**Critical rule: /auto orchestrates but NEVER implements code directly.**

- `/auto` is the orchestrator. It reads state, makes decisions, spawns agents, and manages the loop.
- Code generation is delegated to the **generator** agent (via `/implement` or direct agent spawn).
- Code verification is delegated to the **evaluator** agent (via `/evaluate` or direct agent spawn).
- Design critique is delegated to the **design-critic** agent.
- `/auto` never writes application code, tests, or configuration files itself.

### Long-run autonomy & grounded progress

`/auto` is an autonomous, multi-context-window loop. These rules keep it honest and unblocked over long runs (they matter most on the most capable orchestrator models, which sustain hours-long runs):

- **Ground every progress claim in evidence.** Before reporting that a group passed, a gate cleared, or tests are green, point to the actual tool result from this session that proves it — the evaluator verdict file, the test exit code, the `*-grounding.json`. Never report work you cannot point to; if something is not yet verified, say so explicitly. If tests failed, say so with the output; if a step was skipped, say that. This is the same groundedness discipline the pipeline enforces on artifacts, applied to the loop's own status.
- **Do not stop early on context-budget concern.** The context window compacts (or you start a fresh window from `claude-progress.txt`, `features.json`, and git state) — you can continue indefinitely. Do not summarize-and-hand-off or suggest a new session because tokens look low; save state to `claude-progress.txt` and keep going.
- **Proceed on reversible actions; pause only for genuine checkpoints.** Editing files, running tests, and committing to the work branch follow from the build goal — do them without asking. Pause and end the turn only for a truly destructive or irreversible action, a real scope change beyond the approved stories, or input only the human can provide. Do not end a turn on a promise ("I'll now run the evaluator…") — issue the tool call and do the work now.
- **Give subagents the full task spec up front.** When spawning generator/evaluator/design-critic agents, put the complete story context, acceptance criteria, and constraints in the first prompt rather than dripping them across turns — well-specified delegation is what makes the autonomous loop efficient.

### Context & Token Discipline

`/auto` is the longest-running, most token-heavy loop in the harness. Every token in the orchestrator's context window is re-sent (cache permitting) on every turn, so keep the orchestrator context lean — delegate verbose work into subagents whose context is discarded when they return.

- **Keep verbose output out of the orchestrator.** Test logs, build output, full-file reads, and evaluation transcripts must be produced and consumed inside the `evaluator` / `codebase-explorer` / generator subagents — only their short verdict (PASS/FAIL + summary) returns to `/auto`. Never read raw test or build logs into the orchestrator directly.
- **Prefer Grep/Glob over full Reads.** When the orchestrator needs a fact from a file, search for it; do not read whole files into the loop's context.
- **Bound noisy command output.** Tool output cannot be compressed after the fact by a hook — `suppressOutput` only hides it from the UI, not from the model. So bound it *before* it crosses the tool boundary: run verbose commands as `cmd > /tmp/out.log 2>&1` then surface only what matters with `tail -n 50 /tmp/out.log` or `grep -E 'FAIL|Error' /tmp/out.log`, or have a subagent run the command and return only a summary. Never let a full build/test log stream into the orchestrator.
- **Compact at group boundaries, not mid-group.** Run `/compact` (or rely on session chaining via `claude-progress.txt`) at the seam between dependency groups, where the summary is cheap and the prefix rebuild is amortized — never mid-implementation, which throws away a warm cache. (See SECTION 10: Session Chaining.)
- **Don't break the cache prefix mid-run.** No tool/plugin/MCP churn, no `CLAUDE.md` edits, no main-loop model swap during a run (see the Prompt Caching rules in `CLAUDE.md`). Model changes happen via subagents only.

---
