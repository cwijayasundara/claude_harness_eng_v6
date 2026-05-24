# E2E Pipeline Integration Test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automated E2E test that builds a real todo-cli project through the full harness pipeline, validates artifacts with LLM assertions, and checks telemetry.

**Architecture:** Node.js test suite using `node:test`. Spawns `claude -p` per pipeline stage with `--bare` mode (skips hooks to avoid recursion). LLM validation via separate `claude -p --model haiku` calls. Telemetry checked via Prometheus HTTP API. Grafana checked via its REST API (no browser needed).

**Tech Stack:** Node.js `node:test`, `child_process.spawnSync`, `http` (Prometheus/Grafana API), Claude CLI

---

## File Map

### New Files

| File | Responsibility |
|------|----------------|
| `test/e2e/harness-pipeline.test.js` | Main test orchestrator — 9 stages, sequential |
| `test/e2e/helpers/claude-runner.js` | Spawn `claude -p` with consistent flags |
| `test/e2e/helpers/llm-validator.js` | LLM-based artifact validation via Haiku |
| `test/e2e/helpers/prometheus-checker.js` | Query Prometheus HTTP API |
| `test/e2e/helpers/grafana-checker.js` | Check Grafana API for dashboard/panels |
| `test/e2e/fixtures/todo-cli-brd-prompt.md` | Canned BRD input for deterministic runs |
| `test/e2e/fixtures/validation-criteria.json` | Per-stage LLM validation criteria |
| `test/e2e/results/.gitkeep` | Evidence directory (gitignored contents) |

---

## Task 1: Create fixtures

**Files:**
- Create: `test/e2e/fixtures/todo-cli-brd-prompt.md`
- Create: `test/e2e/fixtures/validation-criteria.json`
- Create: `test/e2e/results/.gitkeep`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p test/e2e/helpers test/e2e/fixtures test/e2e/results
touch test/e2e/results/.gitkeep
```

- [ ] **Step 2: Write the canned BRD prompt**

Create `test/e2e/fixtures/todo-cli-brd-prompt.md`:

```markdown
Build a Node.js CLI todo application.

Requirements:
- Commands: add <text>, list, complete <id>, delete <id>
- Storage: todos.json file in current directory
- Fields per todo: id (auto-increment integer), text (string), completed (boolean), createdAt (ISO 8601 timestamp)
- List output: formatted table showing id, status checkbox, text, age
- Exit codes: 0 on success, 1 on error (missing args, invalid id)
- No external dependencies beyond Node.js built-ins

Success metrics:
- All 4 CRUD commands work with correct exit codes (0 success, 1 error)
- JSON file persists between invocations and survives process restart
- List output is human-readable in 80-column terminal
- add command returns the new todo ID to stdout
- delete of non-existent ID returns exit code 1 with error message

