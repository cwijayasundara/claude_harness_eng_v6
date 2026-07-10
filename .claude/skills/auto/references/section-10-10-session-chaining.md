## SECTION 10: Session Chaining

`claude-progress.txt` is the memory bridge between context windows. Each iteration appends a new session block.

### Format

```
=== Session {N} ===
date: {ISO 8601}
mode: {full|lean}
groups_completed: [A, B, C]
groups_remaining: [D, E, F]
current_group: D (extraction)
current_stories: [E4-S1, E4-S2]
sprint_contract: sprint-contracts/group-D.json
last_commit: {hash} "{message}"
features_passing: 47 / 203
coverage: 82%
learned_rules: 6
blocked_stories: none
next_action: Run evaluator against group D
```

### Rules

- **Append, never overwrite.** Each session block is added after the previous one. The file is an append-only log.
- **Read the LAST block** for recovery. When context recovery (SECTION 2) reads this file, it parses only the final session block to determine current state.
- **Session number increments monotonically.** Parse the last session number and add 1.
- **`next_action` is critical.** This field tells a fresh context window exactly what to do first. Be specific: "Run evaluator against group D" is good. "Continue" is not.
- **Include `blocked_stories`** if any stories failed 3 consecutive self-heal attempts. Format: `[E4-S3 (import error), E5-S1 (docker fail)]`.

### SECTION 10.1: Single-wave mode (`--once`) — cross-process handoff

When invoked with `--once`, `/auto` performs **one** pass of the loop and then stops, instead of iterating until all features pass:

1. Run Context Recovery (SECTION 2) and select the current wave exactly as normal.
2. Execute that one wave through Sprint Contract negotiation, agent-team build, all 8 ratchet gates, and pass/fail handling (SECTIONS 3–6) — unchanged.
3. On a clean wave, **commit** and **append the session block** (SECTION 10 format) — this is the durable checkpoint.
4. Set `next_action` precisely so a fresh process can continue with zero ambiguity:
   - If `features.json` now has every feature passing (or no groups remain): `next_action: DONE — all groups complete` and `groups_remaining: []`.
   - Otherwise: `next_action: CONTINUE — next wave: [<group ids>]` with an accurate `groups_remaining: [...]`.
5. **Exit the turn** — do not loop back to SECTION 2.

This is the voluntary-yield boundary the chain driver relies on: because the process exits cleanly *after* the commit and checkpoint, a per-link timeout/SIGKILL can never land mid-write. Do **not** rely on the `auto-continue-on-stop` hook here — `--once` is driven across processes, not nudged within one; the driver owns re-spawning.

---
