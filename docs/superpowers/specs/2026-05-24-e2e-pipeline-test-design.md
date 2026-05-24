# E2E Pipeline Integration Test — Design Spec

**Date:** 2026-05-24
**Status:** Draft

## Problem

Testing the Claude Harness Engine v4 SDLC pipeline (/scaffold → /brd → /spec → /design → /auto → /brownfield → /code-map → /seam-finder) requires manually running each stage, eyeballing artifacts, and checking telemetry. This is slow, boring, and unreliable. There is no automated way to verify the framework works end-to-end after changes.

## Solution

A Node.js E2E test suite that builds a real toy project through the full pipeline, validates every generated artifact with LLM-based assertions (Claude Haiku), verifies telemetry flows to Prometheus, and checks Grafana dashboards via Playwright. Fully automated, repeatable, ~$5-8 per run.

## Toy Project Fixture

Every test run builds the same project: a **Node.js CLI todo app**.

```
Name: todo-cli
Description: CLI tool to add, list, complete, and delete todos
Storage: JSON file (no database)
Language: Node.js (single runtime)
Scope: ~3-5 stories, 1 epic, groups A+B
UI: Terminal table output (exercises design mockups)
```

This is the smallest project that exercises all pipeline stages while producing every artifact type (BRD, stories, features.json, API contracts, schemas, mockups, code, tests).

### Canned BRD Prompt

A fixed prompt fed to /brd ensures deterministic-ish results:

```
Build a Node.js CLI todo application.

Requirements:
- Commands: add <text>, list, complete <id>, delete <id>
- Storage: todos.json file in current directory
- Fields per todo: id (auto-increment), text, completed (boolean), createdAt (ISO timestamp)
- List output: formatted table showing id, status checkbox, text, age
- Exit codes: 0 on success, 1 on error (missing args, invalid id)
- No external dependencies beyond Node.js built-ins

Success metrics:
- All 4 CRUD commands work with correct exit codes
- JSON file persists between invocations
- List output is human-readable in terminal
```

## Pipeline Stages and Assertions

### Stage 1: /scaffold

**Input:** `claude -p "/scaffold" --model haiku`

**File assertions:**
- `CLAUDE.md` exists and is non-empty
- `.claude/` directory exists
- `.claude/settings.json` is valid JSON with `env.CLAUDE_CODE_ENABLE_TELEMETRY`

### Stage 2: /brd

**Input:** Pipe the canned BRD prompt to `claude -p "/brd"` 

**File assertions:**
- `specs/brd/brd.md` exists, > 500 characters
- `specs/reviews/phase-brd-eval.json` exists with `verdict: "PASS"` (or best-effort if threshold not met)

**LLM validation (Haiku):**
- BRD has >= 3 quantified success metrics (not vague like "users are happy")
- Explicit In-Scope / Out-of-Scope lists
- MVP definition present
- At least 2 alternatives documented

### Stage 3: /spec

**Input:** `claude -p "/spec specs/brd/brd.md"`

**File assertions:**
- `specs/stories/epics.md` exists
- `specs/stories/dependency-graph.md` exists
- At least 1 `specs/stories/E*-S*.md` file exists
- `features.json` exists and is valid JSON array with >= 3 entries
- `specs/reviews/phase-spec-eval.json` exists

**LLM validation (Haiku):**
- Every story has 3-6 testable acceptance criteria
- No vague language ("works properly", "loads fast", "user-friendly")
- Dependency graph is described (groups assigned)
- Every story references a BRD goal

### Stage 4: /design

**Input:** `claude -p "/design"`

**File assertions:**
- `specs/design/system-design.md` exists
- `specs/design/api-contracts.md` exists
- `specs/design/data-models.md` exists
- `specs/design/folder-structure.md` exists
- `specs/design/component-map.md` exists
- `specs/reviews/phase-design-eval.json` exists

**LLM validation (Haiku):**
- Component-map references every story ID from the spec
- Data model defines the todo entity with required fields (id, text, completed, createdAt)
- Folder structure is a valid directory tree

**Schema validation (programmatic):**
- `api-contracts.schema.json` is valid JSON (if generated)
- `data-models.schema.json` is valid JSON (if generated)

