---
name: evaluate
description: Run the application and verify sprint contract criteria via API tests, Playwright interaction, and schema validation.
argument-hint: "[group-id]"
context: fork
agent: evaluator
---

# Evaluate Skill

Verify that the implemented group meets all sprint contract criteria by running live checks against the application: API calls, Playwright browser interaction, and schema validation.

---

## Usage

```
/evaluate C
```

Evaluates group C's sprint contract. The group ID matches a node in `specs/stories/dependency-graph.md` and a file at `sprint-contracts/{group}.json`.

---

## Prerequisites

Before running `/evaluate`, verify:

- `sprint-contracts/{group}.json` exists and is valid JSON.
- `project-manifest.json` exists with `api_base_url`, `ui_base_url`, and `health_check` fields.
- Docker stack is expected to be running. If it is not, the health check in Step 4 will catch this and produce a FAIL.

---

## Execution Steps

### Step 1 — Load Evaluation Patterns

Read `.claude/skills/evaluation/SKILL.md` for project-specific evaluation patterns, custom assertion helpers, and any environment-specific overrides.

### Step 2 — Load Sprint Contract

Read `sprint-contracts/{group}.json`. The contract contains:
- `api_checks`: list of HTTP endpoint checks.
- `playwright_checks`: list of browser interaction sequences.
- `design_checks`: list of visual and component checks (evaluated in Full mode only).
- `architecture_checks.files_must_exist`: list of file paths that must be present on disk.
- `features`: list of feature IDs this group satisfies.

### Step 3 — Load Project Manifest

Read `project-manifest.json`. Extract:
- `api_base_url` — base URL for all API checks (e.g., `http://localhost:8000`).
- `ui_base_url` — base URL for Playwright navigation (e.g., `http://localhost:3000`).
- `health_check` — path to the health endpoint (e.g., `/health`).

### Step 4 — Verify Docker Stack

Run a health check to confirm the application is live:

```
curl --retry 5 --retry-delay 3 -sf {api_base_url}{health_check}
```

If the health check fails after 5 retries, immediately record a FAIL with `failure_layer: "docker"` and stop. Do not proceed to API or Playwright checks. A broken stack is not a partial pass.

---

## Layer 1 — API Checks

For each entry in `api_checks`:

1. Execute the request via Bash:
   ```
   curl -s -w '\n%{http_code}' -X {method} {api_base_url}{path}
   ```
   Include `-H` headers and `-d` body as specified in the check entry.

2. Parse the response: the last line is the HTTP status code; everything before it is the response body.

3. Verify status code matches `expect.status`. A mismatch is a FAIL for this check.

4. Verify the response body contains every string listed in `expect.body_contains`. A missing string is a FAIL for this check.

5. If the check entry contains a `schema_ref` field, validate the response body against the schema:
   ```
   python3 -c "
   import json, jsonschema, sys
   body = json.loads(sys.stdin.read())
   schema = json.load(open('specs/design/api-contracts.schema.json'))
   ref = schema['{schema_ref}']
   jsonschema.validate(body, ref)
   print('schema valid')
   " <<< '{response_body}'
   ```
   A schema validation error is a FAIL for this check.

Record each check as PASS or FAIL with the actual vs. expected values.

### Debugging API Failures

Before reporting an API check as FAILED, read the server logs:
```bash
docker compose logs backend --tail=50 2>&1
```
Include the relevant error from the logs in the failure report. This gives the generator the actual stack trace, not just "got 500 instead of 200."

---

## Performance Checks

For each `performance_checks` entry in the contract:
```bash
# Measure response time
time_ms=$(curl -s -o /dev/null -w "%{time_total}" -X {method} {api_base_url}{endpoint} | awk '{printf "%.0f", $1 * 1000}')
```
If `time_ms > max_response_time_ms`, report as WARN (not BLOCK — performance is advisory unless critical).

---

## Layer 2 — Playwright Checks

For each entry in `playwright_checks`:

1. Use Playwright MCP tools to execute the interaction sequence:
   - `browser_navigate` — navigate to a URL.
   - `browser_click` — click an element (use `getByRole`, `getByText`, or `getByLabel`; never CSS selectors).
   - `browser_fill_form` — fill form fields.
   - `browser_snapshot` — capture the DOM snapshot for assertion.

2. Execute each step in the order specified. Do not reorder or skip steps.

