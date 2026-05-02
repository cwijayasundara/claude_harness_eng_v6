---
name: vibe
description: Controlled small-change lane for low-risk fixes, docs, tests, and narrowly scoped edits without running the full SDLC pipeline.
argument-hint: "[brief-change-description]"
context: fork
---

# Controlled Vibe Coding

Use `/vibe` for small, low-risk changes where the full BRD → spec → design → auto pipeline would be disproportionate.

This is not permission to free-code. It is a bounded engineering lane with explicit scope, targeted verification, and reviewer enforcement.

---

## Usage

```text
/vibe "fix typo in empty-state copy"
/vibe "add missing null guard in invoice total"
/vibe "update README install command"
```

---

## Eligibility

Use controlled vibe coding only when all are true:

- The change is understandable in one sentence.
- The expected diff is small: usually 1-3 files, under 150 changed lines.
- The change does not require a new product workflow.
- The change does not alter core architecture, data ownership, auth, permissions, billing, migrations, or public API contracts.
- The affected area can be verified with a targeted command.
- Rollback is simple.

Escalate to `/improve`, `/fix-issue`, `/refactor`, `/spec`, or `/auto` when any are true:

- More than 3 source files are likely to change.
- A new user story, feature, endpoint, table, queue, background job, or external integration is needed.
- The change affects security, privacy, auth, billing, data migrations, or irreversible data operations.
- The fix cannot be reproduced or verified locally.
- Requirements are ambiguous after at most 3 clarification questions.
- The requested work combines multiple independent changes.

---

## Change Classes

| Class | Examples | Required Verification |
|---|---|---|
| CV0 docs/config | docs typo, README command, comments, non-runtime config | `git diff --check`, relevant parser if any |
| CV1 test/tooling | add/adjust tests, lint config, CI command | targeted test/lint command |
| CV2 small behavior | null guard, validation message, small UI state, single bug | failing test or reproduction first, then targeted test |

CV2 is the highest class allowed in `/vibe`. Anything larger escalates.

---

## Workflow

### Step 1 — Classify

State:

- Class: CV0, CV1, or CV2
- Scope: intended files or directories
- Why this does not need the full SDLC pipeline
- Escalation trigger: what would make you stop and switch lanes

If classification is uncertain, ask at most 3 clarification questions. If still uncertain, escalate.

### Step 2 — Write a Micro-Contract

Before editing, write 3-6 bullets:

```markdown
## Micro-Contract
- Change:
- In scope:
- Out of scope:
- Verification:
- Rollback:
```

Append it to `.claude/state/vibe-log.md`. Create the file if missing.

### Step 3 — Inspect Before Editing

Read only the relevant files and nearby tests. Prefer existing project patterns over new abstractions.

If `specs/brownfield/change-strategy.md` exists, read it before editing. If it marks the affected area as high-risk, stop and escalate out of `/vibe`.

### Step 4 — Test First When Behavior Changes

For CV2 behavior changes:

- Reproduce the bug or missing behavior first.
- Write or update one focused test against the public interface.
- Run it and confirm it fails for the expected reason.
- Implement the smallest change that makes it pass.

For CV0/CV1, skip TDD only when no runtime behavior changes.

### Step 5 — Edit Narrowly

Rules:

- Do not touch unrelated files.
- Do not reformat whole files unless formatting is the task.
- Do not introduce abstractions unless they remove immediate duplication or clarify the current change.
- Do not update generated SDLC artifacts unless the user explicitly asked for a story/spec/design change.

### Step 6 — Verify

Run the narrowest useful checks:

- Always: `git diff --check`
- CV0: parser/format check if applicable
- CV1: targeted test/lint command
- CV2: targeted failing-then-passing test, then relevant lint/typecheck if available

If verification fails, fix within the micro-contract. If the fix expands beyond the eligibility rules, stop and escalate.

### Step 7 — Review

The existing hooks mark production-code writes for review and the Stop hook requires reviewer agents before the turn ends. Do not bypass this. If hooks are unavailable, manually invoke clean-code and security review for changed production files.

### Step 8 — Report

Report:

- Class
- Files changed
- Verification commands and results
- Any follow-up work that should become a story

---

## Gotchas

- **Small does not mean unsafe.** Auth, security, billing, migrations, and public API changes are never vibe work.
- **No hidden stories.** If the change introduces user-visible behavior that needs product acceptance, write a story and use `/improve`.
- **No drive-by cleanup.** Adjacent cleanup belongs in a separate `/vibe` or `/refactor` task.
- **No unverifiable fixes.** If you cannot prove the change, escalate to `/fix-issue` or `/spec`.