### Stage 5: /auto (budget-capped, solo mode)

**Input:** `claude -p "/auto --mode solo" --max-budget-usd 5.00`

**File assertions:**
- At least 1 `.js` or `.ts` source file exists in project tree
- At least 1 test file exists
- `features.json` has at least 1 entry with `passes: true`

**Functional validation:**
- Run `node <entry-point> add "test todo"` — exit code 0
- Run `node <entry-point> list` — exit code 0, output contains "test todo"

**Telemetry assertions:**
- `.claude/runs/*.jsonl` has > 0 records
- At least 1 record has `kind: "subagent"`

### Stage 6: /brownfield (reuse Stage 5 output)

**Input:** `claude -p "/brownfield"`

**File assertions:**
- `specs/brownfield/architecture-map.md` exists
- `specs/brownfield/risk-map.md` exists
- `specs/brownfield/test-map.md` exists
- `specs/reviews/phase-brownfield-eval.json` exists

**LLM validation (Haiku):**
- Architecture map modules correspond to real directories/files in the project
- Risk map cites specific files
- Test map references real test commands

### Stage 7: /code-map

**Input:** `claude -p "/code-map"`

**File assertions:**
- `specs/brownfield/code-graph.json` exists and is valid JSON
- `specs/brownfield/dependency-graph.md` exists

### Stage 8: Telemetry verification (Prometheus)

**Prerequisite:** Telemetry stack running (`docker compose -f telemetry_docker_compose.yml up -d`)

**Prometheus queries (HTTP API at localhost:9090):**
- `harness_conversation_turns_total` has results
- `harness_phase_eval_score{criterion="weighted_avg"}` has results for at least 1 phase
- `harness_phase_eval_iterations_total` has results

### Stage 9: Grafana dashboard (Playwright)

**Prerequisite:** Grafana running at localhost:3001

**Playwright assertions:**
- Navigate to `http://localhost:3001` — page loads (status 200)
- Login or anonymous access works
- Dashboard search or provisioned dashboard loads
- Take screenshot as evidence (`test/e2e/results/grafana-dashboard.png`)

## LLM-Based Artifact Validation

Each LLM validation call uses Claude Haiku via CLI:

```javascript
async function llmValidate(artifactContent, criteria) {
  const prompt = JSON.stringify({
    instruction: "Validate this artifact against the criteria. Return ONLY valid JSON.",
    criteria: criteria,
    artifact: artifactContent.slice(0, 8000) // cap context
  });
  
  const result = spawnSync('claude', [
    '-p', '--model', 'haiku',
    '--no-session-persistence',
    '--max-budget-usd', '0.10',
    '--output-format', 'json'
  ], { input: prompt, encoding: 'utf8', timeout: 30000 });
  
  return JSON.parse(result.stdout);
}
```

**Validation criteria per stage** stored in `test/e2e/fixtures/validation-criteria.json`:

```json
{
  "brd": "Has >= 3 quantified success metrics with numbers. Has explicit In-Scope and Out-of-Scope lists. MVP is defined. At least 2 alternatives documented with rationale.",
  "spec": "Every story has 3-6 acceptance criteria. No criteria use vague language. Dependency groups are assigned. Stories reference BRD goals.",
  "design": "Component-map covers every story ID. Data model has todo entity with id/text/completed/createdAt. Folder structure is a valid tree.",
  "brownfield": "Architecture map modules match real directories. Risk map cites specific files. Test map has runnable commands."
}
```

**LLM validation is advisory, not blocking.** If Haiku says FAIL but the artifact exists and is structurally valid, the test logs a warning but doesn't fail. This prevents flaky tests from non-deterministic LLM responses.

## Telemetry Verification

Query Prometheus HTTP API directly:

```javascript
async function queryPrometheus(query) {
  const url = `http://localhost:9090/api/v1/query?query=${encodeURIComponent(query)}`;
  const resp = await fetch(url);
  const data = await resp.json();
  return data;
}
```

Flush telemetry before checking by running the replay script:

```bash
node .claude/scripts/replay-telemetry.js
```

Then query for expected metrics.

## Grafana Dashboard Verification

Use Playwright (already installed) to navigate, screenshot, and check for panel presence:

```javascript
const { chromium } = require('playwright');

