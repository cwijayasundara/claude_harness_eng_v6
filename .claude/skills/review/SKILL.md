---
name: review
description: Run evaluator and security reviewer concurrently for comprehensive quality gate.
argument-hint: "[story-id]"
context: fork
---

# Review Skill

On-demand, pre-merge entry point to the harness's **one** quality gate: it spawns the same `evaluator` + `security-reviewer` agents that `/evaluate` (Layer 4) and `/auto` (Gate 7) run in-pipeline, with identical verdict semantics. This skill owns only the on-demand orchestration; the gate's definitions live in `/evaluate`.

> **Ultracode tip:** Multi-dimension review with adversarial verification is a natural fan-out, so `/effort ultracode` pays off on this plain skill form.

## Usage

```
/review            # reviews the current group in context
/review E3-S1      # reviews a specific story and its group
```

## Execution

### Step 1 — Spawn Both Agents Concurrently

Use the Agent tool to spawn both agents **in a single call** — concurrent execution is the point of this skill:

- **evaluator** — runs all sprint contract checks (API, Playwright, architecture); writes `specs/reviews/evaluator-report.md` and updates `features.json`.
- **security-reviewer** — scans the changed files; writes `specs/reviews/security-review.md` and the canonical `specs/reviews/security-verdict.json`.

Both agents get the same changed-file set and group context. Every changed file in the group is in scope for both — never pass a subset to avoid findings.

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
- **`/review`** — the on-demand pre-merge entry point (this skill).

In `/auto`, Gate 7 already covers it — a separate `/review` is only needed for manual gating before a merge.
