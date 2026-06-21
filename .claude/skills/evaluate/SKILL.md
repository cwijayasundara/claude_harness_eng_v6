---
name: evaluate
description: "[Internal pipeline stage — run by /auto and /gate; invoke directly only as a power user.] Run the application and verify sprint contract criteria via API tests, Playwright interaction, and schema validation."
argument-hint: "[group-id]"
context: fork
agent: evaluator
---

# Evaluate Skill

Verify that the implemented group meets all sprint contract criteria by running live checks against the application: API calls, Playwright browser interaction, and schema validation.

> **Ultracode tip:** Leave ultracode **off** here (`/effort high`). Evaluation is deterministic three-layer verification against a fixed contract — there is nothing to fan out.

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
- `project-manifest.json` exists with `evaluation.api_base_url`, `evaluation.ui_base_url`, and `evaluation.health_check` fields.
- Docker stack is expected to be running. If it is not, the health check in Step 4 will catch this and produce a FAIL.
- The Playwright MCP browser tools (`mcp__plugin_playwright_playwright__browser_*`) are available. If the contract has `playwright_checks` or `design_checks` and the tools are missing, do NOT silently skip those layers or improvise with curl: write `VERDICT: FAIL` with `failure_layer: infrastructure` and the fix `Enable "playwright@claude-plugins-official": true in .claude/settings.json enabledPlugins, restart Claude Code, then re-run /evaluate.`

---

## Execution Steps

### Step 1 — Load Evaluation Patterns

Read the stack-matched verification reference under `.claude/skills/evaluate/references/` (see the References section below) for the rigor that applies to this project's stack, plus any custom assertion helpers.

### Step 2 — Load Sprint Contract

Read `sprint-contracts/{group}.json`. The contract contains:
- `api_checks`: list of HTTP endpoint checks.
- `playwright_checks`: list of browser interaction sequences.
- `design_checks`: list of visual and component checks (evaluated in Full mode only).
- `architecture_checks.files_must_exist`: list of file paths that must be present on disk.
- `features`: list of feature IDs this group satisfies.

### Step 3 — Load Project Manifest

Read `project-manifest.json`. Extract:
- `evaluation.api_base_url` — base URL for all API checks (e.g., `http://localhost:8000`).
- `evaluation.ui_base_url` — base URL for Playwright navigation (e.g., `http://localhost:3000`).
- `evaluation.health_check` — path to the health endpoint (e.g., `/health`).

### Step 4 — Verify Docker Stack

Run a health check to confirm the application is live:

```
curl --retry 5 --retry-delay 3 -sf {evaluation.api_base_url}{evaluation.health_check}
```

If the health check fails after 5 retries, immediately record a FAIL with `failure_layer: "docker"` and stop. Do not proceed to API or Playwright checks. A broken stack is not a partial pass.

---

## Layer 1 — API Checks

For each entry in `api_checks`:

1. Execute the request via Bash:
   ```
   curl -s -w '\n%{http_code}' -X {method} {evaluation.api_base_url}{path}
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

Performance is a **regression ratchet**, not an absolute-budget gate: a build FAILs only when a read endpoint gets measurably *slower* than its recorded baseline. Absolute-budget overruns and first-time measurements are WARN — they inform, they don't block. This catches "the change doubled latency" without flaking greenfield builds that have no baseline yet.

### Step P1 — Resolve the endpoints and budgets

- **Endpoints to measure:** every endpoint in the contract's `api_checks` plus any `performance_checks` entry. Split them by method:
  - **Read (GET):** safe to sample repeatedly → eligible for the regression ratchet.
  - **Write (non-GET):** sampling a POST/PUT/DELETE 20× would create 20 records → single-shot budget WARN only, never sampled or ratcheted.
- **Budget per endpoint (advisory):** the contract's `performance_checks[].max_response_time_ms` if present, else `project-manifest.json` → `execution.latency_budget_ms.read` for GET / `.write` for non-GET (defaults 300 / 800 ms). If neither exists, skip the budget WARN for that endpoint (the ratchet still applies to reads).
- **Regression threshold:** `execution.latency_budget_ms.regression_pct` if set, else the `perf-baseline.js` default of 50(%).

### Step P2 — Read endpoints: regression ratchet

Run the existing baseline tool against the read endpoints, keeping the loop's baseline separate from the brownfield "measure-first" baseline:

```bash
READS="/items,/items/1,/health"   # comma-joined GET paths from the contract
BASELINE=specs/reviews/perf-baseline.json

if [ -f "$BASELINE" ]; then
  # compare current latency to the recorded baseline; exit 1 = p95 regression
  node .claude/scripts/perf-baseline.js --compare --endpoints "$READS" --out "$BASELINE"
  PERF_STATUS=$?
else
  # first evaluation: establish the baseline, do not fail on it
  node .claude/scripts/perf-baseline.js --endpoints "$READS" --out "$BASELINE"
  PERF_STATUS=2   # treat "baseline just created" as WARN, not FAIL
