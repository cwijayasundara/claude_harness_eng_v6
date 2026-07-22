# Concept: open_wiki/scripts

> Deterministic concept page (hash-cached). Not LLM prose.

## Summary

Cluster `open_wiki/scripts` groups **4** file(s).

## Files

- `open_wiki/scripts/check-config.mjs` (hash 97d616233269db46)
- `open_wiki/scripts/generate-context-graph.mjs` (hash 704c0df619bb80b9)
- `open_wiki/scripts/load-env.mjs` (hash 22e5e0e728f71982)
- `open_wiki/scripts/run-openwiki.mjs` (hash 5e197396b713dad1)

## Symbols

- `exists`
- `markdownFiles`
- `parseDocument`
- `resolveWikiLink`
- `resolveSourcePath`
- `sourceReferences`
- `escapeHtml`
- `htmlDocument`
- `generateContextGraph`
- `main`
- `loadEnvFile`
- `configuredEnvironment`
- `restoreWiki`
- `prepareStagingDirectory`
- `normalizeOpenWikiPointers`
- `syncWorkflow`

## Repo notes (steering)

- Primary harness control plane lives under .claude/ (hooks, scripts, skills). Brownfield navigation artifacts live under specs/brownfield/. Prefer /context or nav-query pack before broad source reads.

## Citations

Source of truth: `specs/brownfield/code-graph.json`. Prefer `/context` or `nav-query pack` for task-scoped reads.
