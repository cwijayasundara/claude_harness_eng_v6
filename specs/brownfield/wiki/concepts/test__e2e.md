# Concept: test/e2e

> Deterministic concept page (hash-cached). Not LLM prose.

## Summary

Cluster `test/e2e` groups **60** file(s) (hub fan-in hint 18).

## Files

- `test/e2e/auto-output/index.js` (hash n/a)
- `test/e2e/auto-output/index.test.js` (hash n/a)
- `test/e2e/brownfield-run-output/calc.js` (hash n/a)
- `test/e2e/brownfield-run-output/main.js` (hash n/a)
- `test/e2e/feature-output/calc.js` (hash n/a)
- `test/e2e/feature-output/test/calc.test.js` (hash n/a)
- `test/e2e/fixtures/adversarial/brownfield/file-ledger/src/ledger.js` (hash 22e0a9ad51fcf3f4)
- `test/e2e/fixtures/adversarial/brownfield/file-ledger/test/ledger.test.js` (hash 0f3e3bcfd88577cf)
- `test/e2e/fixtures/adversarial/brownfield/legacy-expressish/src/public-api.js` (hash b877233a1bebab03)
- `test/e2e/fixtures/adversarial/brownfield/legacy-expressish/src/router.js` (hash cf1fef18b03cbbb2)
- `test/e2e/fixtures/adversarial/brownfield/legacy-expressish/test/public-api.test.js` (hash 88a574cd04003f09)
- `test/e2e/full-auto-output/specs/test_artefacts/acceptance/E1-S1.test.js` (hash n/a)
- `test/e2e/full-auto-output/specs/test_artefacts/acceptance/E1-S2.test.js` (hash n/a)
- `test/e2e/full-auto-output/src/counter.js` (hash n/a)
- `test/e2e/full-auto-output/src/index.js` (hash n/a)
- `test/e2e/full-auto-output/src/server.js` (hash n/a)
- `test/e2e/full-auto-output/tests/counter.test.js` (hash n/a)
- `test/e2e/full-auto-output/tests/index.test.js` (hash n/a)
- `test/e2e/full-auto-output/tests/server.test.js` (hash n/a)
- `test/e2e/harness-adversarial-fixtures.test.js` (hash cd641cd127b8641b)
- `test/e2e/harness-adversarial-live.test.js` (hash cca0795a44067809)
- `test/e2e/harness-auto-run.test.js` (hash c7f6796f57cff976)
- `test/e2e/harness-brownfield-run.test.js` (hash 4466625aaecc95b3)
- `test/e2e/harness-brownfield.test.js` (hash 850439d4b5cb5cff)
- `test/e2e/harness-feature-route.test.js` (hash 986e28bab01538c9)
- `test/e2e/harness-framework.test.js` (hash 1ba59d398742efb0)
- `test/e2e/harness-full-auto-run.test.js` (hash 5c47921ea7e1e047)
- `test/e2e/harness-gated-build.test.js` (hash ef67f8828b4ab25d)
- `test/e2e/harness-native-commands.test.js` (hash cd21cfaa426f48b4)
- `test/e2e/harness-pipeline-build.test.js` (hash cef4e6d19f77c5f5)
- `test/e2e/harness-pipeline.test.js` (hash 09959fb8c5e21470)
- `test/e2e/harness-plan-only.test.js` (hash bddfbefd644127f9)
- `test/e2e/harness-real-workflow.test.js` (hash 59ba55ed78ed298a)
- `test/e2e/harness-selfheal-smoke.test.js` (hash 06cf79de4723b37a)
- `test/e2e/harness-semi-auto-run.test.js` (hash d3ec8b1dc516d671)
- `test/e2e/harness-vibe-run.test.js` (hash 28d74893a107f5c3)
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
- test/front-half-contract.test.js → test/e2e/run-pack.js (imports)
- test/front-half-contract.test.js → test/e2e/run-pack.js (imports)

## Citations

Source of truth: `specs/brownfield/code-graph.json`. Prefer `/context` or `nav-query pack` for task-scoped reads.
