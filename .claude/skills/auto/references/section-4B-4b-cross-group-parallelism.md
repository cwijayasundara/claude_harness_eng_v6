## SECTION 4B: Cross-Group Parallelism

Within-group teams (Section 4) parallelize *stories inside one group*. Cross-group parallelism parallelizes *independent groups* of the dependency graph. The two compose: a wave of 3 concurrent groups, each with 5 teammates, is 15 concurrent subagents at peak.

### When It Applies

Cross-group parallelism activates when **all** of the following hold:
- `--parallel-groups N` is `> 1` (default `3`; pass `--sequential` or `--parallel-groups 1` to opt out).
- The dependency graph (`specs/stories/dependency-graph.md`) declares **two or more groups whose upstream dependencies are all satisfied** (already-complete groups or zero upstream deps).

If only one group is ready in the current wave, behave exactly as sequential `/auto` — no extra branches, no parent/child split. Don't pay the coordination tax when there's nothing to coordinate.

### Wave Selection Algorithm

1. Read `specs/stories/dependency-graph.md` and `features.json`.
2. A group `G` is *complete* when every story in `G` has `passes: true` in `features.json`.
3. A group `G` is *ready* when every upstream group of `G` is complete (or `G` has no upstream deps).
4. The current **wave** = the set of ready, not-yet-complete groups.
5. Cap the wave at `--parallel-groups N` (default 3). If more groups are ready than the cap, pick the first N in dependency-graph order; the remainder fall into the next wave.

Log the wave selection to `.claude/state/iteration-log.md` before dispatching:

```
=== Wave 1 (2026-05-13T12:30:00Z, parallel-groups=3) ===
Ready: [B, C, D]
Selected: [B, C, D]
Deferred: []
```

### Git Branch Strategy

Each group in a wave runs on its own branch to eliminate parallel-commit conflicts on the trunk.

1. Before dispatch, the parent orchestrator captures the current branch as `WAVE_BASE` (e.g., `main` or `feat/new-thing`).
2. For each group `G` in the wave, the parent creates `auto/group-{G}` from `WAVE_BASE` and dispatches the group-orchestrator subagent against it.
3. Each group-orchestrator commits all its work to its own branch.
4. After all group-orchestrators in the wave complete, the parent merges branches back into `WAVE_BASE` **sequentially in dependency-graph order**. Failed groups are NOT merged; their branches are preserved for inspection.

Merge conflicts at this stage indicate a file-ownership violation (two groups touched the same file). When that happens:
- Abort the merge.
- Record the violation in `.claude/state/learned-rules.md` under "Process rules".
- Surface it as a ratchet failure for the offending group.
- Resume `/auto` to re-plan with the user.

If `--sequential`, skip branch creation entirely and commit directly to `WAVE_BASE`.

### State Coordination

Concurrent group-orchestrators MUST NOT write to shared state files. The parent owns shared state and merges per-group artifacts between waves.

**Parent-owned (read-write only by parent orchestrator):**
- `claude-progress.txt`
- `.claude/state/learned-rules.md`
- `features.json` (parent rolls up per-group status updates between waves)