fi
```

Interpret `PERF_STATUS`:
- **1 (REGRESSION)** → performance **FAIL**. Record `failure_layer: "performance"` with the endpoint and the `p95 before -> after (+N%)` line from the tool's stdout. This flips the overall verdict to FAIL.
- **2 (no baseline / just captured)** → **WARN** only. Note "performance baseline established — ratchet active next evaluation." Do not fail.
- **0 (OK)** → pass. Still emit a WARN for any read endpoint whose measured p95 exceeds its resolved budget (slow, but not a regression).

After a **PASS** verdict for the whole group, refresh the baseline so the ratchet tracks the accepted state:
```bash
node .claude/scripts/perf-baseline.js --endpoints "$READS" --out "$BASELINE"   # only on overall PASS
```
Never refresh the baseline on a FAIL — that would launder a regression into the new normal.

### Step P3 — Write endpoints: single-shot budget WARN

For each non-GET endpoint with a resolved budget, take **one** measurement with `--measure` (no baseline write, no ratchet) and `--samples 1` — the tool skips warmup for non-GET, so this fires exactly one request and won't create extra records:
```bash
node .claude/scripts/perf-baseline.js --measure \
  --endpoints "/items" --method POST --body '{...}' --samples 1
# stdout: MEASURE: POST /items p50=910ms p95=910ms p99=910ms (1 samples)
```
Parse the `p95` from the `MEASURE:` line. If it exceeds the endpoint's resolved budget, record a **WARN** — never a FAIL. Writes are not ratcheted because a single sample has no meaningful p95 distribution and repeated sampling would mutate state. (A plain `curl -s -o /dev/null -w "%{time_total}"` is an acceptable fallback if invoking the script per write endpoint is awkward.)

---

## Layer 2 — Playwright Checks

Selector and assertion rules are single-sourced in `.claude/skills/evaluate/references/playwright-patterns.md` (the canonical Playwright reference, shared with `/test`). The rules below are a summary — defer to that file if they differ.

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

### Accessibility (axe-core) — when the contract has `accessibility_checks`

Semantic selectors prove an element is *reachable*; they do not prove the page is *accessible*. When the contract carries an `accessibility_checks` block, run an axe-core audit on each page (default: `evaluation.ui_base_url`; or the block's `urls`):

1. `browser_navigate` to the page.
2. Inject and run axe with `browser_evaluate` — load axe-core (e.g. from the `axe-core` package or CDN) and `return await axe.run()`.
3. Collect `violations`; group them by `impact` (`minor` / `moderate` / `serious` / `critical`).
4. **Verdict:** any violation whose `impact` is in `block_impacts` (default `["serious", "critical"]`) is a failure. In **Full** mode this FAILs the evaluation (`failure_layer: "accessibility"`); in **Lean** mode record it as a WARN. Always list the rule id, impact, and the offending selector(s) in the report.

A missing axe run when `accessibility_checks.required` is true is a FAIL, not a pass — mirror the security-gate rule (a missing scan is never a pass).

---

## Layer 3 — Design Checks (Full Mode Only)

Skip this layer entirely in **Lean** mode (the design-critic runs once at group end instead).

In Full mode, delegate to the `design-critic` agent:
- Pass the list of `design_checks` entries from the sprint contract.
- Pass `evaluation.ui_base_url`.
- The design-critic returns PASS/FAIL per check with visual evidence (screenshots or snapshots).

The design-critic writes `specs/reviews/eval-scores.json` with keys `design_quality`, `originality`, `craft`, and `functionality`; these map 1:1 onto the contract's `design_checks` keys, and each criterion's score must meet or exceed its `min_score` in the contract for the check to pass.

Record the design-critic's verdicts as-is. Do not override them.

---

## Architecture Checks

For each path listed in `architecture_checks.files_must_exist`:

- Verify the file exists on disk at the given path.
- If the file does not exist, record a FAIL with the missing path.

This check does not require Docker to be running.

---

## Layer 4 — Security Gate

The validator is not security-complete without this layer. Run it in Full and Lean modes — every mode runs the security gate.

1. Spawn the `security-reviewer` agent against the group's changed files (run it concurrently with Layers 1–2 when possible — it does not need the app running).
2. The agent writes `specs/reviews/security-verdict.json` (`{ pass, block_severities, summary, findings[] }`). Read it.
3. Determine the blocking threshold: use the sprint contract's `contract.security_checks.block_severities` if present, else the default `["critical", "high"]`.
4. The security gate **FAILs** if any finding's `severity` is in the blocking set (equivalently, `security-verdict.json#pass === false`). Medium/low findings are WARN/INFO — record them, do not fail on them.
5. If `security-verdict.json` is missing, treat that as a FAIL with `failure_layer: "security"` and reason `"security-reviewer did not produce a verdict"` — a missing scan is not a pass.

This layer does not require Docker. It is independent of the app being reachable.

---

## Update features.json

After all checks complete, update `features.json` for every feature ID listed in the sprint contract's `features` array:

- `passes`: `true` if all checks for that feature passed, `false` otherwise.
- `last_evaluated`: current timestamp in ISO 8601 format.
- `failure_reason`: `null` if passing; otherwise a human-readable description of the first failure (e.g., `"GET /users/1 returned 404, expected 200"`).
- `failure_layer`: `null` if passing; otherwise one of `"api"`, `"playwright"`, `"design"`, `"accessibility"`, `"unit_test"`, `"docker"`, `"security"`, `"performance"`.

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

