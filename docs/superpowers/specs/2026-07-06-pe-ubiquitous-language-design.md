# PE-Vocabulary Seeding for the Ubiquitous-Language Glossary

**Date:** 2026-07-06
**Goal:** For projects built for a private-equity customer, automatically seed `CONTEXT.md` — the harness's domain glossary from the 2026-07-05 ubiquitous-language work — with the vocabulary already encoded in the installed `private-equity` vertical plugin, grouped by bounded context, and close the loop by having `pe-ic-memo` consume the same glossary.

## Motivation

The harness already carries a fully-wired ubiquitous-language mechanism (shipped 2026-07-05, see `docs/superpowers/specs/2026-07-05-ubiquitous-language-design.md`): `CONTEXT.md` is read/written by `brd`, `spec`, `design`, `implement`, and `generator.md`, and gated by the deterministic `vocabulary-check.js` sensor. Separately, this repo also ships `pe-ic-memo` (2026-07-05/06), a PPTX-rendering sibling of the installed `private-equity` vertical plugin's `ic-memo` skill.

These two were built independently and never referenced each other. But the user develops business applications for a private-equity customer, so their actual ubiquitous language *is* PE vocabulary — and the installed `private-equity` plugin (`deal-sourcing`, `deal-screening`, `dd-checklist`, `dd-meeting-prep`, `ic-memo`, `portfolio-monitoring`, `returns-analysis`, `unit-economics`, `value-creation-plan`, `ai-readiness`) already encodes that vocabulary in its skill descriptions (CIM, teaser, IOI, IRR, MOIC, EBITDA bridge, covenant, ARR, LTV/CAC, 100-day plan, and more). Per Fowler's ["What is Code"](https://martinfowler.com/articles/what-is-code.html), naming this vocabulary explicitly is exactly the durable, human-authored value that matters once code generation is commoditized. Per Fowler's ["BoundedContext"](https://martinfowler.com/bliki/BoundedContext.html), a single enterprise-wide glossary doesn't scale — vocabulary should be grouped along the lines where it actually shifts (deal-team language vs. IC language vs. operating-partner language), not flattened into one undifferentiated list.

This design harvests that already-existing vocabulary into `CONTEXT.md` automatically, and wires `pe-ic-memo` to consume it, so the two 2026-07-05 features reinforce each other instead of sitting side by side unused.

## Scope

- Automatically seed `CONTEXT.md` with PE terms whenever the `private-equity` vertical plugin is enabled — a harness-level default, not a manually-invoked, single-project action.
- Group seeded terms under three bounded-context headings inside the existing single `CONTEXT.md` file (no new per-context files, no change to `vocabulary-check.js`'s single-file parser).
- Derive the term list dynamically, at BRD time, from the plugin's actual installed `SKILL.md` files — never a hand-maintained static list that can drift from the plugin.
- Wire `pe-ic-memo` to read `CONTEXT.md` and reuse its terms, closing the loop between the two features.

Out of scope (see below): per-bounded-context glossary files, changes to `vocabulary-check.js`'s matching algorithm, fuzzy/NLP term extraction from free-text prose, retrofitting projects that already have a `CONTEXT.md`.

## Trigger

A new BRD sub-step (2.7, run immediately before the existing Step 2.8) checks `.claude/settings.json#enabledPlugins` for any key matching `^private-equity@`. This is the same `enabledPlugins` map already referenced in this repo's `CLAUDE.md` (Prompt Caching section) as the deterministic record of which plugins are active. If no matching key exists, Step 2.7 is a no-op and no PE terms are written — non-PE projects are unaffected. This also means the trigger re-evaluates on every BRD run; disabling the plugin later simply stops future seeding (it does not retroactively strip already-written terms).

## Evidence Extraction — `.claude/scripts/pe-glossary-pack.js`

New script, modeled on `.claude/scripts/modularity-pack.js`'s shape: a pure core function (exported for `node:test`) plus a thin CLI wrapper.

**Behavior:**
1. Locate the installed plugin's skills directory. Check, in order:
   - `.claude/plugins/marketplaces/claude-for-financial-services/plugins/vertical-plugins/private-equity/skills/`
   - `.claude/plugins/cache/claude-for-financial-services/private-equity/skills/`
2. For each `skills/*/SKILL.md` found, parse the YAML frontmatter and extract `name` and `description` verbatim — no NLP, no invented terms. This mirrors `vocabulary-check.js`'s own restraint (exact-after-normalization matching only, no fuzzy matching) and the brownfield Step 6 pattern of deterministic evidence extraction feeding LLM judgment, not the other way around.
3. Attach each skill to a bounded context using the fixed table below (a reviewable, hand-set assignment — *which* skills exist is read dynamically from the plugin; *which context each belongs to* is a one-time judgment call, not re-derived per run).
4. Write `specs/brd/pe-glossary-pack.json`:
   ```json
   {
     "contexts": [
       {
         "name": "Deal Lifecycle (Sourcing, Screening & Diligence)",
         "skills": [
           { "skill": "deal-sourcing", "description": "..." },
           { "skill": "deal-screening", "description": "..." },
           { "skill": "dd-checklist", "description": "..." },
           { "skill": "dd-meeting-prep", "description": "..." }
         ]
       },
       {
         "name": "Investment Decision & Returns",
         "skills": [
           { "skill": "ic-memo", "description": "..." },
           { "skill": "returns-analysis", "description": "..." }
         ]
       },
       {
         "name": "Portfolio Operations & Value Creation",
         "skills": [
           { "skill": "portfolio-monitoring", "description": "..." },
           { "skill": "value-creation-plan", "description": "..." },
           { "skill": "unit-economics", "description": "..." },
           { "skill": "ai-readiness", "description": "..." }
         ]
       }
     ]
   }
   ```

**Bounded-context assignment table (fixed in the script):**

| Bounded Context | Skills |
|---|---|
| Deal Lifecycle (Sourcing, Screening & Diligence) | `deal-sourcing`, `deal-screening`, `dd-checklist`, `dd-meeting-prep` |
| Investment Decision & Returns | `ic-memo`, `returns-analysis` |
| Portfolio Operations & Value Creation | `portfolio-monitoring`, `value-creation-plan`, `unit-economics`, `ai-readiness` |

**CLI contract**, matching `modularity-pack.js`'s conventions: no required flags (paths are fixed, as above); exit `0` = pack written, `2` = the `private-equity@...` key is present in `enabledPlugins` but no skills directory was found at either candidate path (loud failure — this indicates a broken/partial plugin install, not "nothing to do"). Stdout summary: number of contexts and skills packed, output path.

## BRD Step 2.7 — Write PE Terms into `CONTEXT.md`

Update `.claude/skills/brd/SKILL.md`, inserting a new sub-step immediately before the existing Step 2.8:

> **Step 2.7 — Seed PE domain vocabulary (private-equity projects only).** Run `node .claude/scripts/pe-glossary-pack.js`. If it exits 0, read `specs/brd/pe-glossary-pack.json` and, for each context, distill the real domain nouns implied by each skill's description (e.g. `deal-screening` → CIM, teaser, IOI; `returns-analysis` → IRR, MOIC; `value-creation-plan` → EBITDA bridge, 100-day plan) into `CONTEXT.md`'s `## Terms` section, using the context name as a `### <Bounded Context Name>`-level grouping heading with individual `### <Term>` entries beneath it, one line of definition each. If it exits 2, note the broken plugin install in the progress log and skip — do not block the BRD on it. If it exits without running (no matching `enabledPlugins` key), this step does nothing.

Step 2.8 (existing, unchanged) runs afterward and merges `domain_concepts`-derived terms into the same `CONTEXT.md`, so project-specific concepts layer on top of the PE baseline rather than overwrite it — matching the existing merge behavior Step 2.8 already has with `/brownfield`-created `CONTEXT.md` files.

## `pe-ic-memo` Update

Add one line to `.claude/skills/pe-ic-memo/SKILL.md` Step 1 (Gather Inputs), mirroring `/spec`'s existing instruction (`.claude/skills/spec/SKILL.md:44`):

> Read `CONTEXT.md` if present. Use its terms verbatim in section headings and bullets — do not introduce a new name for a concept `CONTEXT.md` already defines.

No change to `render_deck.py` or the `memo` dict shape — this is a content-sourcing instruction only.

## No Changes Required

- `vocabulary-check.js` — already treats `CONTEXT.md` as the single glossary source regardless of how a term got there; PE-seeded terms pass through the exact same `undocumented`/`unused` checks as any other term.
- `design/SKILL.md`, `implement/SKILL.md`, `generator.md` — already require reading `CONTEXT.md`; no PE-specific branch needed.
- `harness-manifest.json` — the existing `vocabulary-check` entry covers this; no new sensor is registered. Its `description` field gets one clause added noting PE-seeded terms are a valid `CONTEXT.md` origin, for anyone auditing the manifest later.

## Tests

- `test/pe-glossary-pack.test.js`:
  - builds the expected pack structure against the real installed plugin's `skills/*/SKILL.md` files (round-trip through the actual filesystem layout, not a hand-built fixture — matches this repo's CLAUDE.md principle #5 on real-schema tests);
  - exits 2 with a clear stderr message when `enabledPlugins` has a `private-equity@...` key but neither candidate skills path exists;
  - produces no output/no-op when `enabledPlugins` has no matching key.
- `test/pe-ic-memo-skill.test.js` — extend to assert the new `CONTEXT.md`-read line is present in `SKILL.md`.
- `test/brd-skill.test.js` (or equivalent existing wiring-assertion test) — assert Step 2.7 references `pe-glossary-pack.js` and precedes Step 2.8.

Run target verification:
```bash
npm test
node --test test/pe-glossary-pack.test.js
node .claude/scripts/pe-glossary-pack.js
```

## Risks

- **Plugin skill descriptions change upstream** (new skills added, existing ones reworded): since extraction is dynamic, the next `/brd` run picks up the change automatically. The fixed bounded-context table needs a manual update only when a *new* skill is added to the plugin — an acceptable, infrequent maintenance cost versus a fully static seed file that silently drifts.
- **LLM distillation quality** (Step 2.7 asks the model to turn a skill description into nouns, not a mechanical parse): acceptable — this mirrors the same judgment call Step 2.8 already makes for `domain_concepts`, and any missed/wrong term is still caught downstream by `vocabulary-check.js`'s `undocumented` check when a schema later uses a name with no glossary match.
- **Marketplace path drift** (the plugin's installed path could change if the marketplace repo restructures): both candidate paths are checked; if both are absent, the script fails loud (exit 2) rather than silently skipping, so a broken install surfaces immediately instead of quietly producing an empty PE glossary.

## Out of Scope

- Per-bounded-context glossary files (`CONTEXT-<context>.md`) — deferred exactly as the original 2026-07-05 design deferred it; the section-heading approach here satisfies the immediate need without the larger change to `vocabulary-check.js`, `/spec`, `/design`, and `/implement` that true multi-file scoping would require.
- Fuzzy/NLP-based term extraction from skill description prose — Step 2.7 uses the same LLM-judgment step the harness already trusts for `domain_concepts`, not a new mechanical NLP pass.
- Retrofitting projects that already have a `CONTEXT.md` from a prior `/brd` run without this step — this design governs new BRD runs going forward, matching the original ubiquitous-language design's own retrofit exclusion.
- Extending this pattern to other vertical plugins (`investment-banking`, `equity-research`, `wealth-management`, etc.) — the bounded-context table and script are private-equity-specific for now; generalizing to a plugin-agnostic mechanism is a future amendment if a second vertical customer needs it.
