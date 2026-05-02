---
name: fix-issue
description: Standard GitHub issue workflow. Branch, reproduce, fix, test, PR.
argument-hint: "[#issue-number]"
context: fork
---

# Fix Issue Skill — GitHub Issue Workflow

## Usage

```
/fix-issue #42
```

Provide the GitHub issue number. The skill reads the issue, branches, reproduces the bug, fixes it, and opens a PR.

---

## Overview

This skill enforces a test-first bug fix workflow. The fix is not complete until a test that previously failed now passes, and the full suite still passes.

For tiny, low-risk bugs with a clear reproduction and a likely 1-3 file fix, consider `/vibe` first. Use `/fix-issue` when the bug comes from a tracker issue, requires branching/PR workflow, has unclear root cause, touches risky behavior, or needs full regression discipline.

---

## Steps

### Step 1 — Read the Issue

```
gh issue view {n}
```

Read the full issue: title, body, labels, linked issues, and comments. Extract:
- The specific failure or unexpected behavior described.
- Any reproduction steps provided.
- Any acceptance criteria or expected behavior stated.

If the issue is too vague to reproduce (no steps, no expected vs actual behavior), stop and post a comment requesting clarification:

```
gh issue comment {n} --body "..."
```

Do not proceed with a vague issue.

### Step 1.5 — Systematic Debugging with Superpowers

Before writing any fix, invoke `superpowers:systematic-debugging` to diagnose the root cause. This prevents jumping to conclusions and ensures you understand the actual failure mechanism before proposing a solution. The debugging output informs both the failing test (Step 3) and the fix (Step 5).

### Step 2 — Create a Branch

```
git checkout -b fix/{short-description}
```

Use the issue title as the basis for the branch name. Keep it short and lowercase with hyphens. Example: `fix/order-total-rounding`.

### Step 3 — Write a Failing Test

Before touching any production code, write a test that directly exercises the reported failure.

The test must:
- Live in the appropriate test directory for the affected module.
- Have a name that describes the bug: `"returns correct total when discount is applied"`.
- Fail when run against the current code.

Do not write a test that is trivially true or tests something other than the reported bug.

### Step 4 — Verify the Test Fails

Run the test in isolation and confirm it fails with the expected error.

If the test passes against the current code, the test does not reproduce the bug. Revise the test before continuing.

### Step 5 — Fix the Root Cause

Read the affected code. Identify the root cause of the failure — not the symptom.

Make the minimal change needed to fix the root cause. Do not:
- Refactor unrelated code.
- Add new features.
- Change behavior outside the scope of the issue.

### Step 6 — Run the Full Test Suite

Run all tests for the affected module and the full test suite.

Every test that passed before this change must still pass. If new failures appear, fix them before proceeding. Do not comment out or delete tests to make the suite pass.

### Step 7 — Run Lint and Type Checks

Run the project's lint and type check commands (e.g., `npm run lint`, `mypy`, `tsc --noEmit`).

Fix any issues introduced by the change.

### Step 8 — Commit

```
git add {changed files}
git commit -m "fix: {description} (closes #{n})"
```

Stage only the files changed for this fix. Do not include unrelated modifications.

### Step 9 — Open a Pull Request

```
gh pr create --title "fix: {description}" --body "..."
```

The PR body must include:
- A reference to the issue: `Closes #{n}`
- A description of the root cause.
- A description of the fix approach.
- Confirmation that the reproducing test now passes.

---

## Output

| Artefact | Purpose |
|----------|---------|
| `fix/{description}` branch | Isolated fix branch |
| Failing test (now passing) | Proof of reproduction and resolution |
| PR | Review-ready change set with issue link |

---

## Gotchas

- **Vague issues.** Never guess at what a bug is. Ask for clarification if reproduction steps are missing.
- **Test does not actually fail first.** A test that passes before the fix is not a reproducing test. Verify the red state.
- **Fixing symptoms, not root cause.** A null check that hides an upstream data problem is not a fix. Trace to the actual source of incorrect behavior.
- **Incomplete staging.** Committing only some changed files leaves the branch in a broken state. Stage every file that is part of the fix.
- **Scope creep.** If you notice other bugs or improvement opportunities while fixing, open new issues rather than including the changes here.
