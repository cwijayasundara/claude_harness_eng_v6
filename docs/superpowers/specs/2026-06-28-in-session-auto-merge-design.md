# In-session AUTO_MERGE

**Date:** 2026-06-28
**Status:** Approved (design)
**Scope:** Fix #4b of the fix-#4 cluster. Let a fully-local `/build --auto` run
reach **merged** (not just an open PR), porting symphony's `enableAutoMerge` to
the scaffold.

## Problem

`/build` Phase 11 explicitly stops at the open PR: *"Do not merge. Raising the PR
is the autonomous boundary; merge is a separate decision (a human, or the symphony
`AUTO_MERGE` activation key)."* So the only path to a merged, fully-autonomous
result today is the **tracker** runtime (`symphony_clone`), where
`pr.js#enableAutoMerge` runs `gh pr merge --auto`. The local path has no
equivalent — the `AUTO_MERGE` key the prose references is symphony-only.

## Decisions (from brainstorming)

- **Activation: `--auto-merge` flag OR `AUTO_MERGE=true` env.** The flag mirrors
  the `--single-pr` plumbing (build-lane → build-chain → Phase 11); the env gives
  parity with symphony and headless runs. Merge method from `MERGE_METHOD` env
  (validated `merge`/`squash`/`rebase`, default `merge`).
- **Scaffold-local home.** `symphony_clone/` is not copied to target projects, so
  the merge logic gets a parallel `.claude/scripts/auto-merge.js` rather than a
  shared import. (Code is duplicated across the symphony/target boundary by
  necessity; the two stay parallel.)
- **Scope = the non-pod single integrated PR (Phase 11).** Pod-mode per-cluster
  auto-merge is a deferred follow-up.

## Architecture

### New: `.claude/scripts/auto-merge.js`

Ports symphony `pr.js#enableAutoMerge`. Pure helpers + an injectable-runner
side-effecting function, mirroring symphony's testable shape.

- `isAutoMergeEnabled(flags, env)` *(pure)* → `true` when `flags` contains
  `--auto-merge` **or** `env.AUTO_MERGE === 'true'`.
- `resolveMethod(env)` *(pure)* → validated `env.MERGE_METHOD`
  (`merge`/`squash`/`rebase`); default `merge`; throws on an invalid value (same
  as symphony's `normalizeMergeMethod`).
- `repoSlugFromGitUrl(url)` / `repoSlugFromPrUrl(prUrl)` — host/owner/repo
  (lowercased), ported verbatim from symphony for the pin.
- `enableAutoMerge(prUrl, { runner, expectedSlug, method })` → returns
  `{ enabled: boolean, reason?: string }`, **never throws**:
  - if `prUrl` is not a real PR URL → `{ enabled: false, reason: 'no PR' }`.
  - if `expectedSlug` is set and the PR's slug differs → `{ enabled: false,
    reason: 'PR repo … does not match …' }` (don't merge a PR pointing
    elsewhere).
  - else `runner('gh', ['pr', 'merge', '--auto', '--<method>', '--', prUrl])` →
    `{ enabled: true }`; on a thrown runner error → `{ enabled: false, reason:
    error.message }` (fallback to human merge).

CLI (`require.main`): **self-gating** — it reads its own argv (`--auto-merge`) and
env, and if `isAutoMergeEnabled(...)` is false it prints "auto-merge not enabled"
and exits `0` (a no-op). So Phase 11 can call it **unconditionally** with the
forwarded flag (`node .claude/scripts/auto-merge.js <prUrl> --auto-merge`) — the
script decides whether to act. When enabled, it resolves `expectedSlug` from
`git remote get-url origin` (the current repo), resolves the method from env, and
runs `enableAutoMerge`. It prints the outcome and exits `0` **regardless** (a
disabled / failed / refused auto-merge is not a build failure — the PR is still
open for a human).

### Changed: `.claude/scripts/build-lane.js`

Add `--auto-merge` → `autoMerge: boolean` on the lane result, mirroring the
`--single-pr` wrapper added in fix #1. Boolean flag; does not change lane/PRD.

### Changed: `.claude/scripts/build-chain.js`

Forward `--auto-merge` to the FINALIZE link prompt (Phase 11 runs in the finalize
link), mirroring the `--single-pr` forwarding: `promptFor` appends ` --auto-merge`
when set; `realSpawnLink`/CLI thread it through.

### Changed: `.claude/skills/build/SKILL.md` Phase 11

Rewrite step 3 ("Do not merge"):

> 3. **Merge.** Raising the PR is the autonomous boundary, and merge stays human
>    **unless** AUTO_MERGE is active (the `--auto-merge` flag or `AUTO_MERGE=true`
>    env). When active, run `node .claude/scripts/auto-merge.js <prUrl>` — it pins
>    the PR to the current repo and runs `gh pr merge --auto --<method>`, so
>    **GitHub merges only once the repo's required status checks pass** (never a
>    red build). If auto-merge can't be enabled (repo setting off, `gh` error,
>    slug mismatch), it leaves the PR open and surfaces the reason — the run never
>    fails over auto-merge.

Update the Usage block + the Approval-model prose so `AUTO_MERGE` is no longer
described as symphony-only.

### Docs

- `.claude/skills/build/references/autonomous-lane.md` — note local `--auto-merge`
  alongside the existing symphony `AUTO_MERGE` mention.
- `design.md` — update the "Humans always own merge" line to note the
  `AUTO_MERGE` opt-out now exists on both runtimes.

## Data flow

```
/build prd.md --auto --auto-merge
  └─ build-lane.js  → { lane: 'auto', humanGates: 0, autoMerge: true }
        │  (build-chain.js forwards --auto-merge to the FINALIZE link)
        ▼
  Phase 11:
    /gate (green) ──► gh pr create ──► auto-merge.js <prUrl>
                                          ├─ slug pin (PR repo == origin)
                                          └─ gh pr merge --auto --merge
                                                └─ GitHub merges when required checks pass
    auto-merge disabled/failed ──► PR left open, reason surfaced, run succeeds
