# Full `/test` and `--e2e-only` — Playwright after source exists

Use this when `/test` (no `--plan-only`) or `/test --e2e-only`. Requires
source under `backend/` and/or `frontend/`, plus the plan-only artefacts.

For authoring patterns read `test-authoring.md` and
`.claude/skills/evaluate/references/playwright-patterns.md`.

## Prerequisites

- Approved story set (`plan-approval.js check --phase spec`).
- `specs/test_artefacts/verification-matrix.json` from `--plan-only`.
- Source the E2E tests will target.

## `--e2e-only`

Generate Playwright specs from `verification-matrix.json`, not ad hoc story
prose. Each E2E test records its row in `specs/test_artefacts/e2e-traces.json`
with the corresponding `matrix_id`.

Create `e2e/` if needed. One file per story: `{story-id}.spec.ts`.

Selector and assertion rules are single-sourced in `playwright-patterns.md`:
`getByRole` / `getByLabel` / `getByText` — never CSS or XPath. No
`waitForTimeout`. Each `test()` maps to one AC. Import fixtures from
`specs/test_artefacts/test-data/` when they exist.

## Copy Playwright config

```
cp .claude/templates/playwright.config.template.ts playwright.config.ts
```

Fill `baseURL` from `project-manifest.json`. Configure `webServer` for each
service that must run during tests.

Copy `.claude/templates/github-workflows/e2e.yml` to `.github/workflows/e2e.yml`
(skip if the target exists). Adapt the install step to the package layout.

```
npx playwright install --with-deps chromium
npx playwright test
```

All tests must pass against the target environment. Fix a wrong test before
reporting.

## Integration tests [when source exists]

For each story that crosses an external boundary (database, HTTP, LLM), write
a deterministic integration test under `tests/integration/` that binds the
boundary-test-doubles kit (`.claude/templates/boundary-doubles/`). Run under
`HARNESS_TEST_REPLAY=1`. Record each in `integration-traces.json` with its
`matrix_id`.

## Acceptance tests first [when source exists]

Follow `.claude/skills/writing-acceptance-tests-first/SKILL.md` before
implementation: AT against the named seam with a test-double adapter, confirm
it fails for the right reason. Write to
`specs/test_artefacts/acceptance/{story-id}.<ext>` and `at-traces.json`.

`--plan-only` names the seam only — it does not write AT source.

## Constraint obligations

When design schemas exist, run `constraints-extract.js` as in `test-plan.md`
and cover every `OBL-` with a negative case.
