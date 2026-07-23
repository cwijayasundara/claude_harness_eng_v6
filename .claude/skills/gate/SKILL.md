---
name: gate
description: "Run the adaptive pre-merge quality gate: deterministic checks, evaluator, diff review, and security review only when the diff crosses a security/data/API boundary. (Renamed from /review to avoid colliding with Claude Code's native /review PR-review command.)"
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
- **code-reviewer** — always for `/gate`. Fresh-context review of the diff for both structure and correctness; writes `specs/reviews/code-review-verdict.json`.
- **security-reviewer** — only when the changed files touch auth/authz, secrets, user input handling, uploads/downloads, network fetch/redirect/proxy code, payments/billing, persistence/schema/migrations, API routes/controllers/middleware, or configured security patterns. Writes `specs/reviews/security-review.md` and `specs/reviews/security-verdict.json`.

- **Bounded re-verification when the security trigger fires (Devin-parity hardening, 2026-07-09).** When the security trigger above fires, spawn **2 additional independent instances** each of `evaluator` and `security-reviewer` (3 total per axis, including the always-on evaluator spawn and the triggered security-reviewer spawn above) — fresh context per instance via the `Agent` tool, no shared conversation between instances. Each instance runs its full existing process unmodified. Resolve each axis independently by majority vote (2-of-3): security PASS/BLOCK and functional PASS/FAIL can legitimately disagree. If an instance errors or times out instead of returning a verdict, fail safe to the stricter outcome (BLOCK/FAIL) for that axis. The existing `specs/reviews/security-verdict.json` and the evaluator's own verdict output are written exactly as before, sourced from the first-spawned instance of each — every existing consumer is unaffected. Additionally write `specs/reviews/reverify-votes.json`:
  ```json
  {
    "gate": "gate-reverify",
    "trigger": "security-boundary",
    "security": { "votes": ["pass", "pass", "fail"], "majority": "pass", "fail_safe_triggered": false },
    "functional": { "votes": ["pass", "pass", "pass"], "majority": "pass", "fail_safe_triggered": false },
    "timestamp": "<ISO 8601>"
  }
  ```
  This file is an audit trail only — no existing gate logic reads it. Scoped to `/gate` only; `/auto`'s per-group Gate 7 keeps its existing single-pass security review unchanged.

- **Pack-contributed deterministic checks — run them all with one command:**

  ```bash
  node .claude/scripts/run-gate-checks.js --files <changed files>
  ```

  The check set is **data**, not prose: `.claude/config/gate-checks.json` declares each check,
  the pack that owns it, when it fires, whether it blocks, and the remediation to print when it
  does. The runner writes `specs/reviews/gate-checks.json` and exits non-zero if any blocking
  check blocked — that is a **BLOCK** under the usual semantics.

  Today that covers approved-fixtures and contract-drift (verification), cycle / coupling /
  duplication ratchets (brownfield), canvas-sync, canvas-semantic and ownership (planning),
  the full regression suite, observability and perf-smell (verification), deep-mutation, and
  sensor-waiver validation (telemetry).

  **Do not name these scripts individually here.** A check whose pack is not installed is
  reported as `skipped: pack not installed` — visible and attributable, never silently dropped
  and never counted as a pass. That is the whole point of the registry: uninstalling a pack
  removes its checks, instead of leaving this skill instructing you to run a script that is gone.
  To add or change a check, edit the registry, not this file.

If any finding is being suppressed or threshold-bumped via `specs/reviews/sensor-waivers.json`, first run `npm run sensor-waivers`. It validates required waiver fields and expiry rules against `.claude/templates/sensor-waivers.schema.json`; an `invalid` verdict is a **BLOCK** until the waiver is fixed or removed. Missing waiver file is `no-waivers` and passes.

When a security trigger fires, also run the **computational security scan** (gap G3) as the deterministic complement to the inferential `security-reviewer` — the two are partners, not substitutes: `node .claude/scripts/security-scan.js --all --staged --boundary-only`. It runs gitleaks (secrets), semgrep (SAST), and `npm audit`/`pip-audit` (dependency CVEs) where those tools are provisioned, skipping each one loudly otherwise (never silently). It writes `specs/reviews/security-scan.json`; a non-zero exit (findings at or above the `--threshold`, default `high`) is a **BLOCK** under the same semantics as the reviewers. Always-available baseline secrets are already enforced at commit by the pre-commit hook; this step adds the external-tool tiers.

