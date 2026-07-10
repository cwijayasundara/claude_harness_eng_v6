# Coupling Report

- Files: **346**
- Internal edges: **164**
- External imports: **1354**
- Cycles: **0**

## Top hubs (by fan-in)

| File | Fan-in | Fan-out | Instability |
|---|---:|---:|---:|
| `test/helpers/hook-fixture.js` | 23 | 0 | 0 |
| `test/e2e/helpers/claude-runner.js` | 17 | 0 | 0 |
| `test/helpers/skill-corpus.js` | 13 | 0 | 0 |
| `test/e2e/helpers/project-suite.js` | 9 | 0 | 0 |
| `test/helpers/pre-commit-fixtures.js` | 8 | 0 | 0 |
| `symphony_clone/src/orchestrator/scheduler.js` | 7 | 6 | 0.462 |
| `test/e2e/helpers/fresh-project.js` | 5 | 0 | 0 |
| `symphony_clone/src/config.js` | 5 | 0 | 0 |
| `symphony_clone/src/orchestrator/workspace-manager.js` | 5 | 0 | 0 |
| `test/e2e/helpers/prometheus-checker.js` | 4 | 0 | 0 |

## Dead-code candidates (no inbound edges)

_Verify dynamic references (`getattr`, registries, entry points) before deleting._

- `eslint.config.js`
- `symphony_clone/scripts/create-group-issue.js`
- `symphony_clone/scripts/diagnose-linear.js`
- `symphony_clone/src/config.test.js`
- `symphony_clone/src/index.test.js`
- `symphony_clone/src/orchestrator/claude-runner.test.js`
- `symphony_clone/src/orchestrator/eligibility.test.js`
- `symphony_clone/src/orchestrator/outcomes.test.js`
- `symphony_clone/src/orchestrator/planning-prompt.test.js`
- `symphony_clone/src/orchestrator/pr.test.js`
- `symphony_clone/src/orchestrator/scheduler.test.js`
- `symphony_clone/src/tracker/azure.test.js`
- `symphony_clone/src/tracker/http.test.js`
- `symphony_clone/src/tracker/jira.test.js`
- `symphony_clone/src/tracker/linear.test.js`
- `symphony_clone/test/config.test.js`
- `symphony_clone/test/feature-routing-docs.test.js`
- `symphony_clone/test/linear-state.test.js`
- `symphony_clone/test/prompt-builder.test.js`
- `symphony_clone/test/result-reader.test.js`
- … 279 more

