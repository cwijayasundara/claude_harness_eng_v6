# Concept: test/e2e

> Deterministic concept page (hash-cached). Not LLM prose.

## Summary

Cluster `test/e2e` groups **43** file(s) (hub fan-in hint 17).

## Files

- `test/e2e/brownfield-run-output/calc.js` (hash f11e571db3e0039a)
- `test/e2e/brownfield-run-output/main.js` (hash 21667b18f095526f)
- `test/e2e/feature-output/calc.js` (hash 28bda2e5df3eada9)
- `test/e2e/feature-output/test/calc.test.js` (hash 5e29b1dedb52b7d3)
- `test/e2e/fixtures/adversarial/brownfield/file-ledger/src/ledger.js` (hash 22e0a9ad51fcf3f4)
- `test/e2e/fixtures/adversarial/brownfield/file-ledger/test/ledger.test.js` (hash 0f3e3bcfd88577cf)
- `test/e2e/fixtures/adversarial/brownfield/legacy-expressish/src/public-api.js` (hash b877233a1bebab03)
- `test/e2e/fixtures/adversarial/brownfield/legacy-expressish/src/router.js` (hash cf1fef18b03cbbb2)
- `test/e2e/fixtures/adversarial/brownfield/legacy-expressish/test/public-api.test.js` (hash 88a574cd04003f09)
- `test/e2e/harness-adversarial-fixtures.test.js` (hash cd641cd127b8641b)
- `test/e2e/harness-adversarial-live.test.js` (hash cca0795a44067809)
- `test/e2e/harness-auto-run.test.js` (hash 28e42e4b65fadf10)
- `test/e2e/harness-brownfield-run.test.js` (hash 53319f379719aed3)
- `test/e2e/harness-brownfield.test.js` (hash 01f3aee74a25be21)
- `test/e2e/harness-feature-route.test.js` (hash a3bb8a7932823890)
- `test/e2e/harness-framework.test.js` (hash 1ba59d398742efb0)
- `test/e2e/harness-full-auto-run.test.js` (hash 706cc0268488f54d)
- `test/e2e/harness-gated-build.test.js` (hash 4618575fd1067364)
- `test/e2e/harness-native-commands.test.js` (hash 004fac8c27c84769)
- `test/e2e/harness-pipeline-build.test.js` (hash dbda8abe4d5faeb7)
- `test/e2e/harness-pipeline.test.js` (hash c564628b7d86c191)
- `test/e2e/harness-plan-only.test.js` (hash bf3ce666525d40d2)
- `test/e2e/harness-real-workflow.test.js` (hash eea4fc9134249e5f)
- `test/e2e/harness-selfheal-smoke.test.js` (hash 1331e5c394a13891)
- `test/e2e/harness-semi-auto-run.test.js` (hash d8ab4c80f54e00d4)
- `test/e2e/harness-vibe-run.test.js` (hash 4b8ea505613827df)
- `test/e2e/helpers/alter-and-verify.js` (hash a66a10415a792e7f)
- `test/e2e/helpers/alter-and-verify.test.js` (hash 8524961c99b1933e)
- `test/e2e/helpers/app-runtime.js` (hash 9eb7dc6f53bbba2c)
- `test/e2e/helpers/app-runtime.test.js` (hash 3d66ead5dc224dbd)
- `test/e2e/helpers/claude-runner.js` (hash 74c90dbeb61c9cdc)
- `test/e2e/helpers/claude-runner.test.js` (hash bd5d326d2bebf246)
- `test/e2e/helpers/fresh-project.js` (hash 3ef62deb0cf369fd)
- `test/e2e/helpers/fresh-project.test.js` (hash e9a35880abe786d0)
- `test/e2e/helpers/grafana-checker.js` (hash 498114588cebc6f5)
- `test/e2e/helpers/llm-validator.js` (hash 9b8d585c4a93e9fa)
- `test/e2e/helpers/project-suite.js` (hash 5afef25db086de07)
- `test/e2e/helpers/prometheus-checker.js` (hash 10e41a3760169d5b)
- `test/e2e/helpers/specs-summary.js` (hash c24a4ad7e88d1599)
- `test/e2e/helpers/specs-summary.test.js` (hash c98815a76bfa0741)

## Symbols

- `add`
- `main`
- `parseLine`
- `loadLedger`
- `appendEntry`
- `handle`
- `json`
- `route`
- `loadManifest`
- `copyFixture`
- `readContract`
- `runFixtureSuite`
- `assertProtectedFilesStillExist`
- `assertForbiddenPatternsAbsent`
- `collectFiles`
- `logResult`
- `buildMutationPrompt`
- `seedExistingProject`
- `resetExistingProject`
- `hasSeamsFile`
- `fileExists`
- `readArtifact`
- `findFiles`
- `runHook`

## Repo notes (steering)

- Primary harness control plane lives under .claude/ (hooks, scripts, skills). Brownfield navigation artifacts live under specs/brownfield/. Prefer /context or nav-query pack before broad source reads.

## Inbound edges (sample)

- test/e2e-route-matrix-contract.test.js → test/e2e/run-pack.js (imports)

## Citations

Source of truth: `specs/brownfield/code-graph.json`. Prefer `/context` or `nav-query pack` for task-scoped reads.
