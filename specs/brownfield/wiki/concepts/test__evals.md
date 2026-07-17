# Concept: test/evals

> Deterministic concept page (hash-cached). Not LLM prose.

## Summary

Cluster `test/evals` groups **9** file(s) (hub fan-in hint 2).

## Files

- `test/evals/fixtures/calc-app/calc.js` (hash 8116991fce40e1c1)
- `test/evals/fixtures/calc-app/calc.test.js` (hash bc0b500f8fe42854)
- `test/evals/fixtures/calc-app/dead-code.js` (hash 9cc1348a21df755a)
- `test/evals/fixtures/clean-app/app.js` (hash 9a33d33ed3e5f3d8)
- `test/evals/fixtures/clean-app/test/app.test.js` (hash e705f2ca378ff546)
- `test/evals/fixtures/vuln-app/db.js` (hash d3fac512c3d2f25f)
- `test/evals/helpers/assertions.js` (hash fc8c607baf239a59)
- `test/evals/helpers/transcript.js` (hash f9fb300a06242dab)
- `test/evals/run-evals.js` (hash 7e021f5e7d79ff7b)

## Symbols

- `sum`
- `average`
- `oldSum`
- `greet`
- `getUserById`
- `listFiles`
- `fileDiffers`
- `checkTranscript`
- `checkFilesUnchanged`
- `checkWorkdirUnchanged`
- `checkFileMatches`
- `checkFixtureTests`
- `checkOne`
- `applyAssertions`
- `extractTranscript`
- `loadTasks`
- `stageFixture`
- `runTask`
- `runAll`
- `claudeInvoke`
- `main`

## Repo notes (steering)

- Primary harness control plane lives under .claude/ (hooks, scripts, skills). Brownfield navigation artifacts live under specs/brownfield/. Prefer /context or nav-query pack before broad source reads.

## Inbound edges (sample)

- test/evals-runner.test.js → test/evals/run-evals.js (imports)
- test/golden-assertions.test.js → test/evals/helpers/assertions.js (imports)
- test/golden-assertions.test.js → test/evals/helpers/transcript.js (imports)

## Citations

Source of truth: `specs/brownfield/code-graph.json`. Prefer `/context` or `nav-query pack` for task-scoped reads.