```

## Why it is safe (double-gated)

Phase 11 is only reachable when `/gate` (evaluator + adaptive review) and Phase
9.5 (pre-PR API + E2E verify) are green — the harness gates. `gh pr merge --auto`
then waits for the **repo's required status checks** (CI) before GitHub merges.
So the code is gated by the harness AND by CI before merge, and the agent that
wrote the code never self-approves the merge.

## Error / stop behavior

- **Repo lacks "Allow auto-merge" / `gh` error / slug mismatch** →
  `enableAutoMerge` returns `{ enabled: false, reason }`; PR is left open and the
  reason surfaced. The run **succeeds** (an open PR is a valid terminal state).
- **No required status checks on the repo (caveat).** `gh pr merge --auto` merges
  **immediately** when there is nothing to wait for — so on an unprotected repo,
  AUTO_MERGE merges right after the harness gates, not after CI. AUTO_MERGE
  **assumes** the repo has "Allow auto-merge" + branch protection with required
  checks; this is documented in Phase 11 and matches symphony's behavior.

## Testing

- `test/auto-merge.test.js`:
  - `isAutoMergeEnabled` — flag only / env only / neither / both.
  - `resolveMethod` — default `merge`; valid `squash`/`rebase`; invalid → throws.
  - `enableAutoMerge` (stub runner) — non-PR URL → not enabled; slug mismatch →
    not enabled (no `gh` call); happy path → calls
    `gh pr merge --auto --<method> -- <prUrl>` and returns `{enabled:true}`;
    runner throws → `{enabled:false, reason}` (no throw).
- `test/build-lane.test.js` (extend) — `--auto-merge` → `autoMerge:true`; default
  `false`; does not change `lane`/`prdPath`.
- `test/build-chain-*.test.js` (extend) — `promptFor` forwards `--auto-merge` to
  the FINALIZE link; omits it by default.
- `test/build-auto-merge-contract.test.js` — `/build` SKILL.md Phase 11 documents
  `auto-merge.js` and the `--auto-merge`/`AUTO_MERGE` activation, and the Usage
  block shows `--auto-merge`.

## Out of scope (later)

- **Pod-mode per-cluster auto-merge** — applying `auto-merge.js` to each stacked
  `wave-pr.js` PR; the pod prose already references AUTO_MERGE, but the
  stacked-PR wiring is a separate follow-up.
- The other remaining fix-#4 items (`context:fork` gate cleanup, concurrency-cap
  enforcement) and `publish-to-jira.js`.
