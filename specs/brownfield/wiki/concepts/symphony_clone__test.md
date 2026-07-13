# Concept: symphony_clone/test

> Deterministic concept page (hash-cached). Not LLM prose.

## Summary

Cluster `symphony_clone/test` groups **13** file(s).

## Files

- `symphony_clone/test/config.test.js` (hash 515224119357c6b9)
- `symphony_clone/test/feature-routing-docs.test.js` (hash 514116df4eecfab0)
- `symphony_clone/test/linear-state.test.js` (hash 1ec38b9bd6867a86)
- `symphony_clone/test/prompt-builder.test.js` (hash dae1c92cebb5005a)
- `symphony_clone/test/result-reader.test.js` (hash 1c10dd14b5408504)
- `symphony_clone/test/scheduler-resume.test.js` (hash 6fb4ce87fd6f91ec)
- `symphony_clone/test/scheduler-routing.test.js` (hash e167592464347385)
- `symphony_clone/test/scheduler.test.js` (hash 44d2db01fbc64e14)
- `symphony_clone/test/state-store.test.js` (hash fb962a9f33d6952d)
- `symphony_clone/test/status-server.test.js` (hash 650ed7d2896da7e7)
- `symphony_clone/test/workspace-manager-recovery.test.js` (hash 9366ca18b111c3af)
- `symphony_clone/test/workspace-manager-security.test.js` (hash 1828241a9eaeeedb)
- `symphony_clone/test/workspace-manager.test.js` (hash d71704a1f6e7ecdd)

## Symbols

- `read`
- `routingScheduler`
- `captureResponse`
- `makeTempRoot`
- `recordingRunner`
- `makeWm`
- `seedExistingWorkspace`
- `gitError`

## Repo notes (steering)

- Primary harness control plane lives under .claude/ (hooks, scripts, skills). Brownfield navigation artifacts live under specs/brownfield/. Prefer /context or nav-query pack before broad source reads.

## Citations

Source of truth: `specs/brownfield/code-graph.json`. Prefer `/context` or `nav-query pack` for task-scoped reads.
