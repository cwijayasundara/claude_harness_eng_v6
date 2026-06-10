---
name: change
description: Change the behavior of existing code — story-driven by default, or --issue N for a GitHub bug fix. Test-first, full verification, code review.
argument-hint: "[description | story-id | --issue N]"
context: fork
---

# Change Skill — Behavior Change on Existing Code

One lane for changing what existing code *does*: adding to or altering observable behavior (story-driven), or fixing a reported bug (`--issue N`). For changes that must **not** alter behavior, use `/refactor`. For a tiny low-risk edit (≤3 files, <150 lines, no auth/API/persistence), use `/vibe`.

## Usage

```
/change "add confidence scores to extraction"   # story-driven enhancement
/change E2-S3                                    # implement an existing story
/change --issue 42                               # fix GitHub issue #42
```

- **Description or story ID** → story-driven mode (Steps S1–S7). The change is traceable to a story with acceptance criteria.
- **`--issue N`** → issue mode (Steps I1–I9). The change is a test-first bug fix that branches, reproduces, fixes, and opens a PR.

Both modes are **test-first**: no production code changes until a test that captures the desired behavior (or reproduces the bug) has been written and observed failing.

> **/goal tip (optional unattended iteration):** On Claude Code v2.1.139+ you can let `/goal` drive this single bounded session toward a verifiable condition — e.g. `/goal pytest exits 0 and lint is clean, or stop after N turns` (issue mode: `/goal the failing repro test now passes and lint is clean, or stop after N turns`). Always include the "or stop after N turns" safety clause, and phrase conditions so each turn must produce *fresh* evidence (re-run the tests, show the exit code) to avoid false-positive completion. `/goal`'s evaluator (Haiku) only judges what is in the transcript — it does **not** run tools or read files — so the proof (test output, exit codes) must be printed in the conversation, not routed through subagents. That makes `/goal` suitable for this small lane only. Do **not** use `/goal` inside `/auto`. `/goal` does not replace the evaluator/sprint-contract gate.

---

## Story-driven mode (default)

### Step S1 — Ensure a Story Exists

Every behavior change must have a story file in `specs/stories/` before implementation begins.

- If a story ID was provided (e.g. `E2-S3`): read `specs/stories/E2-S3.md` and confirm it has acceptance criteria.
- If a description was provided: check for a matching story. If none exists, create `specs/stories/{next-id}.md` with Title, Problem statement, Acceptance criteria (numbered, each testable), and Out of scope (explicit).

Do not proceed until acceptance criteria are written and confirmed.

### Step S2 — Impact Assessment

Read the current codebase to understand what is affected:

- **Brownfield map:** if `specs/brownfield/` exists, read `codebase-map.md`, `architecture-map.md`, `test-map.md`, `risk-map.md`, and `change-strategy.md` before assessing impact. If this is a non-trivial existing codebase and the brownfield map is missing, recommend `/brownfield` first.
- **Affected files:** which source files implement the functionality being changed?
- **Affected API contracts:** does this change any request/response shape, endpoint signature, or event payload?
- **Existing test coverage:** run the current suite. Record which tests cover the affected files — these must keep passing (with updates where behavior changes intentionally).
- **Downstream consumers:** does any other module, service, or UI component depend on the behavior being changed?

Document this assessment before writing any code.

### Step S3 — Consult Architecture Docs

Read `specs/design/` for relevant architecture decisions and `.claude/skills/code-gen/references/architecture.md` for layering rules. Confirm the planned implementation stays within the correct layer (new type → `types/`, new query → `repository/`, …). Do not shortcut layers.

### Step S4 — Write the Failing Test(s) First

For each acceptance criterion, **write or update the test before the implementation, and observe it fail (red)**:

- If an existing test covers the old behavior and the behavior is changing: update it to assert the *new* expected behavior, then run it and confirm it fails against the current code. Add a comment noting which AC it covers.
- If no test covers the criterion: add a new test and confirm it fails for the right reason (feature missing — not a typo).

A test that passes before the change is not exercising the new behavior. Changing a test to pass rather than fixing the code is never acceptable — the test is the specification.

### Step S5 — Implement Changes

Modify the existing implementation files until the red tests go green. Do not create parallel implementations.

- Modify in place. No `_v2` function alongside the original.
- If a function signature changes, update all call sites before committing.
- If an API contract changes, update the schema definition and all serializers.
- Keep changes scoped to what the acceptance criteria require.

Run the full test suite — all tests must pass. If `specs/test_artefacts/` exists, update `test-cases.md`/`test-data/`; if Playwright E2E specs exist in `e2e/`, update the affected files.

### Step S6 — Review

