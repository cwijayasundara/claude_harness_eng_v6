# Codebase map (human homepage)

> Living orientation document. Generated 2026-07-11T06:55:30.549Z from the code-graph + CONTEXT.
> Prefer this page + concept wiki over opening the whole tree.

## What this system is

A Claude Code plugin for building and changing software with a generator/evaluator loop, ratcheting quality gates, and explicit human review before merge.

_Source: `README.md`_

## At a glance

| Metric | Value |
|---|---|
| Indexed files | 346 |
| Graph edges | 1518 |
| Concept pages | 0 |
| Wiki cluster pages | 0 |

## How to run / test / gate

```bash
# project-specific — see README / init.sh
./init.sh                 # or docker compose up
npm test                 # or pytest / vitest
/gate                    # pre-merge quality gate
npm run quality-card     # trust receipt
npm run ask -- "..."     # ask the codebase
```

## Architecture (hub modules)

| Module | fan-in | fan-out |
|---|---|---|
| `test/helpers/hook-fixture.js` | 23 | 0 |
| `test/e2e/helpers/claude-runner.js` | 17 | 0 |
| `test/helpers/skill-corpus.js` | 13 | 0 |
| `test/e2e/helpers/project-suite.js` | 9 | 0 |
| `test/helpers/pre-commit-fixtures.js` | 8 | 0 |
| `symphony_clone/src/orchestrator/scheduler.js` | 7 | 6 |
| `test/e2e/helpers/fresh-project.js` | 5 | 0 |
| `symphony_clone/src/config.js` | 5 | 0 |
| `symphony_clone/src/orchestrator/workspace-manager.js` | 5 | 0 |
| `test/e2e/helpers/prometheus-checker.js` | 4 | 0 |
| `symphony_clone/src/tracker/http.js` | 4 | 0 |
| `symphony_clone/src/orchestrator/pr.js` | 3 | 1 |

## Entry points

- `test/e2e/brownfield-run-output/main.js`
- `test/evals/fixtures/clean-app/app.js`
- `test/fixtures/code-index/enterprise/main.go`
- `test/fixtures/code-index/sample/api/users.py`

## Concept pages (clusters)

_Run `node .claude/scripts/nav-concepts.js` or `nav-query.js refresh`._

## DeepWiki cluster pages

_Run `/code-map` to render `specs/brownfield/wiki/`._

## Critical paths & debugging

- Metrics path: `/metrics`
- SLO: error_rate_pct≤1 · p95_ms≤500
- Prefer structured logs with `request_id` / `X-Request-ID` correlation.
- Quality receipt after changes: `specs/reviews/quality-card.md`.
- Ask navigation: `npm run ask -- "where is auth validated?"`.

## If X breaks, start here

| Symptom | Start |
|---|---|
| Auth / session failures | concept or entry modules matching `auth` / `session` |
| Slow API | quality-card perf + `/metrics` + N+1 smells (`npm run perf-smell`) |
| Silent failures | structured logs + `request_id`; observability gate |
| Merge confidence | `specs/reviews/quality-card.md` + `walkthrough.md` |
| "Where is X?" | `npm run ask -- "X"` |

## Machine-readable companions

- `specs/brownfield/code-graph.json` — dependency DAG (agents + tools)
- `specs/brownfield/symbol-map.md` — symbols with line ranges
- `specs/brownfield/wiki/WIKI.md` — deterministic DeepWiki index
- `.harness/wiki.json` — steer wiki priorities (Devin `.devin/wiki.json` analogue)
