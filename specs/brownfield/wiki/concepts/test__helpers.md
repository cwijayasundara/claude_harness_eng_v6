# Concept: test/helpers

> Deterministic concept page (hash-cached). Not LLM prose.

## Summary

Cluster `test/helpers` groups **5** file(s) (hub fan-in hint 31).

## Files

- `test/helpers/hook-fixture.js` (hash d2bff8c6a7516435)
- `test/helpers/pipeline-status-fixtures.js` (hash aef89497cb41d312)
- `test/helpers/pre-commit-fixtures.js` (hash a5714f16842662e2)
- `test/helpers/record-run-fixture.js` (hash 82ee1e77fbf922f4)
- `test/helpers/skill-corpus.js` (hash 3610a6955dc068ab)

## Symbols

- `makeHookProject`
- `makeGitProject`
- `runGitHook`
- `runHook`
- `makeProject`
- `midBuildProject`
- `stage`
- `installContractSchema`
- `armContractGate`
- `withGateway`
- `withGatewayStatus`
- `withGatewayRequests`
- `copyHookLibFiles`
- `copyHarnessFiles`
- `writeState`
- `writeSkills`
- `readSkillCorpus`
- `skillEntryLineCount`

## Repo notes (steering)

- Primary harness control plane lives under .claude/ (hooks, scripts, skills). Brownfield navigation artifacts live under specs/brownfield/. Prefer /context or nav-query pack before broad source reads.

## Inbound edges (sample)

- test/auto-continue-on-stop.test.js → test/helpers/hook-fixture.js (imports)
- test/auto-multi-context-window.test.js → test/helpers/skill-corpus.js (imports)
- test/auto-per-cluster-contract.test.js → test/helpers/skill-corpus.js (imports)
- test/autonomous-build-contract.test.js → test/helpers/skill-corpus.js (imports)
- test/build-auto-merge-contract.test.js → test/helpers/skill-corpus.js (imports)
- test/build-chain-contract.test.js → test/helpers/skill-corpus.js (imports)
- test/build-lane.test.js → test/helpers/skill-corpus.js (imports)
- test/canvas-wiring-contract.test.js → test/helpers/skill-corpus.js (imports)
- test/check-git-hooks.test.js → test/helpers/hook-fixture.js (imports)
- test/commit-msg-git-hook.test.js → test/helpers/hook-fixture.js (imports)
- test/concurrency-gate-doc-contract.test.js → test/helpers/skill-corpus.js (imports)
- test/contract-accessibility-default.test.js → test/helpers/skill-corpus.js (imports)
- test/coupling-gate-wiring-contract.test.js → test/helpers/skill-corpus.js (imports)
- test/coverage-preflight.test.js → test/helpers/hook-fixture.js (imports)
- test/cycle-gate-wiring-contract.test.js → test/helpers/skill-corpus.js (imports)

## Citations

Source of truth: `specs/brownfield/code-graph.json`. Prefer `/context` or `nav-query pack` for task-scoped reads.