Spawn the `clean-code-reviewer` agent (plugin-provided; recognized by the `review-on-stop` Stop hook) on the full diff. **If the diff touches authentication, authorization, secrets, user input handling, or data persistence, also spawn the `security-reviewer` agent** (run both in parallel in a single message).

Findings: **BLOCK** must be fixed; **WARN** should be fixed (document if deferring); **INFO** optional. Maximum 3 retry cycles for BLOCK findings — if any remain after 3 cycles, stop and report.

### Step S7 — Update Story File

Add an implementation status section to the story file:

```markdown
## Implementation Status

Status: COMPLETE
Implemented: {date}
Files changed: {list of files}
Tests added/updated: {list of test files}
AC coverage:
  - AC1: covered by test {test name}
  - AC2: covered by test {test name}
```

---

## Issue mode (`--issue N`)

### Step I1 — Read the Issue

```
gh issue view {n}
```

Read the full issue: title, body, labels, linked issues, comments. Extract the specific failure, any reproduction steps, and any stated acceptance criteria. If the issue is too vague to reproduce, stop and request clarification (`gh issue comment {n} --body "..."`). Do not proceed with a vague issue.

### Step I2 — Systematic Debugging

Before writing any fix, invoke `superpowers:systematic-debugging` to diagnose the root cause. This prevents jumping to conclusions and informs both the failing test (I4) and the fix (I5).

### Step I3 — Create a Branch

```
git checkout -b fix/{short-description}
```

Base the name on the issue title — short, lowercase, hyphenated (e.g. `fix/order-total-rounding`).

### Step I4 — Write a Failing Test, Verify It Fails

Before touching production code, write a test that directly exercises the reported failure. It must live in the affected module's test directory, have a name describing the bug, and **fail when run against the current code**. Run it in isolation and confirm the red state with the expected error. If it passes, it does not reproduce the bug — revise it.

### Step I5 — Fix the Root Cause

Read the affected code, identify the root cause (not the symptom), and make the minimal change to fix it. Do not refactor unrelated code, add features, or change behavior outside the issue's scope.

### Step I6 — Run the Full Test Suite

Run the affected module's tests and the full suite. Every previously passing test must still pass. Do not comment out or delete tests to make the suite pass.

### Step I7 — Lint and Type Checks

Run the project's lint and type checks (`npm run lint`, `mypy`, `tsc --noEmit`, …) and fix anything introduced by the change.

### Step I8 — Review

Spawn the `clean-code-reviewer` agent on the diff; if the fix touches auth, secrets, user input, or persistence, also spawn `security-reviewer`. Resolve BLOCK findings (max 3 cycles).

### Step I9 — Commit and Open a PR

```
git add {changed files}
git commit -m "fix: {description} (closes #{n})"
gh pr create --title "fix: {description}" --body "..."
```

Stage only the files changed for this fix. The PR body must include `Closes #{n}`, the root cause, the fix approach, and confirmation that the reproducing test now passes.

---

## Distinction from /refactor

| Dimension | /change | /refactor |
|-----------|---------|-----------|
| Behavior change | Yes — intentional | No — must be zero |
| Requires story / issue | Yes (story or `--issue N`) | No |
| Tests | Written/updated red-first to match new behavior | Must pass unchanged |
| API contracts | May change | Must not change |

If you are not changing observable behavior, use `/refactor` instead.

---

## Output

| Artefact | Purpose |
|----------|---------|
| `specs/stories/{id}.md` (story mode) | Story with AC and implementation status |
| `fix/{description}` branch + PR (issue mode) | Review-ready change set with `Closes #{n}` |
| Failing test (now passing) | Proof the new behavior / fix is exercised |
| Modified source + updated tests | The change and its verification |

---

## Gotchas

- **No story / vague issue.** Never implement without written acceptance criteria or a reproducible issue. Write the story or request clarification first.
- **Test does not actually fail first.** A test that passes before the change is not exercising it. Verify the red state in both modes.
- **Updating tests to pass instead of fixing code.** Tests define expected behavior; a failing test after a change means the implementation is wrong — unless the AC explicitly changes that behavior.
- **Fixing symptoms, not root cause** (issue mode). A null check that hides an upstream data problem is not a fix. Trace to the actual source.
- **Scope creep.** Stick to the AC / issue. Open new stories or issues for adjacent work rather than bundling it.
- **Not updating API contracts.** If a response shape changes, update the interface/model, the serializer, the OpenAPI spec, and any clients. Partial updates cause runtime failures.
- **Creating parallel paths.** Adding `get_extraction_v2()` alongside `get_extraction()` is dead code. Modify in place and update callers.
- **Incomplete staging** (issue mode). Stage every file that is part of the fix; a partial commit leaves the branch broken.
