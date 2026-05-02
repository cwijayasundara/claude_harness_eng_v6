---
name: review
description: Run evaluator and security reviewer concurrently for comprehensive quality gate.
argument-hint: "[story-id]"
context: fork
---

# Review Skill

Run a comprehensive quality gate by spawning the evaluator and security reviewer as concurrent agents. Both must pass before the group is considered ready for merge.

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
- Output: writes `specs/reviews/security-review.md`.
- Reports findings at three severity levels.

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
- `specs/reviews/security-review.md` — list of BLOCK/WARN/INFO findings with file references.

Both files must exist before the review cycle is considered complete. If either agent fails to produce its output file, treat that as a BLOCK finding.

---

## Gotchas

- **Not running both agents concurrently:** The whole purpose of this skill is parallel execution. Spawning them sequentially doubles the wall-clock time and provides no benefit. Always use the Agent tool with both agents in a single call.
- **Accepting WARN as BLOCK:** WARN findings are real issues worth fixing, but they do not block merge. Treating them as BLOCK creates unnecessary churn. Log them in a follow-up story if they are not addressed immediately.
- **Not re-running after fixes:** After the generator addresses BLOCK findings, the full review must run again. Assuming the fix is correct without re-verification defeats the purpose of the quality gate.
- **Partial reviews:** Every changed file in the group must be in scope for both agents. Do not pass a subset of files to avoid findings.
- **Security findings in test files:** Security issues in test code (hardcoded credentials, insecure randomness) are real findings and must be fixed. Test code ships to version control and can leak to production environments.
