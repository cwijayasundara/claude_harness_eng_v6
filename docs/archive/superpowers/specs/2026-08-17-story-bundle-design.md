# Structured Story Bundles — Design

**Date:** 2026-08-17
**Status:** P0+P1+P2 implemented
**Problem:** Planning already writes stories, design, and tests into `specs/`, but nothing joins them into one consumable contract. `/implement` and `/auto` can still load a story file and improvise against chat. Design and test plans are not what the generator is forced to execute. Cross-sprint linking (`/sprint`) exists but is easy to skip, so the next sprint does not reliably inherit design + tests.

**Goal:** Make the **user story** the first-class delivery unit (not a prompt), by joining existing artifacts into a versioned **story bundle**. Generation of code reads the bundle + cited design slices. Generation of tests must trace to the story AC **and** the originating requirement when a BRD acceptance spine exists.

This is the SPDD closed loop with stories as the artifact, not REASONS prompt files. See the 2026-07-04 sprint-delta design and 2026-07-22 SPDD BRD/spec uplift.

---

## 1. Artifact

`specs/bundles/{story-id}.json` is the execution contract. `specs/stories/E*-S*.md` remains the human ticket. The system REASONS Canvas remains the constitution.

```json
{
  "version": 1,
  "story_id": "E1-S1",
  "sprint": 1,
  "title": "Create a short link",
  "readiness": "ready",
  "requirements": {
    "ac_ids": ["E1-S1-AC1"],
    "brd_ids": ["BR-1"],
    "br_acceptance_ids": ["BR-1-AC1"],
    "scope_out": ["must not alter the session cookie format"]
  },
  "entities": [{ "name": "Link", "status": "unknown" }],
  "approach": {
    "program_design": "specs/design/program-design.md",
    "canvas": "specs/design/reasons-canvas.md",
    "amendment": null
  },
  "structure": { "owned_files": ["src/links/service.py"], "layer": "Service" },
  "operations": { "pending": false, "files": ["src/links/service.py"], "text": "..." },
  "safeguards": { "ids": [], "none": true },
  "tests": { "matrix_ids": ["VM-001"], "case_ids": ["TC-1"], "layers": ["unit", "api"] },
  "provenance": { "story_path": "specs/stories/E1-S1.md", "parents": [] }
}
```

No new planning phase. `bundle-write.js` joins files `/brd`, `/spec`, `/design`, and `/test` already produce.

## 2. P0 (this change)

1. `hooks/lib/story-bundle.js` — pure join + check.
2. `bundle-write.js` — emit one JSON per ready story.
3. `bundle-check.js` — `--mode skeleton|implementable`. Dormant (exit 0) when there are no ready stories.
4. `/implement` and `/auto` hard-block on implementable.
5. `/test` requires test-trace hops to `brd-acceptance.json` ids when that spine exists.
6. `/build` writes bundles immediately before `plan-seal.js write`.
7. Sealed `/auto` pack includes `specs/bundles/`.

`implementable` requires: a bundle per ready story, AC ids, matrix rows, owned files or named Operations files, and (when `brd-acceptance.json` exists) original-requirement ids on the bundle and on each test-trace that cites a story AC.

## 3. P1 / P2 (shipped with this change)

- `/story-sync` — code → bundle Structure/Operations + canvas Governs. AC drift fails closed.
- Sprint-scoped `specs/test_artefacts/sprint-N/` + `matrix-append.js` into the living matrix.
- ADO `publish-to-ado.js` + `tracker-body.js` bundle render. Jira re-publish updates in place.
- `/status` `bundles` field (count + last sync age).

Still later: thicker per-story Approach copied from the amendment; Linear GraphQL update-in-place (local body is refreshed; Linear still skips already-published keys).

## 4. Control accounting

| Control | Kind | Delta |
|---|---|---|
| `story-bundle` | guide | +1 |
| `story-bundle-check` | sensor | +1 |

Net +2 against the control-budget baseline. Both carry `net_add_justification`.

## 5. Verification

- Round-trip a temp project through the real writer and the real checker (no hand-built bundle standing in for `bundle-write`).
- Wiring tests: implement, auto, test, build, manifest, packs, HARNESS.md.