3. Verify each assertion listed in the check entry:
   - Element visible: confirm the element appears in the snapshot.
   - Text matches: confirm the exact or partial text is present.
   - URL: confirm `browser_navigate` landed on the expected path.

4. Use `expect().toBeVisible()` for visibility assertions. Never use `waitForTimeout()` — if an element is not immediately visible, the check fails.

5. Record each check as PASS or FAIL with a description of what was asserted and what was found.

---

## Layer 3 — Design Checks (Full Mode Only)

Skip this layer entirely in **Lean** or **Solo** mode.

In Full mode, delegate to the `design-critic` agent:
- Pass the list of `design_checks` entries from the sprint contract.
- Pass the `ui_base_url`.
- The design-critic returns PASS/FAIL per check with visual evidence (screenshots or snapshots).

Record the design-critic's verdicts as-is. Do not override them.

---

## Architecture Checks

For each path listed in `architecture_checks.files_must_exist`:

- Verify the file exists on disk at the given path.
- If the file does not exist, record a FAIL with the missing path.

This check does not require Docker to be running.

---

## Update features.json

After all checks complete, update `features.json` for every feature ID listed in the sprint contract's `features` array:

- `passes`: `true` if all checks for that feature passed, `false` otherwise.
- `last_evaluated`: current timestamp in ISO 8601 format.
- `failure_reason`: `null` if passing; otherwise a human-readable description of the first failure (e.g., `"GET /users/1 returned 404, expected 200"`).
- `failure_layer`: `null` if passing; otherwise one of `"api"`, `"playwright"`, `"design"`, `"unit_test"`, `"docker"`.

Do not remove existing fields from `features.json`. Merge the updates into the existing structure.
Only update evaluation state fields: `passes`, `last_evaluated`, `failure_reason`, and `failure_layer`. Preserve immutable feature identity/specification fields such as `id`, `category`, `story`, `group`, `description`, and `steps`.

---

## Write Evaluator Report

Write the full evaluation report to `specs/reviews/evaluator-report.md`:

```markdown
# Evaluator Report — Group {group}

Date: {ISO 8601 timestamp}
VERDICT: PASS | FAIL

## API Checks

- [PASS] POST /users → 201 ✓
- [FAIL] GET /users/1 → expected 200, got 404
- [PASS] DELETE /users/1 → 204 ✓

## Playwright Checks

- [PASS] Upload page renders ✓
- [FAIL] Submit button not clickable
- [PASS] Success message visible after form submit ✓

## Design Checks

- [PASS] Button uses primary color token ✓
- [SKIP] Design checks skipped (Lean mode)

## Architecture Checks

- [PASS] All expected files exist ✓
- [FAIL] Missing: src/repository/user-repository.ts

## Features Updated

- F001: PASS
- F002: FAIL (api: GET /users/1 expected 200, got 404)
- F003: PASS
```

The overall VERDICT is PASS only if every check across all layers passes. A single FAIL in any layer produces a FAIL verdict.

---

## Mode Behavior

| Mode  | Layer 1 (API) | Layer 2 (Playwright) | Layer 3 (Design) |
|-------|--------------|---------------------|-----------------|
| Full  | Run          | Run                 | Run             |
| Lean  | Run          | Run                 | Skip            |
| Solo  | No-op — print "Solo mode: skipping evaluator" and exit |

Determine the current mode from `project-manifest.json` field `mode`. Default to Full if the field is absent.

---

## Gotchas

- **Never skip a check:** Every entry in the sprint contract must be evaluated. Skipping a check to make the verdict green is not acceptable.
- **Never rationalize failures:** If the API returns 404 and the contract expects 200, that is a FAIL — not a "known issue" or "works on my machine." Record it as a FAIL.
- **Use getByRole, not CSS:** Playwright checks must use semantic locators (`getByRole`, `getByText`, `getByLabel`). CSS selectors break with minor UI changes and are not permitted.
- **Use expect().toBeVisible(), not waitForTimeout():** Arbitrary timeouts hide real failures. If an element does not appear immediately, the check fails.
- **Docker won't start — that's a FAIL:** If the stack is unhealthy, record `failure_layer: "docker"` and stop. Do not attempt workarounds or partial evaluations.
- **Do not modify sprint contracts:** The contract is a read-only input. If the contract appears wrong, report it; do not edit it to make checks pass.