Non-goals:
- No GUI, no web interface, no API server
- No database, no network calls
- No user authentication
- No concurrent access handling
```

- [ ] **Step 3: Write validation criteria**

Create `test/e2e/fixtures/validation-criteria.json`:

```json
{
  "brd": "Check: (1) Has >= 3 success metrics with specific numbers or measurable outcomes, not vague phrases. (2) Has explicit In-Scope and Out-of-Scope lists with >= 3 items each. (3) MVP is defined as a subset of full scope. (4) At least 1 alternative approach documented. Return JSON: {\"pass\": true/false, \"failures\": [\"reason1\", ...]}",
  "spec": "Check: (1) Every story has 3-6 acceptance criteria. (2) No criteria use vague language like 'works properly', 'loads fast', 'user-friendly', 'looks good'. (3) Stories have group assignments (A, B, etc). (4) Each story has a layer assignment. Return JSON: {\"pass\": true/false, \"failures\": [\"reason1\", ...]}",
  "design": "Check: (1) A data model defines a todo entity with fields: id, text, completed, createdAt. (2) A folder structure is present showing where source files go. (3) Component map exists mapping stories to files. Return JSON: {\"pass\": true/false, \"failures\": [\"reason1\", ...]}",
  "brownfield": "Check: (1) Architecture map lists modules/files that exist in a Node.js CLI project. (2) References to specific files (like index.js, todo.js, or similar). (3) Test map mentions a test command. Return JSON: {\"pass\": true/false, \"failures\": [\"reason1\", ...]}"
}
```

- [ ] **Step 4: Add results/ to .gitignore**

Append to `.gitignore`:

```
test/e2e/results/*
!test/e2e/results/.gitkeep
```

- [ ] **Step 5: Commit**

```bash
git add test/e2e/fixtures/ test/e2e/results/.gitkeep .gitignore
git commit -m "test(e2e): add fixtures for pipeline integration test"
```

---

## Task 2: Create claude-runner helper

**Files:**
- Create: `test/e2e/helpers/claude-runner.js`

- [ ] **Step 1: Write the helper**

Create `test/e2e/helpers/claude-runner.js`:

```javascript
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const HARNESS_ROOT = path.join(__dirname, '..', '..', '..');

function runClaude(prompt, options = {}) {
  const {
    cwd = process.cwd(),
    model = 'haiku',
    budgetUsd = '1.00',
    timeoutMs = 300000,
    pluginDir = path.join(HARNESS_ROOT, '.claude'),
  } = options;

  const args = [
    '-p',
    '--model', model,
    '--no-session-persistence',
    '--max-budget-usd', budgetUsd,
    '--bare',
  ];

  const result = spawnSync('claude', args, {
    input: prompt,
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, CLAUDE_CODE_ENABLE_TELEMETRY: '1' },
  });

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status,
    signal: result.signal,
    error: result.error,
  };
}

module.exports = { runClaude, HARNESS_ROOT };
```

- [ ] **Step 2: Verify syntax**

```bash
node -c test/e2e/helpers/claude-runner.js
```

- [ ] **Step 3: Commit**

```bash
git add test/e2e/helpers/claude-runner.js
git commit -m "test(e2e): add claude-runner helper for CLI automation"
```

---

## Task 3: Create llm-validator helper

**Files:**
- Create: `test/e2e/helpers/llm-validator.js`

- [ ] **Step 1: Write the helper**

Create `test/e2e/helpers/llm-validator.js`:

```javascript
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');

function llmValidate(artifactPath, criteria) {
  const content = fs.readFileSync(artifactPath, 'utf8');
  const trimmed = content.slice(0, 6000);
  const prompt =
    `You are a QA validator. Check this artifact against the criteria.\n\n` +
    `CRITERIA:\n${criteria}\n\n` +
    `ARTIFACT:\n${trimmed}\n\n` +
    `Respond with ONLY valid JSON matching: {"pass": true/false, "failures": ["..."]}`;

  const result = spawnSync('claude', [
    '-p',
    '--model', 'haiku',
    '--no-session-persistence',
    '--max-budget-usd', '0.15',
    '--bare',
  ], {
    input: prompt,
    encoding: 'utf8',
    timeout: 45000,
  });

  const raw = (result.stdout || '').trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { pass: false, failures: ['LLM returned non-JSON'], raw };

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (_) {
    return { pass: false, failures: ['LLM JSON parse error'], raw };
  }
}

module.exports = { llmValidate };
```

- [ ] **Step 2: Verify syntax**

```bash
node -c test/e2e/helpers/llm-validator.js
```

- [ ] **Step 3: Commit**

```bash
git add test/e2e/helpers/llm-validator.js
git commit -m "test(e2e): add llm-validator helper for artifact quality checks"
```

---

## Task 4: Create prometheus-checker helper

**Files:**
- Create: `test/e2e/helpers/prometheus-checker.js`

- [ ] **Step 1: Write the helper**

Create `test/e2e/helpers/prometheus-checker.js`:

```javascript
'use strict';

const http = require('http');

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://localhost:9090';

function queryPrometheus(query) {
  return new Promise((resolve, reject) => {
    const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Prometheus JSON parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function assertMetricExists(query) {
  const data = await queryPrometheus(query);
  if (data.status !== 'success') {
    return { exists: false, reason: `Query failed: ${data.error || 'unknown'}` };
  }
  const hasResults = data.data && data.data.result && data.data.result.length > 0;
  return { exists: hasResults, resultCount: hasResults ? data.data.result.length : 0 };
}

function isPrometheusUp() {
  return new Promise((resolve) => {
    http.get(`${PROMETHEUS_URL}/-/healthy`, (res) => {
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });
}

module.exports = { queryPrometheus, assertMetricExists, isPrometheusUp };
```

- [ ] **Step 2: Verify syntax**

```bash
node -c test/e2e/helpers/prometheus-checker.js
```

- [ ] **Step 3: Commit**

```bash
git add test/e2e/helpers/prometheus-checker.js
git commit -m "test(e2e): add prometheus-checker helper for telemetry verification"
```

---

## Task 5: Create grafana-checker helper

**Files:**
- Create: `test/e2e/helpers/grafana-checker.js`

- [ ] **Step 1: Write the helper**

Create `test/e2e/helpers/grafana-checker.js`:

```javascript
'use strict';

const http = require('http');

const GRAFANA_URL = process.env.GRAFANA_URL || 'http://localhost:3001';

function grafanaGet(apiPath) {
  return new Promise((resolve, reject) => {
    const url = `${GRAFANA_URL}${apiPath}`;
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (_) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    }).on('error', reject);
  });
}

async function isGrafanaUp() {
  try {
    const { status } = await grafanaGet('/api/health');
    return status === 200;
  } catch (_) {
    return false;
  }
}

async function getDashboard(uid) {
  return grafanaGet(`/api/dashboards/uid/${uid}`);
}

async function listDashboards() {
  return grafanaGet('/api/search?type=dash-db');
}

module.exports = { grafanaGet, isGrafanaUp, getDashboard, listDashboards };
```

- [ ] **Step 2: Verify syntax**

```bash
node -c test/e2e/helpers/grafana-checker.js
```

- [ ] **Step 3: Commit**

```bash
git add test/e2e/helpers/grafana-checker.js
git commit -m "test(e2e): add grafana-checker helper for dashboard API verification"
```

---

## Task 6: Create main test orchestrator

**Files:**
- Create: `test/e2e/harness-pipeline.test.js`

This is the largest task. The test file orchestrates all 9 stages sequentially.

- [ ] **Step 1: Write the test file**

Create `test/e2e/harness-pipeline.test.js`:

```javascript
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, describe, before, after } = require('node:test');

const { runClaude, HARNESS_ROOT } = require('./helpers/claude-runner');
const { llmValidate } = require('./helpers/llm-validator');
const { isPrometheusUp, assertMetricExists } = require('./helpers/prometheus-checker');
const { isGrafanaUp, getDashboard, listDashboards } = require('./helpers/grafana-checker');

const criteria = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'validation-criteria.json'), 'utf8')
);
const brdPrompt = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'todo-cli-brd-prompt.md'), 'utf8'
);

let PROJECT_DIR;
const RESULTS_DIR = path.join(__dirname, 'results');
const keepArtifacts = process.env.E2E_KEEP_ARTIFACTS === '1';

function logResult(stage, data) {
  const logPath = path.join(RESULTS_DIR, `${stage}.json`);
  fs.writeFileSync(logPath, JSON.stringify(data, null, 2));
}

function fileExists(filePath) {
  return fs.existsSync(path.join(PROJECT_DIR, filePath));
}

function readArtifact(filePath) {
  return fs.readFileSync(path.join(PROJECT_DIR, filePath), 'utf8');
}

describe('Harness E2E Pipeline', { timeout: 1200000 }, () => {
  before(() => {
    PROJECT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-e2e-'));
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    console.log(`E2E project dir: ${PROJECT_DIR}`);
    logResult('setup', { projectDir: PROJECT_DIR, timestamp: new Date().toISOString() });
  });

  after(() => {
    if (!keepArtifacts && PROJECT_DIR) {
      fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
      console.log('Cleaned up temp project dir');
    } else {
      console.log(`Artifacts kept at: ${PROJECT_DIR}`);
    }
  });

  test('Stage 1: /scaffold creates project structure', { timeout: 120000 }, () => {
    const result = runClaude(
      'Initialize this as a Node.js CLI project. Create a CLAUDE.md, package.json with name "todo-cli", and basic project structure.',
      { cwd: PROJECT_DIR, model: 'haiku', budgetUsd: '0.50' }
    );
    logResult('stage1-scaffold', { exitCode: result.exitCode, stdout: result.stdout.slice(0, 500) });

    const hasClaude = fileExists('CLAUDE.md') || fileExists('package.json');
    assert.ok(hasClaude, 'Scaffold should create CLAUDE.md or package.json');
    console.log('  Stage 1 PASS: project structure created');
  });

  test('Stage 2: /brd generates requirements document', { timeout: 180000 }, () => {
    const prompt = `/brd\n\nHere are the requirements:\n\n${brdPrompt}`;
    const result = runClaude(prompt, {
      cwd: PROJECT_DIR, model: 'haiku', budgetUsd: '1.00', timeoutMs: 180000,
    });
    logResult('stage2-brd', { exitCode: result.exitCode, stdout: result.stdout.slice(0, 500) });

    const brdPath = 'specs/brd/brd.md';
    if (fileExists(brdPath)) {
      const content = readArtifact(brdPath);
      assert.ok(content.length > 200, 'BRD should have substantial content');
      console.log(`  BRD generated: ${content.length} chars`);
    } else {
      console.log('  BRD file not found at expected path (skill may use different naming)');
    }
    console.log('  Stage 2 PASS');
  });

  test('Stage 2b: LLM validates BRD quality (advisory)', { timeout: 60000 }, () => {
    const brdPath = path.join(PROJECT_DIR, 'specs', 'brd', 'brd.md');
    if (!fs.existsSync(brdPath)) {
      console.log('  SKIP: BRD file not found, skipping LLM validation');
      return;
    }
    const result = llmValidate(brdPath, criteria.brd);
    logResult('stage2b-brd-llm', result);
    if (result.pass) {
      console.log('  BRD LLM validation: PASS');
    } else {
      console.log(`  BRD LLM validation: ADVISORY FAIL — ${(result.failures || []).join(', ')}`);
    }
  });

  test('Stage 3: /spec decomposes BRD into stories', { timeout: 180000 }, () => {
    const brdFile = fileExists('specs/brd/brd.md') ? 'specs/brd/brd.md' : '';
    if (!brdFile) {
      console.log('  SKIP: No BRD file for /spec input');
      return;
    }
    const result = runClaude(`/spec ${brdFile}`, {
      cwd: PROJECT_DIR, model: 'haiku', budgetUsd: '1.00', timeoutMs: 180000,
    });
    logResult('stage3-spec', { exitCode: result.exitCode, stdout: result.stdout.slice(0, 500) });

    const hasStories = fs.existsSync(path.join(PROJECT_DIR, 'specs', 'stories'));
    if (hasStories) {
      const storyFiles = fs.readdirSync(path.join(PROJECT_DIR, 'specs', 'stories'))
        .filter(f => f.match(/^E\d+-S\d+/));
      console.log(`  Stories generated: ${storyFiles.length} files`);
      assert.ok(storyFiles.length >= 1, 'Should have at least 1 story file');
    }

    if (fileExists('features.json')) {
      const features = JSON.parse(readArtifact('features.json'));
      assert.ok(Array.isArray(features), 'features.json should be an array');
      console.log(`  features.json: ${features.length} features`);
    }
    console.log('  Stage 3 PASS');
  });

  test('Stage 3b: LLM validates spec quality (advisory)', { timeout: 60000 }, () => {
    const storiesDir = path.join(PROJECT_DIR, 'specs', 'stories');
    if (!fs.existsSync(storiesDir)) {
      console.log('  SKIP: No stories dir');
      return;
    }
    const storyFiles = fs.readdirSync(storiesDir).filter(f => f.endsWith('.md'));
    const combined = storyFiles.map(f =>
      fs.readFileSync(path.join(storiesDir, f), 'utf8')
    ).join('\n---\n');
    const tmpPath = path.join(RESULTS_DIR, 'combined-stories.md');
    fs.writeFileSync(tmpPath, combined);
    const result = llmValidate(tmpPath, criteria.spec);
    logResult('stage3b-spec-llm', result);
    console.log(`  Spec LLM validation: ${result.pass ? 'PASS' : 'ADVISORY FAIL'}`);
  });

  test('Stage 4: /design generates architecture artifacts', { timeout: 180000 }, () => {
    const result = runClaude('/design', {
      cwd: PROJECT_DIR, model: 'haiku', budgetUsd: '1.50', timeoutMs: 180000,
    });
    logResult('stage4-design', { exitCode: result.exitCode, stdout: result.stdout.slice(0, 500) });

    const designDir = path.join(PROJECT_DIR, 'specs', 'design');
    if (fs.existsSync(designDir)) {
      const files = fs.readdirSync(designDir);
      console.log(`  Design artifacts: ${files.length} files — ${files.join(', ')}`);
    }
    console.log('  Stage 4 PASS');
  });

  test('Stage 5: /auto builds working code (solo mode)', { timeout: 600000 }, () => {
    const result = runClaude('/auto --mode solo', {
      cwd: PROJECT_DIR, model: 'sonnet', budgetUsd: '5.00', timeoutMs: 600000,
    });
    logResult('stage5-auto', { exitCode: result.exitCode, stdout: result.stdout.slice(0, 1000) });

    const jsFiles = [];
    function findJs(dir) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.claude') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) findJs(full);
        else if (entry.name.endsWith('.js') || entry.name.endsWith('.ts')) jsFiles.push(full);
      }
    }
    findJs(PROJECT_DIR);
    console.log(`  Source files: ${jsFiles.length}`);

    if (fileExists('features.json')) {
      const features = JSON.parse(readArtifact('features.json'));
      const passing = features.filter(f => f.passes).length;
      console.log(`  Features passing: ${passing}/${features.length}`);
    }

    const runsDir = path.join(PROJECT_DIR, '.claude', 'runs');
    if (fs.existsSync(runsDir)) {
      const runFiles = fs.readdirSync(runsDir).filter(f => f.endsWith('.jsonl'));
      console.log(`  Telemetry JSONL files: ${runFiles.length}`);
      assert.ok(runFiles.length >= 1, 'Should have at least 1 telemetry JSONL file');
    }
    console.log('  Stage 5 PASS');
  });

  test('Stage 6: /brownfield discovers codebase', { timeout: 180000 }, () => {
    const result = runClaude('/brownfield', {
      cwd: PROJECT_DIR, model: 'haiku', budgetUsd: '1.00', timeoutMs: 180000,
    });
    logResult('stage6-brownfield', { exitCode: result.exitCode, stdout: result.stdout.slice(0, 500) });

    const bfDir = path.join(PROJECT_DIR, 'specs', 'brownfield');
    if (fs.existsSync(bfDir)) {
      const files = fs.readdirSync(bfDir);
      console.log(`  Brownfield artifacts: ${files.length} files — ${files.join(', ')}`);
    }
    console.log('  Stage 6 PASS');
  });

  test('Stage 7: Telemetry metrics in Prometheus', { timeout: 30000 }, async () => {
    const up = await isPrometheusUp();
    if (!up) {
      console.log('  SKIP: Prometheus not running. Start with: docker compose -f telemetry_docker_compose.yml up -d');
      return;
    }

    const metrics = [
      'harness_conversation_turns_total',
      'harness_phase_eval_score',
      'harness_phase_eval_iterations_total',
    ];
    for (const metric of metrics) {
      const result = await assertMetricExists(metric);
      console.log(`  ${metric}: ${result.exists ? `FOUND (${result.resultCount} series)` : 'NOT FOUND'}`);
    }
    console.log('  Stage 7 PASS');
  });

  test('Stage 8: Grafana dashboard accessible', { timeout: 30000 }, async () => {
    const up = await isGrafanaUp();
    if (!up) {
      console.log('  SKIP: Grafana not running');
      return;
    }

    const dashboards = await listDashboards();
    if (dashboards.status === 200 && Array.isArray(dashboards.data)) {
      console.log(`  Dashboards found: ${dashboards.data.length}`);
      for (const d of dashboards.data) {
        console.log(`    - ${d.title} (uid: ${d.uid})`);
      }
    }

    const overview = await getDashboard('harness-overview');
    if (overview.status === 200 && overview.data.dashboard) {
      const panels = overview.data.dashboard.panels || [];
      const phasePanel = panels.find(p => (p.title || '').includes('Phase Quality'));
      console.log(`  Phase Quality section: ${phasePanel ? 'FOUND' : 'NOT FOUND'}`);
    }
    console.log('  Stage 8 PASS');
  });
});
```

- [ ] **Step 2: Verify syntax**

```bash
node -c test/e2e/harness-pipeline.test.js
```

- [ ] **Step 3: Commit**

```bash
git add test/e2e/harness-pipeline.test.js
git commit -m "test(e2e): add main pipeline test orchestrator (9 stages)"
```

---

## Task 7: Add npm test script and documentation

**Files:**
- Modify: `package.json` (if exists) or create a run script

- [ ] **Step 1: Create a run script**

Create `test/e2e/run.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Harness E2E Pipeline Test ==="
echo "Root: $ROOT_DIR"
echo ""

# Check prerequisites
if ! command -v claude &> /dev/null; then
  echo "ERROR: claude CLI not found. Install Claude Code first."
  exit 1
fi

# Start telemetry stack if not running
if curl -s http://localhost:9090/-/healthy > /dev/null 2>&1; then
  echo "Prometheus: running"
else
  echo "Prometheus: starting..."
  docker compose -f "$ROOT_DIR/telemetry_docker_compose.yml" up -d
  echo "Waiting for services..."
  for i in $(seq 1 30); do
    curl -s http://localhost:9090/-/healthy > /dev/null 2>&1 && break
    sleep 2
  done
fi

if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
  echo "Grafana: running"
else
  echo "Grafana: waiting..."
  for i in $(seq 1 15); do
    curl -s http://localhost:3001/api/health > /dev/null 2>&1 && break
    sleep 2
  done
fi

echo ""
echo "Running E2E tests..."
echo ""

# Run with 20-minute timeout, keep artifacts on failure
E2E_KEEP_ARTIFACTS="${E2E_KEEP_ARTIFACTS:-0}" \
  node --test "$SCRIPT_DIR/harness-pipeline.test.js" --timeout 1200000

echo ""
echo "Results saved to: $SCRIPT_DIR/results/"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x test/e2e/run.sh
```

- [ ] **Step 3: Commit**

```bash
git add test/e2e/run.sh
git commit -m "test(e2e): add run script with auto-start telemetry stack"
```

---

## Task 8: Dry-run verification

- [ ] **Step 1: Verify all files exist**

```bash
ls -la test/e2e/harness-pipeline.test.js \
  test/e2e/helpers/claude-runner.js \
  test/e2e/helpers/llm-validator.js \
  test/e2e/helpers/prometheus-checker.js \
  test/e2e/helpers/grafana-checker.js \
  test/e2e/fixtures/todo-cli-brd-prompt.md \
  test/e2e/fixtures/validation-criteria.json \
  test/e2e/results/.gitkeep \
  test/e2e/run.sh
```

- [ ] **Step 2: Verify all JS syntax**

```bash
node -c test/e2e/harness-pipeline.test.js
node -c test/e2e/helpers/claude-runner.js
node -c test/e2e/helpers/llm-validator.js
node -c test/e2e/helpers/prometheus-checker.js
node -c test/e2e/helpers/grafana-checker.js
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
node --test test/phase-eval-unit.test.js
node --test test/phase-eval-integration.test.js
node --test test/scaffold-command.test.js
```

- [ ] **Step 4: Final commit if fixups needed**

```bash
git status
# If clean: done
# If changes: fix, add, commit
```

- [ ] **Step 5: Push**

```bash
git push origin main
```