async function checkGrafana() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:3001', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'test/e2e/results/grafana-login.png' });
  
  // Navigate to provisioned dashboard
  await page.goto('http://localhost:3001/d/harness-overview', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000); // let panels render
  await page.screenshot({ path: 'test/e2e/results/grafana-dashboard.png', fullPage: true });
  
  // Check Phase Quality section loaded
  const content = await page.textContent('body');
  const hasPhaseQuality = content.includes('Phase Quality');
  
  await browser.close();
  return hasPhaseQuality;
}
```

## File Structure

```
test/
  e2e/
    harness-pipeline.test.js       — main test orchestrator
    helpers/
      claude-runner.js             — spawn claude -p with config
      llm-validator.js             — LLM artifact validation
      prometheus-checker.js        — Prometheus query helper  
      grafana-checker.js           — Playwright dashboard checks
    fixtures/
      todo-cli-brd-prompt.md       — canned BRD input
      validation-criteria.json     — per-stage LLM validation criteria
    results/                       — screenshots, logs (gitignored)
      .gitkeep
```

## Running the Test

```bash
# 1. Start telemetry stack
docker compose -f telemetry_docker_compose.yml up -d

# 2. Wait for services to be healthy
until curl -s http://localhost:9090/-/healthy > /dev/null; do sleep 2; done
until curl -s http://localhost:3001/api/health > /dev/null; do sleep 2; done

# 3. Run the E2E test (20-minute timeout)
node --test test/e2e/harness-pipeline.test.js --timeout 1200000

# 4. Check results
ls test/e2e/results/

# 5. Teardown
docker compose -f telemetry_docker_compose.yml down
```

## Model and Budget Strategy

| Stage | Model | Budget cap | Rationale |
|-------|-------|-----------|-----------|
| /scaffold | haiku | $0.20 | Template instantiation, minimal reasoning |
| /brd | haiku | $0.50 | Interview is canned, document generation |
| /spec | haiku | $0.50 | Decomposition from known BRD |
| /design | haiku | $1.00 | Schema + mockup generation |
| /auto (solo) | sonnet | $5.00 | Code gen needs stronger model |
| /brownfield | haiku | $0.50 | Discovery of known project |
| /code-map | haiku | $0.20 | Structural analysis |
| LLM validations (4x) | haiku | $0.10 each | Quick pass/fail checks |
| **Total** | | **~$8.30 max** | |

## Test Execution Flow

```
1. Create temp directory (/tmp/harness-e2e-{timestamp}/)
2. cd into temp directory
3. Run /scaffold → validate artifacts
4. Run /brd with canned prompt → validate BRD + phase eval
5. Run /spec → validate stories + features.json + phase eval
6. Run /design → validate design artifacts + phase eval
7. Run /auto --mode solo → validate code + tests + telemetry records
8. Run /brownfield → validate discovery maps + phase eval
9. Run /code-map → validate graph
10. Flush telemetry (replay-telemetry.js)
11. Query Prometheus → validate metrics exist
12. Playwright → screenshot Grafana dashboard
13. Print summary: stages passed/failed, budget used, screenshots saved
14. Cleanup temp directory (unless --keep-artifacts flag)
```

## Success Criteria

1. All 9 stages produce expected artifacts (file existence checks)
2. Phase evaluator runs on stages 2-6 (eval JSON files exist)
3. LLM validation passes on BRD, spec, design, brownfield (advisory)
4. /auto produces runnable code (exit code 0 on basic commands)
5. Telemetry records exist in JSONL files
6. Prometheus has metrics (if telemetry stack running)
7. Grafana dashboard loads and shows panels (if stack running)
8. Total cost under $10

## Non-Goals

- Performance benchmarking (not measuring latency)
- Multi-user testing (single developer flow)
- CI/CD integration (manual run for now — can add later)
- Testing /improve, /refactor, /fix-issue, /vibe (separate test suites)
- Testing /deploy (Docker-in-Docker complexity)
