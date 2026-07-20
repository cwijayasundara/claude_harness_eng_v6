# Concept: test/fleet-retrofit-helpers.js

> Deterministic concept page (hash-cached). Not LLM prose.

## Summary

Cluster `test/fleet-retrofit-helpers.js` groups **1** file(s) (hub fan-in hint 2).

## Files

- `test/fleet-retrofit-helpers.js` (hash 5662370674619416)

## Symbols

- `tmp`
- `defaultGithub`
- `operatorCwd`
- `writeFleet`
- `liveEnv`
- `envName`
- `makeGh`
- `capture`
- `readReport`

## Repo notes (steering)

- Primary harness control plane lives under .claude/ (hooks, scripts, skills). Brownfield navigation artifacts live under specs/brownfield/. Prefer /context or nav-query pack before broad source reads.

## Inbound edges (sample)

- test/fleet-retrofit-core.test.js → test/fleet-retrofit-helpers.js (imports)
- test/fleet-retrofit.test.js → test/fleet-retrofit-helpers.js (imports)

## Citations

Source of truth: `specs/brownfield/code-graph.json`. Prefer `/context` or `nav-query pack` for task-scoped reads.
