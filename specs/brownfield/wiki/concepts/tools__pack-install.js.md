# Concept: tools/pack-install.js

> Deterministic concept page (hash-cached). Not LLM prose.

## Summary

Cluster `tools/pack-install.js` groups **1** file(s) (hub fan-in hint 2).

## Files

- `tools/pack-install.js` (hash 4ba540adb28b44f0)

## Symbols

- `loadPartition`
- `mergeSpec`
- `resolveSelection`
- `filesFor`
- `copyRecursive`
- `materialize`
- `declaredNames`
- `undeclaredUnits`
- `argValue`
- `listPacks`
- `main`

## Repo notes (steering)

- Primary harness control plane lives under .claude/ (hooks, scripts, skills). Brownfield navigation artifacts live under specs/brownfield/. Prefer /context or nav-query pack before broad source reads.

## Inbound edges (sample)

- tools/pack-install.test.js → tools/pack-install.js (imports)
- tools/pack-install-smoke.test.js → tools/pack-install.js (imports)

## Citations

Source of truth: `specs/brownfield/code-graph.json`. Prefer `/context` or `nav-query pack` for task-scoped reads.
