# Concept: test/e2e

> Deterministic concept page (hash-cached). Not LLM prose.

## Summary

Cluster `test/e2e` groups **57** file(s) (hub fan-in hint 17).

## Files

- `test/e2e/auto-output/index.js` (hash f24d601ec406c02d)
- `test/e2e/auto-output/index.test.js` (hash 3c0bebeca67af1a7)
- `test/e2e/brownfield-run-output/calc.js` (hash f11e571db3e0039a)
- `test/e2e/brownfield-run-output/main.js` (hash 21667b18f095526f)
- `test/e2e/feature-output/calc.js` (hash 28bda2e5df3eada9)
- `test/e2e/feature-output/test/calc.test.js` (hash 72715013e1290dea)
- `test/e2e/fixtures/adversarial/brownfield/file-ledger/src/ledger.js` (hash 22e0a9ad51fcf3f4)
- `test/e2e/fixtures/adversarial/brownfield/file-ledger/test/ledger.test.js` (hash 0f3e3bcfd88577cf)
- `test/e2e/fixtures/adversarial/brownfield/legacy-expressish/src/public-api.js` (hash b877233a1bebab03)
- `test/e2e/fixtures/adversarial/brownfield/legacy-expressish/src/router.js` (hash cf1fef18b03cbbb2)
- `test/e2e/fixtures/adversarial/brownfield/legacy-expressish/test/public-api.test.js` (hash 88a574cd04003f09)
- `test/e2e/full-auto-output/specs/test_artefacts/acceptance/E1-S1.test.js` (hash a40fe9f9fbaa6f48)
- `test/e2e/full-auto-output/specs/test_artefacts/acceptance/E1-S2.test.js` (hash 96a445c56ef53e2b)
- `test/e2e/full-auto-output/src/counter.js` (hash d5b5e0f7997fccd2)
- `test/e2e/full-auto-output/src/index.js` (hash 1d93b3b617cd1660)
- `test/e2e/full-auto-output/src/server.js` (hash 361652f3991ebec9)
- `test/e2e/full-auto-output/tests/counter.test.js` (hash 0b7600a3460f9fae)
- `test/e2e/full-auto-output/tests/index.test.js` (hash a6470e3a906cb68d)
- `test/e2e/full-auto-output/tests/server.test.js` (hash 3e0f78e6952a1bec)
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

## Symbols

- `parseIntArg`
- `main`
- `runCli`
- `add`
- `multiply`
- `parseLine`
- `loadLedger`
- `appendEntry`
- `handle`
- `json`
- `route`
- `withServer`
- `request`
- `getCount`
- `increment`
- `resolvePort`
- `startServer`
- `createRequestHandler`
- `sendJson`
- `startTestServer`
- `loadManifest`
- `copyFixture`
- `readContract`
- `runFixtureSuite`

## Repo notes (steering)

- Primary harness control plane lives under .claude/ (hooks, scripts, skills). Brownfield navigation artifacts live under specs/brownfield/. Prefer /context or nav-query pack before broad source reads.

## Inbound edges (sample)

- test/e2e-route-matrix-contract.test.js → test/e2e/run-pack.js (imports)

## Citations

Source of truth: `specs/brownfield/code-graph.json`. Prefer `/context` or `nav-query pack` for task-scoped reads.
