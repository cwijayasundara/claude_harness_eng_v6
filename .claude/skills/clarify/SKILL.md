---
name: clarify
description: Bounded clarification gate for resolving product, domain, API, security, or architecture uncertainty without exhausting the user.
---

# Clarify Skill

Use this skill when a BRD, story, design, or implementation plan contains uncertainty that materially affects behavior, data shape, security, privacy, architecture, or story readiness.

This is not an open-ended interview. The goal is to unblock progress with the smallest useful number of questions.

---

## Clarification Budget

- Default budget: **10 questions**.
- Hard cap: **15 questions**.
- Continue past 10 only if the user explicitly asks to keep going.
- Never exceed 15 questions in one clarification session.

Ask one question at a time unless the questions are tightly coupled and can be answered together without cognitive overhead.

---

## Before Asking

First try to answer from local context:

- Existing code and tests
- `CONTEXT.md` or `CONTEXT-MAP.md`
- `docs/adr/`
- `specs/brd/`
- `specs/stories/`
- `specs/design/`
- `project-manifest.json`
- `.claude/program.md`

If local context gives a reasonable answer, record it as an assumption instead of asking.

---

## Ask Only Load-Bearing Questions

Ask only when the answer materially changes one of:

- User-visible behavior
- Story readiness
- Acceptance criteria
- Data model
- API contract
- Security or privacy posture
- Architecture direction
- External integration behavior
- File ownership or implementation sequencing

Do not ask preference questions that can be safely decided by existing project conventions.

---

## Question Format

Each question should include:

1. The decision being made.
2. Your recommended answer.
3. Why the answer matters.

Example:

```text
Question 3/10 — Password reset token expiry
Recommendation: 30 minutes.
Why it matters: This affects the API contract, data model, tests, and security posture.
Should we use 30 minutes, or do you need a different expiry?
```

---

## Stop Conditions

Stop before the budget if:

- The artifact is implementable.
- Remaining uncertainty is low-risk and can be captured as assumptions.
- The user says to proceed.
- The user is repeating answers or uncertainty is not decreasing.

At question 10, stop and present:

- Confirmed decisions
- Assumptions you will proceed with
- Unresolved risks
- Recommendation: proceed, split a story, or pause for human decision

Only continue to questions 11-15 if the user explicitly asks.

---

## Outputs

Write clarification outcomes into the artifact being prepared:

- BRD: `Open Questions`, `Assumptions`, or relevant requirement sections
- Story: `Acceptance Criteria`, `Notes`, `Readiness`, and `Breakdown Reason`
- Design: `api-contracts.md`, `data-models.md`, `component-map.md`, or `docs/adr/`
- Implementation plan: plan assumptions and risks

If a term is clarified and `CONTEXT.md` exists, update it. If no `CONTEXT.md` exists, create it only when the clarified term is domain-level and likely to recur.

Offer an ADR only when all are true:

- The decision is hard to reverse.
- The decision would surprise a future maintainer without context.
- Real alternatives were considered.

---

## Gotchas

- **Do not interrogate by default.** Prefer code/docs discovery and explicit assumptions.
- **Do not ask trivia.** If the answer does not change behavior or architecture, skip it.
- **Do not block on polish.** If the artifact is good enough to proceed, proceed.
- **Do not exceed the budget.** More questions can reduce quality by exhausting the user.
