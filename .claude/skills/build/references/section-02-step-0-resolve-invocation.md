## Step 0 — Resolve the invocation (run this FIRST, before anything else)

**Do not parse the flags or the PRD path by hand.** Flag order is free (`--lite --auto path` and `path --lite --auto` are identical) and hand-parsing is exactly how a PRD path gets dropped. Resolve the invocation deterministically by running this command **verbatim** — `$ARGUMENTS` is interpolated by the harness to the exact string the user typed after `/build`, so do **not** substitute, retype, or quote it yourself:

```bash
node .claude/scripts/build-lane.js "$ARGUMENTS"
```

**Sanity-check the result before acting on it.** If the JSON comes back `lane: gated` with `prdPath: null` **and** the user's invocation clearly contained a path or flags (e.g. you can see `--lite`/`--auto`/a `.md` path in their message), then `$ARGUMENTS` did not reach the parser — do **not** proceed as a bare gated build. Re-run the parser with the literal invocation string explicitly, and only continue once the resolved `lane`/`prdPath`/flags match what the user actually typed.

It prints JSON. Act on it, do not second-guess it:

- **`valid: false`** → stop and show `error` to the user (e.g. a PRD is required for `--auto`/`--autonomous`/`--plan-only` but none was given). Do not invent scope.
- **`valid: true`** → bind the fields and route by them:
  - `lane` — one of `gated`, `autonomous`, `auto`, `lite`, `lite-autonomous`, `lite-auto`, `finalize`. This selects the phase flow below; do not re-derive it from the raw flags.
  - `prdPath` — the requirements/PRD file. **The positional argument is the PRD even when it follows the flags.** If `requiresPrd: true`, resolve `prdPath` to a readable file now; if it is null or unreadable, stop and ask for the PRD rather than reporting "no requirements came through".
  - `requiresPrd`, `humanGates` (0/1/3), `lite`, `auto`, `autonomous`, `planOnly`, `mode`, `pod` — carry these into the phases; e.g. `humanGates: 0` means full-auto (no Phase 1/2/3/3.5 stops), `humanGates: 1` means the single Phase 3.5 gate.

Only after Step 0 resolves cleanly do you proceed to Phase 0. If the workspace is also in a dirty/ambiguous git state, surface that *in addition to* — not instead of — the resolved lane, so the user sees you understood the command.
