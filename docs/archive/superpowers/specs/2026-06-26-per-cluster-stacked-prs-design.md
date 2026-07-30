# Per-cluster stacked PRs, made deterministic

**Date:** 2026-06-26
**Status:** Approved (design)
**Scope:** Fix #1 of the autonomous-path gap series. Make "a PR per independent
user-story cluster" a real, deterministic capability instead of LLM prose.

## Problem

The harness claims full-auto runs raise "a PR per independent user-story
cluster," but in the implementation:

1. **Wave / branch / base selection is LLM prose.** `/auto` Section 4B computes
   the current wave by having the model read `specs/stories/dependency-graph.md`
   (a markdown, LLM-authored artifact). There is no machine-readable graph and no
   deterministic git plan, so branch and PR-base correctness is non-deterministic.
2. **Pod mode waits for predecessor *merge*.** Section 4B pod prose (current
   lines ~347–370) opens each cluster's PR with `base = WAVE_BASE` (the trunk) and
   then **waits for this wave's PRs to merge before computing the next wave**.
   Because humans own merge, an autonomous run stalls indefinitely on human
   action — directly contradicting full-auto.
3. **`--pod N` conflates two concerns.** It means both "run N clusters
   concurrently" *and* "split into per-cluster PRs." You cannot get per-cluster
   PRs at the default concurrency, nor concurrency without PR-splitting.

## Decisions (from brainstorming)

- **Dependency model: stacked branches, no merge wait.** Independent clusters →
  parallel PRs against `main`. A dependent cluster B (depends on A) branches off
  A's branch and targets A's PR as its base (a stacked PR). No polling for merge.
  Humans merge the stack bottom-up; GitHub auto-retargets each child PR to `main`
  as its parent merges. This keeps "human owns merge" intact and never stalls the
  run.
- **Granularity: per-cluster by default, threshold-gated.** A full-auto run
  splits into per-cluster stacked PRs when there is **>1 independent cluster**;
  a single-cluster project yields one integrated PR with no stacking overhead.
  `--single-pr` forces integrated mode always.
- **Decouple the flags.** `--pod N` / `--parallel-groups N` control *concurrency
  only*. PR granularity is decided automatically (`pr_mode`), opted out via
  `--single-pr`.

## Architecture

A deterministic planner computes the git plan; a thin wrapper opens PRs; the pod
prose stops doing git by hand.

### New: `specs/stories/dependency-graph.json` (emitted by `/spec`)

Machine-readable sibling of `dependency-graph.md`. The `.md` remains the human
artifact; the `.json` is what code reads.

```json
{
  "groups": [
    { "id": "A", "stories": ["S1", "S2"], "blockedBy": [] },
    { "id": "B", "stories": ["S3"],       "blockedBy": ["A"] },
    { "id": "C", "stories": ["S4"],       "blockedBy": [] }
  ]
}
```

This is the only change to `/spec`: emit the JSON alongside the existing markdown.

### New: `.claude/scripts/wave-plan.js` (pure, deterministic — core of the fix)

Reads `dependency-graph.json` + `features.json`. Outputs the plan:

- **waves** — topological layers of *ready, unfinished* groups. A group is
  *unfinished* if any of its stories' features are not `passing` in
  `features.json`. A group is *ready* when every group in its `blockedBy` has
  **completed its build** (its branch exists and is green) — **not** when it has
  merged. Because waves run as ordered topological layers, a predecessor built in
  an earlier wave satisfies readiness; the no-merge-wait rule depends on this.
- per group, the **git plan**, by predecessor count:
  - **0 unfinished predecessors** (root) → `base: "main"`, `mergeIn: []`.
  - **exactly 1 unfinished predecessor** → `base: "auto/group-{pred}"`,
    `mergeIn: []`. The branch is cut from the predecessor's branch, so it already
    contains the predecessor's code (a clean stacked PR).
  - **>1 unfinished predecessor** (diamond join) → `base: "main"`,
    `mergeIn: ["auto/group-{p1}", …]`. A single git base can't express multiple
    parents, so the branch is cut from `main` and all predecessor branches are
    **merged into it locally** before dispatch (so it builds/tests against all
    upstream code). Its PR targets `main` and its body lists the predecessor PRs
    as dependencies. `branch` is always `"auto/group-{id}"`.
- top-level **`pr_mode`**: `"integrated"` when there is ≤1 group **or**
  `--single-pr` is set; otherwise `"per-cluster"`. (A linear chain A→B→C is 3
  groups → 3 stacked PRs, which is the desired reviewable stack.)

