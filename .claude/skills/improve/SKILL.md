---
name: improve
description: Enhance existing features through story-driven development with full verification.
argument-hint: "[description or story-id]"
context: fork
---

# Improve Skill — Story-Driven Feature Enhancement

## Usage

```
/improve "add confidence scores to extraction"
/improve E2-S3
```

Provide either a plain description of the improvement or an existing story ID from `specs/stories/`. Improvements change observable behavior and require a story with acceptance criteria.

---

## Overview

Improvements intentionally change behavior. This distinguishes them from `/refactor`, which must not change behavior. Every improvement is traceable to a story, has acceptance criteria, and requires tests to be updated or added.

For tiny low-risk behavior changes that do not need a new product story, use `/vibe` instead. If the change introduces a new user workflow, public API behavior, persistence behavior, or acceptance criteria that product stakeholders would care about, stay in `/improve`.

---

## Steps

### Step 1 — Ensure a Story Exists

Every improvement must have a story file in `specs/stories/` before implementation begins.

If a story ID was provided (e.g., `E2-S3`): read `specs/stories/E2-S3.md` and confirm it has acceptance criteria.

If a description was provided: check whether a matching story already exists. If not, create `specs/stories/{next-id}.md` with:
- Title
- Problem statement (why this improvement)
- Acceptance criteria (numbered list, each criterion testable)
- Out of scope (explicit)

Do not proceed to implementation until acceptance criteria are written and confirmed.

### Step 2 — Impact Assessment

Read the current codebase to understand what is affected:

- **Brownfield map:** if `specs/brownfield/` exists, read `codebase-map.md`, `architecture-map.md`, `test-map.md`, `risk-map.md`, and `change-strategy.md` before assessing impact. If this is a non-trivial existing codebase and the brownfield map is missing, recommend `/brownfield` unless the change qualifies for `/vibe`.
- **Affected files:** which source files implement the functionality being changed?
- **Affected API contracts:** does this change any request/response shape, endpoint signature, or event payload?
- **Existing test coverage:** run the current test suite. Record which tests cover the affected files. These are the tests that must continue to pass (with updates if behavior changes intentionally).
- **Downstream consumers:** does any other module, service, or UI component depend on the behavior being changed?

Document this assessment before writing any code.

### Step 3 — Consult Architecture Docs

Read `specs/design/` for any architecture decisions relevant to the change. Read `.claude/skills/architecture/SKILL.md` for layering rules.

Confirm the planned implementation stays within the correct layer. If the improvement requires a new type, add it to the `types/` layer. If it requires a new DB query, add it to `repository/`. Do not shortcut layers.

### Step 4 — Implement Changes

Modify the existing implementation files. Do not create parallel implementations alongside existing ones.

Rules:
- Modify in place. Do not add a `_v2` function alongside the original.
- If a function signature changes, update all call sites before committing.
- If an API contract changes, update the schema definition and all serializers.
- Keep changes scoped to what the acceptance criteria require.

### Step 5 — Update and Add Tests

For each acceptance criterion in the story:
- If an existing test covers the old behavior and the behavior is changing: update the test to match the new expected behavior. Add a comment noting which AC the update corresponds to.
- If no existing test covers the criterion: add a new test.

Changing a test to pass rather than fixing the underlying code is not acceptable. The test is the specification. If the test fails because the implementation is wrong, fix the implementation.

Run the full test suite. All tests must pass.

### Step 6 — Spawn code-reviewer

Spawn the `code-reviewer` agent on the full diff.

Findings:
- **BLOCK** — must fix before this improvement is shippable.
- **WARN** — should fix; document if deferring with justification.
- **INFO** — optional.

Maximum 3 retry cycles for BLOCK findings. If BLOCK findings remain after 3 cycles, stop and report.

### Step 7 — Update Story File

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

## Distinction from /refactor

| Dimension | /improve | /refactor |
|-----------|----------|-----------|
| Behavior change | Yes — intentional | No — must be zero |
| Requires story | Yes | No |
| Tests | Updated to match new behavior | Must pass unchanged |
| API contracts | May change | Must not change |

If you are not changing observable behavior, use `/refactor` instead.

---

## Output

| Artefact | Purpose |
|----------|---------|
| `specs/stories/{id}.md` | Story with AC and implementation status |
| Modified source files | Implementation of the improvement |
| Updated/added tests | Verification of each acceptance criterion |

---

## Gotchas

- **No story.** Never implement an improvement without written acceptance criteria. If the story does not exist, write it first.
- **Scope creep.** Stick to the acceptance criteria in the story. If you identify adjacent improvements, open new stories rather than bundling them.
- **Updating tests to pass instead of fixing code.** Tests define expected behavior. A failing test after an improvement means the implementation is wrong, not the test — unless the AC explicitly changes that behavior.
- **Not updating API contracts.** If a response shape changes, update the TypeScript interface or Pydantic model, the serializer, the OpenAPI spec, and any clients. Partial contract updates cause runtime failures.
- **Creating parallel paths.** Adding a `get_extraction_v2()` function alongside `get_extraction()` creates dead code and confusion. Modify the existing function and update its callers.