**Per-group-owned (read-write only by that group's orchestrator):**
- `.claude/state/wave-{N}/group-{G}/iteration-log.md` — micro-DAG, teammate spawns, ratchet results
- `.claude/state/wave-{N}/group-{G}/features-update.json` — proposed updates to `features.json` for stories in `G`
- `.claude/state/wave-{N}/group-{G}/learned-rule-candidates.md` — candidate rules to roll up
- `.claude/state/wave-{N}/group-{G}/sprint-contract.json` — copy of the approved contract for this group
- `sprint-contracts/group-{G}.json` — the canonical contract (each group writes only its own file)

The parent creates `.claude/state/wave-{N}/` before dispatch and rolls per-group artifacts up into parent-owned state between waves. Roll-up steps:

1. Append each `iteration-log.md` section to the canonical `.claude/state/iteration-log.md` (preserving group tags).
2. Merge each `features-update.json` into `features.json` (key-disjoint by story ID — no conflicts possible if file ownership held).
3. Triage each `learned-rule-candidates.md` — promote the strong ones to `.claude/state/learned-rules.md`; discard duplicates and weak signals.
4. Update `claude-progress.txt` with the wave summary (groups completed, stories passing, next wave preview).

### Group-Orchestrator Spawn Protocol

For each group `G` in the current wave, the parent spawns a subagent with this prompt template. Use `Agent(subagent_type=generator)` — the generator agent's instructions cover both implementation AND orchestration when given the group-orchestrator role.

```
You are the group-orchestrator for dependency group {G} of wave {N}.

Your scope is EXACTLY one group. Do not touch other groups, do not advance the wavefront, do not write to parent-owned state files.

Mandatory steps:
1. Read sprint-contracts/group-{G}.json. If missing, propose one (Section 3 of /auto), get evaluator approval, then proceed.
2. Switch to branch auto/group-{G} (parent has already created it from {WAVE_BASE}).
3. Run the in-group flow: micro-DAG → teammate dispatch (Rule 2 in generator.md) → ratchet gate for this group only.
4. Write per-group state to .claude/state/wave-{N}/group-{G}/ ONLY. Do not write to claude-progress.txt, learned-rules.md, or features.json directly.
5. Commit all work to auto/group-{G}. Do NOT merge — the parent handles merging after the wave.
6. Return a structured summary: { "group": "{G}", "passes": <bool>, "stories_passing": [...], "stories_failing": [...], "rule_candidates_path": "...", "iteration_log_path": "..." }

You may parallelize teammates within this group up to 5 (Rule 2 mandate). You may NOT spawn nested group-orchestrators or touch other groups.
```

### Wait + Merge Protocol

The parent dispatches all group-orchestrators in the wave in a single message (multiple `Agent` tool calls in one block — Claude Code runs them concurrently). The parent then:

1. Waits for all group-orchestrator subagents to return.
2. For each returned summary, runs the roll-up steps above (in dependency-graph order, deterministic).
3. **Regression-suite-full gate (G15) — before merging into `WAVE_BASE`.** For each group that passed its own ratchet gate, run `node .claude/scripts/regression-gate.js --exclude-group {G}` against the running app. It re-runs every accumulated Playwright spec under `e2e/` (not just this group's own spec) and re-executes every prior group's sprint-contract `api_checks` live. A `blocked` verdict means this group's own tests passed but an EARLIER group's feature broke — treat it exactly like a failed group (step 5 below): do not merge its branch, log the regression finding under `.claude/state/iteration-log.md`. `no-baseline` (no `e2e/` and no `sprint-contracts/` yet) is a non-blocking note.
4. Merges successful, regression-clean groups' branches into `WAVE_BASE` (sequential merges).
5. If any group failed (ratchet or regression gate): leave its branch unmerged, log the failure under `.claude/state/iteration-log.md`, advance to the next wave with the failed group still incomplete. The next wave may unlock different groups via the dependency graph; failed groups can be retried by re-running `/auto --group {G}` later.
6. Recompute the wave (Wave Selection Algorithm) and dispatch the next one until all groups are complete or no groups can advance.

### Failure Handling

| Failure mode | Parent action |
|---|---|
| One group in wave fails ratchet gate | Leave branch unmerged, advance other groups, surface failure summary at end of wave |
| Group-orchestrator subagent crashes / times out | Treat as failed; do NOT auto-retry inside the same wave (avoid infinite loops); user can `/auto --group {G}` to retry |
| Merge conflict during roll-up | Abort merge for that group, treat as failure, record as a file-ownership-violation rule candidate |
| All groups in wave fail | Stop. Print wave summary and ask user how to proceed |

### Concurrency Limits

| Resource | Cap | Rationale |
|---|---|---|
| Concurrent group-orchestrators per wave | 3 (default, override with `--parallel-groups N`) | Below most rate limits; leaves headroom for within-group teams |
| Concurrent teammates per group-orchestrator | 5 (Section 4 mandate) | Existing within-group cap |
| Peak total subagents | 18 (3 orchestrators + 3×5 teammates) | Gate counts ALL Task subagents including group-orchestrators; 18 fits the documented peak |

If `--parallel-groups N > 3`, accept it but emit a warning to the iteration log. The 3-default is conservative; teams with higher API throughput can raise it.

**Enforced, not advisory.** The concurrency caps above are now backed by a hard
ceiling: the `PreToolUse(Task)` hook `.claude/hooks/concurrency-gate.js` counts
in-flight subagents and **denies** a spawn that would exceed
`max_concurrent_agents` (`project-manifest.json#execution.max_concurrent_agents`
→ env `CLAUDE_MAX_CONCURRENT_AGENTS` → default 18), decrementing on
`SubagentStop`. The gate counts **ALL** Task subagents, including the
group-orchestrators themselves (which are also Task spawns). At the documented
3-group × 5-teammate peak that is 3 orchestrators + 15 teammates = 18 concurrent
subagents — the default of 18 accommodates that peak without throttling. Below
the default, or with a tighter configured cap, spawns past the ceiling receive
**backpressure, not a failure** — wait for in-flight subagents to finish, then
retry; do not treat backpressure as a ratchet failure. The gate fails open (a
gate error never blocks spawns) and TTL-prunes a leaked count.

### Pod mode (`--pod N`) — per-cluster PRs

Pod mode keeps everything above (wave selection, branch isolation, state coordination, concurrency caps) and changes **only the wave's terminal step**: instead of the parent merging group branches into `WAVE_BASE`, **each cluster raises its own draft PR**. The architect (planning + parent) hands each independent cluster to an "engineer" (group-orchestrator) that delivers a reviewable PR — matching how a real pod assigns clusters to developers.

**What changes vs default cross-group:**

1. **Per-cluster verification before the PR.** After a group's ratchet gate passes, the group-orchestrator runs the **Phase 9.5 pre-PR ladder scoped to its cluster** — deploy locally → API tests (if the cluster touches an API) → Playwright E2E (if it touches UI) → bounded defect-repair loop. A cluster that can't go green within the repair budget does **not** open a PR; it returns failed, exactly like a ratchet failure.
2. **Each engineer opens its own draft PR.** A green group-orchestrator pushes `auto/group-{G}` and opens the stacked draft PR via `wave-pr.js` using the cluster's computed `base` from `wave-plan.js`; body = the cluster's stories + the Phase 9.5 proof + Forbidden-Actions check. It returns the PR URL in its summary. It does **not** merge and does **not** roll up to the trunk.
3. **The parent does NOT merge branches and does NOT wait for merges.** Run
   `node .claude/scripts/wave-plan.js` (if `/auto` was invoked with `--single-pr`,
   pass it through automatically — `wave-plan.js --single-pr` — so `pr_mode` resolves
   to `integrated` regardless of cluster count; this is automatic, not manual) to get
   the deterministic plan: `pr_mode` and, per group, its `branch`, `base`, and
   `mergeIn`. For each cluster `G` in the wave (injecting its computed `base` and `mergeIn` list from the plan directly into the group-orchestrator's spawn prompt, so the subagent uses the planner's values verbatim and does not recompute them):
   - create the cluster's `branch` (`auto/group-{G}`) from its computed `base`: a **root** cluster branches from `main`; a **single-parent** cluster branches from its predecessor's branch — a stacked PR whose `base` is `auto/group-{predecessor}`; a **diamond-join** cluster branches from `main`, then merges each `mergeIn` branch in locally so it builds against all upstream code;
   - on green, open the stacked PR with
     `node .claude/scripts/wave-pr.js --branch auto/group-{G} --base <base> --title "<cluster title>" --body "<stories + Phase 9.5 proof + Forbidden-Actions check; for a mergeIn group, list the predecessor PRs as dependencies>"`.
   Then roll up per-group *state* as usual and **compute the next wave immediately** —
   dependent clusters build on their predecessor's *branch*, never on a merged trunk.
   Humans merge the stack bottom-up; GitHub auto-retargets each child PR to `main`
   as its parent merges. If `pr_mode` is `integrated`, skip per-cluster PRs and roll
   the wave up to the trunk exactly as non-pod mode does.
4. **Conflict avoidance is structural.** Independent clusters in one wave have **disjoint file ownership** (from `component-map.md`): each cluster owns a non-overlapping set of files, so their PRs don't collide regardless of which branch each one starts from. Root clusters branch from `main`; dependent clusters stack on their predecessor's branch — clusters in one wave can have different computed bases. Cross-cutting/shared files (routing, config, schema) live in **foundation clusters that land in earlier waves** (per `/spec` ordering) so no two concurrent engineers edit a shared file. This is the defense against the ~23% parallel-agent merge-conflict rate.

**Group-orchestrator spawn protocol — pod addendum.** In pod mode, append to the spawn prompt's mandatory steps (after the existing step 5 "commit to branch"):

```
5a. [POD MODE] Run the Phase 9.5 pre-PR ladder for THIS cluster only: deploy locally,
    run API tests if your cluster exposes an API, run Playwright E2E if it has UI,
    and repair defects (fix implementation, not tests) up to the attempt cap. If it
    cannot go green, return passes=false — do NOT open a PR.
5b. [POD MODE] On green, push auto/group-{G} and open the stacked draft PR with
    `node .claude/scripts/wave-pr.js --branch auto/group-{G} --base <base from wave-plan.js>
    --title "<cluster title>" --body "stories + Phase 9.5 proof + Forbidden-Actions check"`.
    Do NOT merge. Add "pr_url" to your returned summary.
```

**Failure handling addendum (pod):** a cluster whose Phase 9.5 ladder fails is treated as a wave failure — no PR opened, branch preserved, retry via `/auto --group {G} --pod`. A cluster whose PR opens but whose merge is rejected by review blocks only its *dependents*; independent later clusters proceed.

---
