# Migrate mapping

**Goal:** <!-- one sentence: what is being transformed into what -->  
**Oracle:** <!-- which test suite / CLI must stay green; must be language-independent if possible -->  
**Status:** draft | adversarially-reviewed | canary-passed | complete  

## Pattern map

| Source pattern | Target pattern | Notes / pitfalls |
|----------------|----------------|------------------|
| <!-- e.g. Zig `defer x.deinit()` --> | <!-- Rust `Drop` / RAII --> | <!-- semantic divergences --> |
| | | |

## Files / crates in scope

- <!-- list roots or globs -->

## Explicit non-goals

- <!-- what will NOT change in this pass -->

## Semantic divergence watchlist

Document language-pair hazards. Full checklist: `.claude/skills/code-gen/references/semantic-divergence.md` (Bun Phase C).

Bun-class examples: assert macros with side effects, release bounds checks, format/comptime differences, Drop vs defer, odd-length slices.

| Hazard | How we preserve behaviour |
|--------|---------------------------|
| | |
