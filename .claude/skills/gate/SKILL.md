---
name: gate
description: Run the adaptive pre-merge quality gate: deterministic checks, evaluator, diff review, and security review only when the diff crosses a security/data/API boundary. (Renamed from /review to avoid colliding with Claude Code's native /review PR-review command.)
argument-hint: "[story-id]"
context: fork
---

# Gate Skill

On-demand, pre-merge entry point to the harness's **one** quality gate. It keeps deterministic verification mandatory, then runs the smallest model-review set that protects the change: evaluator + fresh diff review by default, with security review added only when the touched files cross a security, data, network, auth, payment, upload, or public API boundary. This skill owns only the on-demand orchestration; the gate's verification definitions live in `/evaluate`.

> **Ultracode tip:** Multi-dimension review with adversarial verification is a natural fan-out, so `/effort ultracode` pays off on this plain skill form.

## Usage

```
/gate            # reviews the current group in context
/gate E3-S1      # reviews a specific story and its group
```

> **Not** Claude Code's native `/review` (which reviews a GitHub PR). This is the harness's
> local pre-merge quality gate. See the command-boundary notes in `README.md`.

## Execution

### Step 1 — Build the Review Context Pack

Before spawning agents, write or refresh `specs/reviews/review-context-pack.md` with:

- request / story / issue ID
- acceptance criteria
- final diff or commit range
- changed files
- relevant DeepWiki/code-map links
- deterministic test/lint/typecheck output
- risk triggers that decide whether security review is required

Every reviewer reads this pack plus the diff and directly touched files. Do not pass the full build transcript, raw test logs, or unrelated repo files into reviewer prompts.

### Step 2 — Spawn the Minimal Review Set Concurrently

Use the Agent tool to spawn the selected agents **in a single call**:

- **evaluator** — always. Runs sprint contract checks (API, Playwright, architecture); writes `specs/reviews/evaluator-report.md` and updates `features.json`.
- **diff-reviewer** — always for `/gate`. Fresh-context correctness review of the diff only; writes `specs/reviews/diff-review-verdict.json`.
- **security-reviewer** — only when the changed files touch auth/authz, secrets, user input handling, uploads/downloads, network fetch/redirect/proxy code, payments/billing, persistence/schema/migrations, API routes/controllers/middleware, or configured security patterns. Writes `specs/reviews/security-review.md` and `specs/reviews/security-verdict.json`.

If no security trigger fired, do not run `security-reviewer`; record `security_review: skipped_no_boundary` in the context pack instead.

### Step 3 — Apply the Canonical Gate Semantics

Severity levels (BLOCK/WARN/INFO), the BLOCK self-healing loop (generator fix → full re-run, max 3 cycles, then escalate), and the security verdict format are defined once in `/evaluate` (`.claude/skills/evaluate/SKILL.md`) — follow them exactly from there. Do not merge or mark a group complete while any BLOCK finding remains open, and always re-run the full review after fixes.

## Output Files

- `specs/reviews/evaluator-report.md` — PASS/FAIL with per-check detail
- `specs/reviews/diff-review.md` and `specs/reviews/diff-review-verdict.json` — fresh-context correctness review
- `specs/reviews/security-review.md` and `specs/reviews/security-verdict.json` — only when a security trigger fired
- `specs/reviews/review-context-pack.md` — compact shared review input

Every selected output must exist before the review is complete; a missing selected output is itself a BLOCK finding.

## Canonical ownership (vs `/evaluate`)

There are two entry points to the same gate, not two gates:

- **`/evaluate` Layer 4 / `/auto` Gate 7** — the authoritative in-pipeline owner.
- **`/gate`** — the on-demand pre-merge entry point (this skill).

In `/auto`, Gate 7 already covers it — a separate `/gate` is only needed for manual gating before a merge.
