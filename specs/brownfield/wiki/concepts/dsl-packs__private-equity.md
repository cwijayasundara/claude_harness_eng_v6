# Concept: dsl-packs/private-equity

> Deterministic concept page (hash-cached). Not LLM prose.

## Summary

Cluster `dsl-packs/private-equity` groups **3** file(s) (hub fan-in hint 3).

## Files

- `dsl-packs/private-equity/waterfall/compile.js` (hash 53c8342d254870f1)
- `dsl-packs/private-equity/waterfall/pack.js` (hash c9fb82c5fc2f98ff)
- `dsl-packs/private-equity/waterfall/validate.js` (hash 80514e7a02a24357)

## Symbols

- `normalizeTier`
- `compile`
- `pct`
- `round`
- `checkCanonicalOrder`
- `checkRocPresent`
- `checkCatchupTarget`
- `checkHurdleCoherence`
- `checkSplits`
- `checkCarryGates`
- `checkRates`
- `checkAmericanClawback`
- `validate`

## Repo notes (steering)

- Primary harness control plane lives under .claude/ (hooks, scripts, skills). Brownfield navigation artifacts live under specs/brownfield/. Prefer /context or nav-query pack before broad source reads.

## Inbound edges (sample)

- test/pe-waterfall-compile.test.js → dsl-packs/private-equity/waterfall/pack.js (imports)
- test/pe-waterfall-schema.test.js → dsl-packs/private-equity/waterfall/pack.js (imports)
- test/pe-waterfall-validate.test.js → dsl-packs/private-equity/waterfall/pack.js (imports)

## Citations

Source of truth: `specs/brownfield/code-graph.json`. Prefer `/context` or `nav-query pack` for task-scoped reads.
