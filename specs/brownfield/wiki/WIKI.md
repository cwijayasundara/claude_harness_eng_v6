# Codebase Wiki

> Deterministic, always-current map rendered from `code-graph.json`. No LLM — re-rendered on graph change.

- Producer: `vendored-ast`  ·  Language: `mixed`
- Modules: 347  ·  Edges: 1522  ·  Clusters: 39

## Hubs (most-depended-on)

| Module | fan-in | fan-out |
|---|---|---|
| `js:test/helpers/hook-fixture.js` | 23 | 5 |
| `js:test/e2e/helpers/claude-runner.js` | 17 | 4 |
| `js:test/helpers/skill-corpus.js` | 13 | 2 |
| `js:test/e2e/helpers/project-suite.js` | 9 | 3 |
| `js:test/helpers/pre-commit-fixtures.js` | 8 | 3 |
| `js:symphony_clone/src/orchestrator/scheduler.js` | 7 | 6 |
| `js:symphony_clone/src/orchestrator/workspace-manager.js` | 5 | 4 |
| `js:test/e2e/helpers/fresh-project.js` | 5 | 3 |
| `js:symphony_clone/src/config.js` | 5 | 2 |
| `js:test/e2e/helpers/prometheus-checker.js` | 4 | 1 |

### Entry points (no inbound deps)

- `cs:test/fixtures/code-index/enterprise/web/App.cs`
- `go:test/fixtures/code-index/enterprise/internal/auth/auth.go`
- `go:test/fixtures/code-index/enterprise/main.go`
- `java:test/fixtures/code-index/enterprise/src/main/java/com/acme/App.java`
- `js:eslint.config.js`
- `js:symphony_clone/scripts/create-group-issue.js`
- `js:symphony_clone/scripts/diagnose-linear.js`
- `js:symphony_clone/src/config.test.js`
- `js:symphony_clone/src/index.test.js`
- `js:symphony_clone/src/orchestrator/claude-runner.test.js`
- `js:symphony_clone/src/orchestrator/eligibility.test.js`
- `js:symphony_clone/src/orchestrator/outcomes.test.js`
- `js:symphony_clone/src/orchestrator/planning-prompt.test.js`
- `js:symphony_clone/src/orchestrator/pr.test.js`
- `js:symphony_clone/src/orchestrator/scheduler.test.js`
- `js:symphony_clone/src/tracker/azure.test.js`
- `js:symphony_clone/src/tracker/http.test.js`
- `js:symphony_clone/src/tracker/jira.test.js`
- `js:symphony_clone/src/tracker/linear.test.js`
- `js:symphony_clone/test/config.test.js`
- `js:symphony_clone/test/feature-routing-docs.test.js`
- `js:symphony_clone/test/linear-state.test.js`
- `js:symphony_clone/test/prompt-builder.test.js`
- `js:symphony_clone/test/result-reader.test.js`
- `js:symphony_clone/test/scheduler-resume.test.js`

### Cycles

_(none)_

### External dependencies

_(none)_

## Pages

- [`test/` — 229 module(s)](pages/01-test.md) — 229 module(s)
- [`test/e2e/` — 18 module(s)](pages/02-test-e2e.md) — 18 module(s)
- [`symphony_clone/src/orchestrator/` — 16 module(s)](pages/03-symphony_clone-src-orchestrator.md) — 16 module(s)
- [`test/e2e/helpers/` — 14 module(s)](pages/04-test-e2e-helpers.md) — 14 module(s)
- [`symphony_clone/test/` — 13 module(s)](pages/05-symphony_clone-test.md) — 13 module(s)
- [`symphony_clone/src/tracker/` — 8 module(s)](pages/06-symphony_clone-src-tracker.md) — 8 module(s)
- [`test/helpers/` — 5 module(s)](pages/07-test-helpers.md) — 5 module(s)
- [`symphony_clone/src/` — 4 module(s)](pages/08-symphony_clone-src.md) — 4 module(s)
- [`test/evals/fixtures/calc-app/` — 3 module(s)](pages/09-test-evals-fixtures-calc-app.md) — 3 module(s)
- [`symphony_clone/scripts/` — 2 module(s)](pages/10-symphony_clone-scripts.md) — 2 module(s)
- [`symphony_clone/src/observability/` — 2 module(s)](pages/11-symphony_clone-src-observability.md) — 2 module(s)
- [`test/e2e/brownfield-run-output/` — 2 module(s)](pages/12-test-e2e-brownfield-run-output.md) — 2 module(s)
- [`test/e2e/fixtures/adversarial/brownfield/legacy-expressish/src/` — 2 module(s)](pages/13-test-e2e-fixtures-adversarial-brownfield-legacy-expressish-src.md) — 2 module(s)
- [`test/evals/helpers/` — 2 module(s)](pages/14-test-evals-helpers.md) — 2 module(s)
- [`test/fixtures/code-index/sample/src/` — 2 module(s)](pages/15-test-fixtures-code-index-sample-src.md) — 2 module(s)
- [`test/fixtures/mutation/` — 2 module(s)](pages/16-test-fixtures-mutation.md) — 2 module(s)
- [`(root)/` — 1 module(s)](pages/17-root.md) — 1 module(s)
- [`test/e2e/feature-output/` — 1 module(s)](pages/18-test-e2e-feature-output.md) — 1 module(s)
- [`test/e2e/feature-output/test/` — 1 module(s)](pages/19-test-e2e-feature-output-test.md) — 1 module(s)
- [`test/e2e/fixtures/adversarial/brownfield/file-ledger/src/` — 1 module(s)](pages/20-test-e2e-fixtures-adversarial-brownfield-file-ledger-src.md) — 1 module(s)

## Agent navigation

- Context pack: `node .claude/scripts/nav-query.js pack --budget 1600 "<question>"`
- Refresh secondary indexes: `node .claude/scripts/nav-query.js refresh`

_+ 19 smaller cluster(s) not paged (raise --max-pages)._
