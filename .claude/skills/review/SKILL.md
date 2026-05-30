---
name: review
description: Run evaluator and security reviewer concurrently for comprehensive quality gate.
argument-hint: "[story-id]"
context: fork
---

# Review Skill

Run a comprehensive quality gate by spawning the evaluator and security reviewer as concurrent agents. Both must pass before the group is considered ready for merge.

> **Ultracode tip:** Multi-dimension review with adversarial verification is a natural fan-out, so `/effort ultracode` pays off on this plain skill form. The dynamic-workflow form (`/harness-review`) already fans out — don't run both at full effort.

---

## Usage

```
/review
/review E3-S1
```

With no argument: reviews the current group in context.
With a story ID: reviews the specific story and its group.

---

## Execution Steps

### Step 1 — Spawn Both Agents Concurrently

Use the Agent tool to spawn both agents **at the same time** in a single call. Do not run them sequentially — concurrent execution is the point of this skill.

**Agent 1 — evaluator**
- Runs all sprint contract checks (API, Playwright, architecture).
- Output: writes `specs/reviews/evaluator-report.md`.
- Updates `features.json` with pass/fail verdicts.

**Agent 2 — security-reviewer**
- Scans changed files for security issues (injection, auth bypass, secrets in code, insecure dependencies, unsafe deserialization, missing input validation).
- Output: writes `specs/reviews/security-review.md` (prose) **and** `specs/reviews/security-verdict.json` (machine-readable).
- Reports findings at three severity levels. BLOCK = critical/high (the same verdict `/evaluate` and `/auto` gate on); WARN = medium; INFO = low.

Both agents run against the same set of changed files and the same group context.

---

## Findings Severity Levels

| Level | Meaning                              | Action Required       |
|-------|--------------------------------------|-----------------------|
| BLOCK | Must be fixed before merge           | Self-healing loop     |
| WARN  | Should be fixed; does not block      | Log and track         |
| INFO  | Optional improvement                 | No action required    |

Do not treat WARN as BLOCK. Do not treat INFO as WARN. The severity assigned by the reviewer is final unless the reviewer is re-run after a fix.

---

## Self-Healing Loop (BLOCK Findings)

If either agent reports one or more BLOCK findings:

1. Collect all BLOCK findings from both reports.
2. Spawn the `generator` agent with:
   - The full list of BLOCK findings (file path, line reference, description).
   - The story acceptance criteria for context.
   - Instruction to fix the issues without introducing new functionality.
3. After the generator completes, re-run the full `/review` cycle (both agents concurrently).
4. If BLOCK findings persist after **3 retry cycles**, escalate to the user with:
   - The outstanding BLOCK findings.
   - A summary of what was attempted.
   - Suggested manual intervention steps.

Do not merge or mark a group complete while any BLOCK finding remains open.

---

## Mode Behavior

| Mode  | Evaluator     | Security Reviewer |
|-------|--------------|-------------------|
| Full  | Run          | Run               |
| Lean  | Run          | Run               |
| Solo  | Skip         | Run               |

In Solo mode, only the security-reviewer runs. The evaluator is skipped because there is no running application stack. Print a note: "Solo mode: evaluator skipped, security review only."

---

## Output Files

After both agents complete (or in Solo mode, after the security reviewer completes):

- `specs/reviews/evaluator-report.md` — overall PASS/FAIL verdict with per-check detail.
- `specs/reviews/security-review.md` — human-readable list of BLOCK/WARN/INFO findings with file references.
- `specs/reviews/security-verdict.json` — the machine-readable security verdict (`pass`, `block_severities`, `findings[]`). This is the **canonical** security artifact.

All three files must exist before the review cycle is considered complete. If either agent fails to produce its output, treat that as a BLOCK finding.

## Canonical ownership (vs `/evaluate`)

The security gate has **one** canonical definition — the `security-reviewer` agent's `security-verdict.json` (block on critical/high). There are two entry points to it, and they are not duplicate scans:

- **`/evaluate` Layer 4 / `/auto` Gate 7** — the security gate *inside* the build loop. This is the authoritative in-pipeline owner.
- **`/review`** — the *on-demand, pre-merge* gate that runs the evaluator + security-reviewer together. Use it for a manual quality gate or in **Solo mode**, where `/evaluate` is a no-op and `/review` is the *only* security gate.

Both consume the same `security-verdict.json` with identical semantics. Do not treat `/review` and `/evaluate` as two different gates — run whichever entry point fits the moment; in `/auto`, Layer 4/Gate 7 already covers it, so a separate `/review` is only needed for manual or Solo gating.

---

## Gotchas

- **Not running both agents concurrently:** The whole purpose of this skill is parallel execution. Spawning them sequentially doubles the wall-clock time and provides no benefit. Always use the Agent tool with both agents in a single call.
- **Accepting WARN as BLOCK:** WARN findings are real issues worth fixing, but they do not block merge. Treating them as BLOCK creates unnecessary churn. Log them in a follow-up story if they are not addressed immediately.
- **Not re-running after fixes:** After the generator addresses BLOCK findings, the full review must run again. Assuming the fix is correct without re-verification defeats the purpose of the quality gate.
- **Partial reviews:** Every changed file in the group must be in scope for both agents. Do not pass a subset of files to avoid findings.
- **Security findings in test files:** Security issues in test code (hardcoded credentials, insecure randomness) are real findings and must be fixed. Test code ships to version control and can leak to production environments.