Pure logic: no git, no network. Fully unit-testable. This is the determinism
guarantee — every other component consumes its output.

Output shape (diamond A→{B,C}→D):

```json
{
  "pr_mode": "per-cluster",
  "waves": [
    [ { "id": "A", "branch": "auto/group-A", "base": "main", "mergeIn": [] } ],
    [ { "id": "B", "branch": "auto/group-B", "base": "auto/group-A", "mergeIn": [] },
      { "id": "C", "branch": "auto/group-C", "base": "auto/group-A", "mergeIn": [] } ],
    [ { "id": "D", "branch": "auto/group-D", "base": "main",
        "mergeIn": ["auto/group-B", "auto/group-C"] } ]
  ]
}
```

CLI: `node .claude/scripts/wave-plan.js [--single-pr]` reads the spec files from
their canonical locations, prints JSON to stdout, exits non-zero on a malformed
or missing graph.

### New: `.claude/scripts/wave-pr.js` (thin `gh` wrapper)

Given a group's computed `branch` + `base`, runs:

```
gh pr create --draft --base <base> --head <branch> --title <…> --body <…>
```

Returns the PR URL. **Idempotent**: if a PR already exists for `branch`, it is a
no-op that returns the existing URL. The only side-effecty new code; kept tiny so
the planner holds all the logic.

### Changed: `/auto` Section 4B (pod terminal step rewrite)

- Branch each group from its `wave-plan.js` `base` (not a hardcoded `WAVE_BASE`),
  then merge in any `mergeIn` branches locally (diamond-join groups).
- On green, call `wave-pr.js` to open the stacked PR; for a `mergeIn` group, the
  PR body lists the predecessor PRs as dependencies.
- **Remove the merge wait.** The next wave proceeds immediately; dependent
  clusters branch from their predecessor's *branch*, not from a merged trunk.
- Branch-creation prose defers base/mergeIn selection entirely to the script.

### Changed: `.claude/scripts/build-chain.js` (per-cluster wave driving)

When `pr_mode == "per-cluster"`, sequence waves via `wave-plan.js` and open
stacked PRs per cluster. The FINALIZE link no longer rolls everything into a
single integrated PR in this mode. When `pr_mode == "integrated"`, behaviour is
unchanged from today.

### Changed: `.claude/scripts/build-lane.js` (flags)

Add `--single-pr` (forces `pr_mode == integrated`). `--pod` / `--parallel-groups`
keep their meaning but no longer imply PR-splitting.

## Data flow

```
/spec ─► dependency-graph.json
            │
            ▼
       wave-plan.js ──► { pr_mode, waves[ {id, branch, base} ] }
            │
            ▼
  parent creates each branch from its computed base (+ local mergeIn)
            │
            ▼
  group-orchestrators commit per-branch (one per cluster)
            │
            ▼ (green)
       wave-pr.js ──► gh pr create --draft --base <base> --head <branch>
            │
            ▼ (NO merge wait)
       next wave ──► … ──► human merges stack bottom-up
                            (GitHub auto-retargets children to main)
```

## Error handling

- **Failed cluster** → no PR, branch preserved, dependents blocked, independents
  proceed. Unchanged from today.
- **`wave-pr.js` `gh` failure** → surfaced loudly (non-zero exit + message),
  branch preserved, run continues to independent clusters. Never silently
  swallowed.
- **Malformed / missing `dependency-graph.json`** → `wave-plan.js` exits non-zero
  with a clear message; the caller falls back to single-PR integrated mode rather
  than guessing a graph.

## Testing

`test/wave-plan.test.js` (node:test), pure — no git/network:

- 1 group → `pr_mode: integrated`.
- 2 independent clusters → 2 PRs, both `base: main`, `mergeIn: []`.
- chain A→B → B `base: auto/group-A`, `mergeIn: []`.
- diamond A→{B,C}→D → B,C `base: auto/group-A`; D `base: main`,
  `mergeIn: ["auto/group-B","auto/group-C"]`.
- `--single-pr` → `pr_mode: integrated` regardless of group count.
- unfinished filter: groups whose features all pass in `features.json` are
  excluded from the waves.
- wave ordering: a dependent group never appears in the same or an earlier wave
  than any of its predecessors.

`wave-pr.js` gets a thin test for the idempotent "PR already exists" path with a
stubbed `gh` runner.

## Out of scope (tracked separately)

- **Tracker-path PR stacking** — symphony already opens one PR per issue; aligning
  its PR base with the stack lands with fix #3 (brownfield tracker).
- **Brownfield routing** — fixes #2 and #3.
