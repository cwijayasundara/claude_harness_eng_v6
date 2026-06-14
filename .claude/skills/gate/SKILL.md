---
name: gate
description: Run evaluator and security reviewer concurrently for the comprehensive pre-merge quality gate. (Renamed from /review to avoid colliding with Claude Code's native /review PR-review command.)
argument-hint: "[story-id]"
context: fork
---

# Gate Skill

On-demand, pre-merge entry point to the harness's **one** quality gate: it spawns the same `evaluator` + `security-reviewer` agents that `/evaluate` (Layer 4) and `/auto` (Gate 7) run in-pipeline, with identical verdict semantics. This skill owns only the on-demand orchestration; the gate's definitions live in `/evaluate`.

> **Ultracode tip:** Multi-dimension review with adversarial verification is a natural fan-out, so `/effort ultracode` pays off on this plain skill form.

## Usage

```
/gate            # reviews the current group in context
/gate E3-S1      # reviews a specific story and its group
```

> **Not** Claude Code's native `/review` (which reviews a GitHub PR). This is the harness's
> local pre-merge quality gate. See the command-boundary notes in `README.md`.

## Execution

### Step 1 — Spawn the Review Agents Concurrently

Use the Agent tool to spawn all three agents **in a single call** — concurrent execution is the point of this skill:

- **evaluator** — runs all sprint contract checks (API, Playwright, architecture); writes `specs/reviews/evaluator-report.md` and updates `features.json`.
- **security-reviewer** — scans the changed files; writes `specs/reviews/security-review.md` and the canonical `specs/reviews/security-verdict.json`.
- **diff-reviewer** — fresh-context correctness review of the diff only; writes `specs/reviews/diff-review-verdict.json`. Give it the commit range and acceptance criteria, nothing else — its value is the empty context.

The evaluator and security-reviewer get the same changed-file set and group context; every changed file in the group is in scope — never pass a subset to avoid findings.

### Step 2 — Apply the Canonical Gate Semantics

Severity levels (BLOCK/WARN/INFO), the BLOCK self-healing loop (generator fix → full re-run, max 3 cycles, then escalate), and the security verdict format are defined once in `/evaluate` (`.claude/skills/evaluate/SKILL.md`) — follow them exactly from there. Do not merge or mark a group complete while any BLOCK finding remains open, and always re-run the full review after fixes.

## Output Files

- `specs/reviews/evaluator-report.md` — PASS/FAIL with per-check detail
- `specs/reviews/security-review.md` — BLOCK/WARN/INFO findings with file references
- `specs/reviews/security-verdict.json` — the **canonical** machine-readable security verdict

All three must exist before the review is complete; a missing output is itself a BLOCK finding.

## Canonical ownership (vs `/evaluate`)

There are two entry points to the same gate, not two gates:

- **`/evaluate` Layer 4 / `/auto` Gate 7** — the authoritative in-pipeline owner.
- **`/gate`** — the on-demand pre-merge entry point (this skill).

In `/auto`, Gate 7 already covers it — a separate `/gate` is only needed for manual gating before a merge.
