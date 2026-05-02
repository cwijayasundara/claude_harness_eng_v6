---
name: brownfield
description: Discover and map an existing codebase before planning or changing it.
argument-hint: "[optional-focus-path-or-goal]"
context: fork
agent: planner
---

# Brownfield Discovery

Use `/brownfield` in existing repositories before substantial planning, improvements, refactors, or bug work. The goal is to build a factual map of the current system so agents respect the codebase instead of inventing a parallel architecture.

This skill does not change production code.

---

## Usage

```text
/brownfield
/brownfield backend/src
/brownfield "map auth and billing before adding team invites"
```

---

## Outputs

Write these files:

| File | Purpose |
|---|---|
| `specs/brownfield/codebase-map.md` | Languages, frameworks, package managers, entry points, services, commands |
| `specs/brownfield/architecture-map.md` | Modules, layers, data flow, public interfaces, external dependencies |
| `specs/brownfield/test-map.md` | Test commands, coverage signals, public interfaces covered/missing, slow/flaky tests |
| `specs/brownfield/risk-map.md` | Sensitive areas, fragile zones, migrations, auth/security/billing/data risks |
| `specs/brownfield/change-strategy.md` | Recommended lane for future work: `/vibe`, `/fix-issue`, `/improve`, `/refactor`, `/spec`, `/auto` |
| `CONTEXT.md` | Optional domain glossary, created only when meaningful domain terms are discovered |

---

## Step 1 — Inventory the Repo

Discover facts, not guesses:

- Languages and frameworks
- Package managers and lockfiles
- App entry points
- Test/build/lint/typecheck commands
- Runtime services and Docker/compose files
- Environment/config files
- CI workflows
- Database migrations or schema files
- Public API route definitions
- Frontend routes/screens

Use `rg`, `find`, package manifests, config files, and existing docs. Prefer primary repo evidence over assumptions.

---

## Step 2 — Map Architecture

Write `architecture-map.md` with:

- Major modules and their responsibilities
- Public interfaces for each major module
- Data flow through the system
- External integrations
- Persistence boundaries
- Auth/session boundaries
- Existing layering conventions
- Deep modules worth preserving
- Shallow/pass-through modules that may be refactor candidates

Do not redesign the system. Capture what exists.

---

## Step 3 — Map Tests

Write `test-map.md` with:

- Test frameworks and commands
- Unit/integration/e2e locations
- Which public interfaces are covered
- Which critical public interfaces lack tests
- Known slow/flaky tests if discoverable
- Whether tests isolate env/config correctly

If commands are obvious and safe, run lightweight discovery commands such as `npm test -- --help`, `pytest --collect-only`, or package script listing. Do not run expensive test suites unless the user asked.

---

## Step 4 — Map Risks

Write `risk-map.md` with:

- Auth, permissions, privacy, billing, payment, and security-sensitive paths
- Database migrations and irreversible data operations
- External APIs and side-effecting integrations
- Generated code or vendored code that should not be edited manually
- Files with high churn or high coupling if visible from imports/callers
- Areas where tests are weak or missing

For each risk, include the evidence path.

---

## Step 5 — Recommend Change Strategy

Write `change-strategy.md` with:

- What qualifies for `/vibe`
- What should use `/fix-issue`
- What should use `/improve`
- What should use `/refactor`
- What requires `/spec` → `/design` → `/auto`
- What should require explicit human approval before touching

Include a short "first safe next steps" list.

---

## Step 6 — Domain Glossary

If recurring domain terms are discovered, create or update `CONTEXT.md`.

Keep it domain-level:

```markdown
# Context

## Terms

### Account
Definition meaningful to users/domain experts.

### User
Definition and how it differs from Account.
```

Do not fill `CONTEXT.md` with implementation details.

---

## Gate

Before recommending implementation, present:

- What the system appears to be
- Highest-risk areas
- Existing test confidence
- Recommended lane for the requested work
- Any uncertainty that needs human confirmation

Do not proceed to code changes from `/brownfield` unless the user explicitly asks.

---

## Gotchas

- **Do not invent architecture.** If evidence is missing, say unknown.
- **Do not create parallel implementations.** Brownfield work modifies existing paths unless a story/design explicitly approves a replacement.
- **Do not trust names alone.** Confirm responsibilities from imports, tests, route wiring, and callers.
- **Do not over-map the universe.** Focus enough to guide safe future changes.
- **Do not run destructive commands.** Discovery is read-only except for writing brownfield docs and optional `CONTEXT.md`.
