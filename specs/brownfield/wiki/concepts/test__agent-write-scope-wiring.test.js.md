# Concept: test/agent-write-scope-wiring.test.js

> Deterministic concept page (hash-cached). Not LLM prose.

## Summary

Cluster `test/agent-write-scope-wiring.test.js` groups **1** file(s).

## Files

- `test/agent-write-scope-wiring.test.js` (hash 27e9442b485cb498)

## Symbols

- `preToolUseEntries`
- `entriesRunning`

## Repo notes (steering)

- Primary harness control plane lives under .claude/ (hooks, scripts, skills). Brownfield navigation artifacts live under specs/brownfield/. Prefer /context or nav-query pack before broad source reads.

## Citations

Source of truth: `specs/brownfield/code-graph.json`. Prefer `/context` or `nav-query pack` for task-scoped reads.
