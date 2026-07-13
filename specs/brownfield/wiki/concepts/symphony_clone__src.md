# Concept: symphony_clone/src

> Deterministic concept page (hash-cached). Not LLM prose.

## Summary

Cluster `symphony_clone/src` groups **30** file(s) (hub fan-in hint 7).

## Files

- `symphony_clone/src/config.js` (hash 48a66df124d63de7)
- `symphony_clone/src/config.test.js` (hash b36e83c7bf59ba30)
- `symphony_clone/src/index.js` (hash 4243871cd3b855db)
- `symphony_clone/src/index.test.js` (hash ea519c0e62628632)
- `symphony_clone/src/observability/logger.js` (hash ab1866979c7314b6)
- `symphony_clone/src/observability/status-server.js` (hash 9c39e9a9a3b9aa03)
- `symphony_clone/src/orchestrator/claude-runner.js` (hash bbac2b770e2b0007)
- `symphony_clone/src/orchestrator/claude-runner.test.js` (hash ce4616ae2c17afdf)
- `symphony_clone/src/orchestrator/eligibility.js` (hash 8ca00a5fcbb48cb4)
- `symphony_clone/src/orchestrator/eligibility.test.js` (hash d7ef2610fb922ce8)
- `symphony_clone/src/orchestrator/outcomes.js` (hash 627f43631178ac07)
- `symphony_clone/src/orchestrator/outcomes.test.js` (hash 7bcac3f085f84a39)
- `symphony_clone/src/orchestrator/planning-prompt.js` (hash 85bd3fc6787e9132)
- `symphony_clone/src/orchestrator/planning-prompt.test.js` (hash 4e378727b5ab7577)
- `symphony_clone/src/orchestrator/pr.js` (hash 4210e7aa625009e6)
- `symphony_clone/src/orchestrator/pr.test.js` (hash 7c83041f5d8c357d)
- `symphony_clone/src/orchestrator/prompt-builder.js` (hash ea2fbf2e7fc15171)
- `symphony_clone/src/orchestrator/result-reader.js` (hash 448fb1f7179853bc)
- `symphony_clone/src/orchestrator/scheduler.js` (hash 67b2537b0fe71d99)
- `symphony_clone/src/orchestrator/scheduler.test.js` (hash 7b5e036144eda4fa)
- `symphony_clone/src/orchestrator/state-store.js` (hash 53ba6a9f3ae093f8)
- `symphony_clone/src/orchestrator/workspace-manager.js` (hash 64ff6b8dc79f4071)
- `symphony_clone/src/tracker/azure.js` (hash c302345cd5e9c733)
- `symphony_clone/src/tracker/azure.test.js` (hash ba252b7eba16f61e)
- `symphony_clone/src/tracker/http.js` (hash 6040ad4897b95aca)
- `symphony_clone/src/tracker/http.test.js` (hash 2cf90e4e97971d47)
- `symphony_clone/src/tracker/jira.js` (hash 1706f92739925bce)
- `symphony_clone/src/tracker/jira.test.js` (hash d7e673dbbd7c8d9e)
- `symphony_clone/src/tracker/linear.js` (hash 7ea80d030528761d)
- `symphony_clone/src/tracker/linear.test.js` (hash f25627b7ad9f5c06)

## Symbols

- `intFromEnv`
- `splitList`
- `requiredEnv`
- `loadEnvFile`
- `parseEnvFile`
- `loadConfig`
- `normalizeProvider`
- `maybeLoadDotEnv`
- `resolveRetention`
- `buildRetry`
- `buildGithub`
- `normalizeMergeMethod`
- `buildAutoMerge`
- `buildTracker`
- `buildLinear`
- `buildJira`
- `buildAzure`
- `resolveMaxWallclockMs`
- `intFromEnvWithEnv`
- `validateConfig`
- `baseEnv`
- `main`
- `createTracker`
- `makeSerializedTick`

## Repo notes (steering)

- Primary harness control plane lives under .claude/ (hooks, scripts, skills). Brownfield navigation artifacts live under specs/brownfield/. Prefer /context or nav-query pack before broad source reads.

## Inbound edges (sample)

- symphony_clone/scripts/create-group-issue.js → symphony_clone/src/config.js (imports)
- symphony_clone/scripts/diagnose-linear.js → symphony_clone/src/config.js (imports)
- symphony_clone/test/config.test.js → symphony_clone/src/config.js (imports)
- symphony_clone/test/linear-state.test.js → symphony_clone/src/tracker/linear.js (imports)
- symphony_clone/test/prompt-builder.test.js → symphony_clone/src/orchestrator/prompt-builder.js (imports)
- symphony_clone/test/prompt-builder.test.js → symphony_clone/src/orchestrator/claude-runner.js (imports)
- symphony_clone/test/result-reader.test.js → symphony_clone/src/orchestrator/result-reader.js (imports)
- symphony_clone/test/scheduler-resume.test.js → symphony_clone/src/orchestrator/scheduler.js (imports)
- symphony_clone/test/scheduler-routing.test.js → symphony_clone/src/orchestrator/scheduler.js (imports)
- symphony_clone/test/scheduler.test.js → symphony_clone/src/orchestrator/scheduler.js (imports)
- symphony_clone/test/scheduler.test.js → symphony_clone/src/orchestrator/scheduler.js (imports)
- symphony_clone/test/scheduler.test.js → symphony_clone/src/orchestrator/scheduler.js (imports)
- symphony_clone/test/state-store.test.js → symphony_clone/src/orchestrator/state-store.js (imports)
- symphony_clone/test/status-server.test.js → symphony_clone/src/observability/status-server.js (imports)
- symphony_clone/test/workspace-manager-recovery.test.js → symphony_clone/src/orchestrator/workspace-manager.js (imports)

## Citations

Source of truth: `specs/brownfield/code-graph.json`. Prefer `/context` or `nav-query pack` for task-scoped reads.