If no security trigger fired, run neither `security-reviewer` nor the computational scan; record `security_review: skipped_no_boundary` in the context pack instead.

### Step 2.5 — Static production-readiness gates

The observability ratchet (BLOCK-level swallowed exceptions / empty catches) and the
perf-smell gate (N+1-in-loop, sync-in-async) are registry checks — Step 2's runner already
executed them and recorded their verdicts. They are listed here only so the sequence reads
completely; do **not** invoke them separately.

Pass only production source in `--files`. When the diff has zero production source files
(docs-only / pure test), pass none and record the skip in the context pack.

### Step 3 — Apply the Canonical Gate Semantics

Severity levels (BLOCK/WARN/INFO), the BLOCK self-healing loop (generator fix → full re-run, max 3 cycles, then escalate), and the security verdict format are defined once in `/evaluate` (`.claude/skills/evaluate/SKILL.md`) — follow them exactly from there. Do not merge or mark a group complete while any BLOCK finding remains open, and always re-run the full review after fixes.

### Step 4 — Human trust surfaces (always, end of gate)

After all reviewers and static gates settle (including after fix cycles), **always** emit the human-facing receipts. Missing these is itself a BLOCK for PR-open:

1. **Logical walkthrough:** `node .claude/scripts/pr-walkthrough.js --base <git-base-or-omit>`
   - Writes `specs/reviews/walkthrough.md` + `walkthrough.json` (Devin Review–class: logical groups, severity, blast radius, 5-minute review script).
2. **Quality card:** `node .claude/scripts/quality-card.js --range <base..head>`
   - Writes `specs/reviews/quality-card.md` + `quality-card.json` and stamps `.claude/state/gate-receipt.json`.
   - Aggregates evaluator, code-review, security, observability, perf-smell, regression, ownership, etc.
3. **Human homepage (refresh):** `node .claude/scripts/human-codebase.js` (idempotent; keeps `docs/CODEBASE.md` current).

A quality-card with `pass: false` or missing core inputs (evaluator report / code-review verdict) means the gate is not green — do not open a PR.

## Output Files

- `specs/reviews/evaluator-report.md` — PASS/FAIL with per-check detail
- `specs/reviews/code-review.md` and `specs/reviews/code-review-verdict.json` — fresh-context structure + correctness review
- `specs/reviews/security-review.md` and `specs/reviews/security-verdict.json` — only when a security trigger fired
- `specs/reviews/security-scan.json` — computational security scan (secrets/SAST/deps) result; only when a security trigger fired
- `specs/reviews/reverify-votes.json` — 3-instance majority-vote audit trail; only when a security trigger fired
- `specs/reviews/canvas-sync-check.md` — living-design sync result when a REASONS Canvas exists
- `specs/reviews/ownership-check.json` — file-ownership sensor result when a component-map.md exists
- `specs/reviews/regression-gate-verdict.json` — accumulated e2e + prior sprint-contract regression result when `e2e/` or `sprint-contracts/` exists
- `specs/reviews/sensor-waivers-verdict.json` — waiver validation result when waivers are present or checked
- `specs/reviews/review-context-pack.md` — compact shared review input
- `specs/reviews/observability-verdict.json` — static logging/exception ratchet (Step 2.5)
- `specs/reviews/perf-smell-verdict.json` — static perf smell ratchet (Step 2.5)
- `specs/reviews/walkthrough.md` + `walkthrough.json` — logical PR walkthrough for humans (Step 4)
- `specs/reviews/quality-card.md` + `quality-card.json` — single trust receipt (Step 4)
- `docs/CODEBASE.md` — human homepage refresh (Step 4)

Every selected output must exist before the review is complete; a missing selected output is itself a BLOCK finding.

## Canonical ownership (vs `/evaluate`)

There are two entry points to the same gate, not two gates:

- **`/evaluate` Layer 4 / `/auto` Gate 7** — the authoritative in-pipeline owner.
- **`/gate`** — the on-demand pre-merge entry point (this skill).

In `/auto`, Gate 7 already covers it — a separate `/gate` is only needed for manual gating before a merge.