## Security Gate

- [FAIL] VULN-001 (high): SQL injection in src/api/users.ts:47
- block: 1, warn: 2, info: 0 → gate FAIL

## Performance

- [PASS] GET /items p95 41ms -> 44ms (+7%) — within ratchet
- [FAIL] GET /items/1 p95 38ms -> 210ms (+452%) — regression
- [WARN] POST /items 910ms > 800ms write budget (single-shot, not ratcheted)
- [WARN] No baseline existed — established; ratchet active next evaluation

## Features Updated

- F001: PASS
- F002: FAIL (api: GET /users/1 expected 200, got 404)
- F003: PASS
```

The overall VERDICT is PASS only if every check across all layers passes, the security gate passes (`security-verdict.json#pass === true`), **and** the performance ratchet reports no read-endpoint regression. A single FAIL in any layer — an open BLOCK (critical/high) security finding, or a p95 latency regression beyond threshold — produces a FAIL verdict. Performance WARNs (over budget, or first-build baseline established) do not affect the verdict.

---

## Mode Behavior

| Mode  | Layer 1 (API) | Layer 2 (Playwright) | Accessibility (axe) | Layer 3 (Design) | Layer 4 (Security) | Performance ratchet |
|-------|--------------|---------------------|---------------------|-----------------|--------------------|---------------------|
| Full  | Run          | Run                 | Gate (FAIL)         | Run             | Run                | Run                 |
| Lean  | Run          | Run                 | WARN                | Skip            | Run                | Run                 |

(Accessibility runs only when the contract carries an `accessibility_checks` block; in Lean mode its violations are WARN, in Full mode blocking impacts FAIL.)

Determine the current execution mode from `project-manifest.json` field `execution.default_mode` (`full`/`lean`), or the `--mode` override when invoked under `/auto` or `/build`. Default to Full if absent. Note: this is distinct from `verification.mode` (`docker`/`local`/`stub`), which controls how the app is reached — do not confuse the two.

---

## Gotchas

- **Never skip a check:** Every entry in the sprint contract must be evaluated. Skipping a check to make the verdict green is not acceptable.
- **Never rationalize failures:** If the API returns 404 and the contract expects 200, that is a FAIL — not a "known issue" or "works on my machine." Record it as a FAIL.
- **Use getByRole, not CSS:** Playwright checks must use semantic locators (`getByRole`, `getByText`, `getByLabel`). CSS selectors break with minor UI changes and are not permitted.
- **Use expect().toBeVisible(), not waitForTimeout():** Arbitrary timeouts hide real failures. If an element does not appear immediately, the check fails.
- **Docker won't start — that's a FAIL:** If the stack is unhealthy, record `failure_layer: "docker"` and stop. Do not attempt workarounds or partial evaluations.
- **Do not modify sprint contracts:** The contract is a read-only input. If the contract appears wrong, report it; do not edit it to make checks pass.

---

## References

The evaluation reference pack (read by the evaluator and design-critic agents) lives under `.claude/skills/evaluate/references/`:

| File | Contents |
|------|----------|
| `references/contract-schema.json` | Sprint contract JSON schema |
| `references/scoring-rubric.md` | Design scoring rubric (4 criteria, weights, exemplars) |
| `references/scoring-examples.md` | Calibration anchors (score 5, 7, 9) — read before scoring |
| `references/playwright-patterns.md` | Selector patterns and assertion patterns for Layer 2 (canonical Playwright reference, shared with `/test`) |
| `references/verify-python.md` | Deep Python verification rigor (pytest/mypy/ruff, traceback parsing, FastAPI/async) — load when the backend is Python |
| `references/verify-react.md` | Deep React/TS verification rigor (build/tsc/vitest, browser/console/hydration signals) — load when the frontend is React/TS |

## Evaluator Behavioral Rules

These rules are non-negotiable. Deviation invalidates the evaluation.

1. **Execute every check.** Do not skip a check because a related check passed.
2. **Never rationalize a failure.** If the check specifies `status: 200` and you get `201`, that is a FAIL.
3. **Evidence over opinion.** Every verdict must cite specific output: response body, screenshot path, line number.
4. **No partial credit on binary checks.** API and Playwright checks are pass/fail.
5. **Design scores are evidence-based.** Cite what you observed, not what you assumed.
6. **Do not infer intent.** If the contract says check X and X is absent, the check fails.
7. **Run checks in order.** Layer 1 before Layer 2 before Layer 3, then the Layer 4 security gate, then the performance ratchet (it needs the app warm and the functional checks already exercised).
8. **Document every check result,** even passing ones.
9. **Security is a gate, not advice.** The overall verdict is FAIL if `specs/reviews/security-verdict.json#pass` is false (any critical/high finding). A functional pass with an open BLOCK vulnerability is still a FAIL. The `security-guidance` plugin is advisory and does not satisfy this gate — the `security-reviewer` agent does.
