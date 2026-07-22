# Concept: test/portfolio-rollup-helpers.js

> Deterministic concept page (hash-cached). Not LLM prose.

## Summary

Cluster `test/portfolio-rollup-helpers.js` groups **1** file(s) (hub fan-in hint 2).

## Files

- `test/portfolio-rollup-helpers.js` (hash 676a68294567f693)

## Symbols

- `tmp`
- `gitRunner`
- `attestRoot`
- `genInto`
- `capture`
- `readReport`
- `contentsResponse`
- `fetchRoutesFor`
- `ghStub`

## Repo notes (steering)

- Primary harness control plane lives under .claude/ (hooks, scripts, skills). Brownfield navigation artifacts live under specs/brownfield/. Prefer /context or nav-query pack before broad source reads.

## Inbound edges (sample)

- test/portfolio-rollup.test.js → test/portfolio-rollup-helpers.js (imports)
- test/portfolio-rollup-fetch.test.js → test/portfolio-rollup-helpers.js (imports)

## Citations

Source of truth: `specs/brownfield/code-graph.json`. Prefer `/context` or `nav-query pack` for task-scoped reads.
