---
name: test
description: Generate test plan, test cases, test data fixtures, and Playwright E2E tests mapped to acceptance criteria.
argument-hint: "[--plan-only | --e2e-only]"
context: fork
agent: test-engineer
---

# Test Skill — Test Plan, Cases, Fixtures, and Playwright E2E

## Usage

```
/test
/test --plan-only
/test --e2e-only
```

- `/test` — generate all test artefacts: plan, cases, fixtures, and E2E tests.
- `/test --plan-only` — generate only `test-plan.md` and `test-cases.md`. Stop before writing Playwright files.
- `/test --e2e-only` — skip plan/cases, go straight to Playwright E2E generation. Use when plan already exists.

---

## Prerequisites

The following must exist before running this skill:

- `specs/stories/` — user stories with acceptance criteria (one file per story).
- `backend/` and/or `frontend/` — source code that the tests will target.
- `project-manifest.json` — for base URLs and service port configuration.

If any of these are missing, stop and report what is absent. Do not generate tests against an empty or partial codebase.

---

## Steps

### Step 1 — Read Patterns

Read `.claude/skills/code-gen/SKILL.md` for quality principles (typing, error handling, test structure).

Read `.claude/skills/evaluation/SKILL.md` for the Playwright patterns and contract verification approach used by the evaluator.

If a `references/playwright.md` file exists under `.claude/skills/testing/`, read it now for project-specific Playwright patterns.

### Step 2 — Read Acceptance Criteria

Read every story file in `specs/stories/`. For each story, extract:
- Story ID and title
- Acceptance criteria (AC) — each criterion becomes one or more test cases.
- Edge cases and error paths documented in the story.

Every test case generated must trace to a specific AC. Record the mapping explicitly.

### Step 3 — Spawn test-engineer Agent

Spawn the `test-engineer` agent with the full context: story files, source code structure, and the patterns read in Step 1.

The agent operates in the forked context. It must not modify source code.

### Step 4 — Generate Test Artefacts (`specs/test_artefacts/`)

Create `specs/test_artefacts/` if it does not exist.

**`specs/test_artefacts/test-plan.md`**
- Scope: what is being tested and what is explicitly out of scope.
- Test levels: unit, integration, E2E.
- Environment assumptions: base URLs, test DB, seed state.
- Pass/fail criteria for the sprint.

**`specs/test_artefacts/test-cases.md`**
- One section per story.
- Each test case: ID, AC reference, preconditions, steps, expected result.
- Cover success paths, error paths, and boundary conditions.

**`specs/test_artefacts/test-data/`**
- One fixture file per domain entity (e.g., `orders.json`, `users.json`).
- Data must be domain-representative: real-looking emails, valid UUIDs, plausible amounts.
- Never use `"foo"`, `123`, or `"test"` as stand-in values.

### Step 5 — Generate Playwright E2E Tests (`e2e/`)

Create `e2e/` at the project root if it does not exist.

For each story, generate a Playwright test file named `{story-id}.spec.ts`.

Rules for Playwright tests:
- Use `getByRole`, `getByLabel`, `getByText` — never CSS selectors or XPath.
- No `waitForTimeout`. Use `expect(locator).toBeVisible()` with retry.
- Each `test()` block maps to exactly one acceptance criterion. The test name must reference the AC.
- Import fixtures from `specs/test_artefacts/test-data/`.
- Follow Arrange → Act → Assert structure.

### Step 6 — Copy Playwright Config

Copy the config template:

```
cp .claude/templates/playwright.config.template.ts playwright.config.ts
```

Fill in the `baseURL` values from `project-manifest.json`. Configure `webServer` entries for each service that needs to be running during tests.

### Step 7 — Install Playwright

```
npx playwright install --with-deps chromium
```

### Step 8 — Verify

```
npx playwright test
```

All tests must pass on the first run against the target environment. A failing test that was written incorrectly is not acceptable — fix the test before reporting results.

---

## Output

| Path | Purpose |
|------|---------|
| `specs/test_artefacts/test-plan.md` | Sprint test plan |
| `specs/test_artefacts/test-cases.md` | Full test case inventory mapped to ACs |
| `specs/test_artefacts/test-data/` | JSON fixture files per domain entity |
| `e2e/{story-id}.spec.ts` | Playwright tests per story |
| `playwright.config.ts` | Playwright configuration |

---

## Gotchas

- **Test cases not mapped to acceptance criteria.** Every test case must cite its AC. Unmapped tests are noise.
- **CSS selectors instead of `getByRole`.** CSS selectors break on refactors. Use ARIA-based selectors exclusively.
- **Flaky waits.** `waitForTimeout` is banned. Network or animation delays must be handled with `expect(...).toBeVisible()` or `waitForResponse`.
- **Missing test data fixtures.** Tests that generate random data inline produce unrepeatable results. Always use fixture files.
- **Testing implementation details.** Test behavior through the public interface, not internal state.
- **Skipping error paths.** Every documented error path in the AC must have a test.
