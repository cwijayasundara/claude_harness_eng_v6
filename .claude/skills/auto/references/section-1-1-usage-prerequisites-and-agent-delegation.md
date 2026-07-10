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
