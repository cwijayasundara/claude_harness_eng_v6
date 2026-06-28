# Symphony workspace-manager security hardening

**Date:** 2026-06-27
**Status:** Approved (design)
**Scope:** Fix #4a (first of the fix-#4 cluster). Two security/safety bugs in
`symphony_clone/src/orchestrator/workspace-manager.js`, both on the unattended
tracker path where no human is watching.

## Problem

**Bug 1 — post-checkout hook env-leak.** `runCommand` spawns git with
`env: process.env` (workspace-manager.js:113). A `.git/hooks/post-checkout`
left in a workspace by a prior run therefore executes on every `checkout`/`clone`
with the orchestrator's full secrets in scope (`LINEAR_API_KEY`, `GITHUB_TOKEN`,
LLM keys). The exposure is real on **resume**: `prepare()` re-checks out an
existing `.git` (lines 34, 40) where a previous `claude -p` run may have written
hooks.

**Bug 2 — error-swallowing → destructive reset.** `branchExists` (line 74) and
`countCommitsAhead` (line 84) `catch (_)` *all* errors and return `false`/`0`. A
real failure (torn index, permission error) then looks like "branch absent / 0
commits ahead", so `prepare()` falls through to `git checkout -B branchName
baseRef` (line 40) — which **resets the branch to base and destroys local
commits**. The destructive reset is meant to run only when the branch is
genuinely new.

## Decisions (from brainstorming)

- **Per-command hook disable**, not global: inject `-c core.hooksPath=/dev/null`
  into the git commands symphony itself runs, so symphony's clone/checkout/reset
  run hook-free while the build's own commits (a separate `claude -p` process)
  keep the harness's commit-msg git hook if present. No collateral.
- **`branchExists` switches to `git show-ref --verify --quiet`** for a clean
  tri-state (0 exists / 1 absent / other = error), rather than `rev-parse
  --verify` which returns 128 for both "absent" and "broken repo".
- **`countCommitsAhead` propagates errors** instead of swallowing to `0` — the
  swallow is exactly what enables the data-loss path.

## Architecture

All changes are in `symphony_clone/src/orchestrator/workspace-manager.js`. No new
files; this is hardening of one module.

### New: `runGit(runner, cwd, args)` — the single git choke point

```js
function runGit(runner, cwd, args) {
  return runner('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd });
}
```

`-c core.hooksPath=/dev/null` is a git **global option** valid before any
subcommand (including `clone`); it points git at a hooks dir with no hooks, so no
`.git/hooks/*` runs for that invocation. Every git call in the file — the
`WorkspaceManager.prepare`/`pushBranch` methods (via `this.runner`) and the
`branchExists`/`countCommitsAhead` module helpers (via their `runner` arg) — is
rewritten to go through `runGit`. Read-only commands (`fetch`, `show-ref`,
`rev-list`) harmlessly carry the flag; the point is one uniform place that
guarantees symphony never triggers a workspace hook. `/dev/null` is the POSIX
path; symphony runs in a Linux Docker container, so it is always valid.

### Changed: `runCommand` — expose the exit code

In the `close` handler's non-zero branch, attach the code (and stderr) to the
rejected Error so callers can branch on it:

```js
const error = new Error(`${command} ${args.join(' ')} failed with ${code}: ${stderr || stdout}`);
error.code = code;
error.stderr = stderr;
reject(error);
```

### Changed: `branchExists` — clean tri-state, no swallow

```js
async function branchExists(runner, cwd, branchName) {
  try {
    await runGit(runner, cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
    return true;                 // exit 0 → exists
  } catch (error) {
    if (error && error.code === 1) return false;   // exit 1 → genuinely absent
    throw error;                 // any other code → real failure, propagate
  }
}
```

### Changed: `countCommitsAhead` — propagate failures

```js
async function countCommitsAhead(runner, cwd, branch, base) {
  const { stdout } = await runGit(runner, cwd, ['rev-list', '--count', '--end-of-options', `${base}..${branch}`]);
  const n = Number.parseInt((stdout || '').trim(), 10);
  return Number.isFinite(n) ? n : 0;   // only a non-numeric stdout maps to 0; a thrown error propagates
}
```

It is only called after `branchExists` returned `true`, so a thrown error here is
genuinely unexpected and must surface, not silently become `0`.

## Data / control flow (after the fix)

```
prepare(issue, group)
  ├─ runGit clone (fresh)            ← hook-free
  ├─ runGit fetch origin <base>      ← hook-free
  ├─ branchExists  → show-ref --verify --quiet
  │     0 → true   1 → false   other → THROW ─┐
  ├─ (if exists) countCommitsAhead → rev-list │  THROW on error ─┐
  │     >0 → backup tag + checkout (resume)    │                  │
  └─ checkout -B branch base (reset)  ← only when branch is *confidently* absent
                                                                  │
   any THROW ─────────────────────────────────────────────────────┘
        → claimAndRun try/catch → handleRunError (retry/backoff → Blocked)
```

The destructive `checkout -B` reset now runs only on a clean "absent" signal; any
ambiguity fails loudly and the existing retry path preserves committed work.

## Error / stop behavior

- **Attacker-planted hook** → never runs for symphony's git ops (no env exposure).
- **Real git error during prepare** → propagates to `claimAndRun`'s try/catch →
  `handleRunError` (existing exponential-backoff retry, then move the issue to
  Blocked). No silent data loss, no destructive reset.
- **Genuinely-absent branch** → `branchExists` returns `false` (exit 1) and the
  fresh `checkout -B` runs as before. Behavior unchanged for the happy path.

## Testing

Extend symphony's `node:test` suite (`test/workspace-manager.test.js`; a
`test/workspace-manager-recovery.test.js` also exists for resume cases). The
helpers take an injectable `runner`, so tests stub it to resolve/reject with
`code`-bearing errors — no real git needed for the unit cases:

- **hook disable** — `runGit` (and through it the `prepare` clone/checkout calls)
  passes `-c core.hooksPath=/dev/null` *before* the subcommand. Assert the stub
  runner's received args for a clone and a checkout.
- **`runCommand` exit code** — run a real command that exits non-zero (e.g. `git`
  with a bogus subcommand) and assert the rejected error has `.code` set. (One
  integration-style case using the real `runCommand`.)
- **`branchExists` tri-state** — stub resolves → `true`; rejects `{code:1}` →
  `false`; rejects `{code:128}` (and a generic error) → `assert.rejects`.
- **`countCommitsAhead` propagation** — stub resolves `'3'` → `3`; rejects →
  `assert.rejects` (NOT `0`).
- **regression** — the resume happy path (existing recovery test) still passes
  with the hook-disabled, tri-state git calls.

## Out of scope (later fix-#4 pieces)

- In-session `AUTO_MERGE`; `context:fork` gate-mechanism cleanup;
  concurrency-cap enforcement; `publish-to-jira.js`. Each is independent and gets
  its own spec/plan.
