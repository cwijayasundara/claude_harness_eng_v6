# `/feature` — Brownfield Change Route

**Date:** 2026-06-25
**Status:** Design approved, pending spec review
**Type:** New orchestrating command + DeepWiki canonicalization

## Problem

Working with existing code currently requires the user to manually chain
several commands (`/brownfield`, `tracker-publish`, `/change` or
`/spec`→`/design`→`/auto`) and to remember to keep the codebase map current.
There is no single route that takes a feature request on existing code from
intent to a reviewed PR while (a) adhering to the existing design, (b)
recording the work as a Linear story/epic, and (c) keeping a durable,
always-current codebase reference.

The user wants one command that conducts this route, scaling from a one-line
tweak up to a multi-story epic, with a Devin-DeepWiki-style reference the
coding agent consults and that stays up to date as code changes.

## Goal

A single scope-adaptive command, `/feature`, that conducts existing-code work
end-to-end:

> discover → decompose → adhere → publish → implement → test → verify → PR

with three human gates (decomposition, plan/design, PR), backed by a
**committed, incrementally-maintained DeepWiki**.

`/feature` is a **thin conductor**. It does not reimplement existing skills; it
sequences them and adds only the missing connective tissue.

## Non-goals

- Not a greenfield builder — that is `/build`. `/feature` is its brownfield,
  Linear-integrated counterpart.
- Not a replacement for `/change`, `/brownfield`, `/spec`, `/design`, `/auto`,
  `tracker-publish`, or `/gate` — it composes them.
- Does not change the existing group/story tracker model; it adds a single-issue
  path for the small lane only.

## Design

### Command

`/feature "<request>"` — handles both new behavior ("add X") and altered
behavior ("change how Y works"). Scope-adaptive: it picks a lightweight or full
lane based on the decomposition.

### The spine

The same backbone runs at every scale; only the delegated engine differs.

| # | Step | Single-story lane | Epic / cluster lane | Gate |
|---|------|-------------------|---------------------|------|
| 1 | **Discover** — ensure DeepWiki fresh + committed | `/brownfield` (first run) or incremental `/code-map` refresh | same | — |
| 2 | **Decompose** — story, or epic+stories+dependency-graph; cited against the DeepWiki | one story with numbered testable AC | `/spec` → epics, stories, dependency-graph, `features.json` | **GATE 1: approve decomposition** |
| 3 | **Design-adherence** — extend existing seams/layers, no parallel structures | `/change` S2–S3 + `/seam-finder` | `/design` → component-map, api-contracts | **GATE 2: approve plan/design** |
| 4 | **Publish to Linear** | single issue (new lightweight path) | `tracker-publish --granularity group` (issue per dependency group, blockers mirrored) | — |
| 5 | **Implement** (test-first, in-place) | `/change` S4–S5 | `/auto` (parallel agent teams per group) | — |
| 6–7 | **Unit + integration tests**, full suite green | `/change` S4–S5 + `/test` | `/auto` sprint contracts + `/test` | — |
| 8 | **Verify** against AC + clean-code/security review | `/change` S6 + evaluator | `/gate` (evaluator + security) | — |
| 9 | **PR(s)** linked to Linear issue(s) | one PR | one PR per group, each linked | **GATE 3: review PR(s)** |

### Scope classification (the one routing decision)

After GATE 1, `/feature` classifies the decomposition it now holds:

- **Single bounded story** — 1 story, ≤3 files, no auth/authz/payments/
  persistence/public-API-contract change → delegate to **`/change`**.
- **Epic / cluster** — multiple stories, an epic, or any dependency graph →
  run **`/spec` → `/design` → `tracker-publish` (group) → `/auto`**, gaining
  parallel agent-team execution across independent groups.

Classification reuses `/change`'s existing Step 0 lane-check thresholds and the
`specs/brownfield/risk-map.md` signals, so the rule is shared, not reinvented.

### DeepWiki lifecycle — build once, maintain incrementally

The wiki (`specs/brownfield/wiki/`) is promoted to **committed repo docs** and
maintained as a living artifact, never fully rebuilt per request.

1. **First run only — full build.** If no committed wiki exists, run full
   `/brownfield` discovery to produce `code-graph.json` + wiki; commit it. This
   is the only expensive pass.
2. **Subsequent requests — freshness check, not rebuild.**
   - Current → read it at GATE 2; no regeneration.
   - Stale (the `graph-refresh` hook stamps a `> STALE since…` banner on drift)
     → incremental `/code-map --files` patch of only the touched files
     (sub-second), then re-render.
3. **During implementation — self-heals.** The existing `graph-refresh`
   Stop/SubagentStop hook patches `code-graph.json` (`--files`) and re-renders
   the wiki per turn as the agent edits.
4. **At PR time — ships with the change.** Re-render from the final patched
   graph and commit the updated wiki **in the same PR** as the code, so doc and
   code move together and the reviewer sees both.
5. **Fallback.** If incremental graph warnings spike (e.g. after a massive
   refactor), fall back to a full `/brownfield` rebuild rather than trust a
   degraded patch.

**Two distinct touches of the wiki per run:** GATE 2 *reads the committed
(pre-change) wiki* to verify design-adherence; the *post-change re-render* is
part of the implementation output. Cost of "always up to date" is amortized:
pay the big scan once, then only for files actually touched.

### Design-adherence enforcement

GATE 2 is not advisory. The change plan / design **must cite specific DeepWiki
pages/symbols** and state, for each edit, which existing module/seam/layer it
extends. A plan that invents a parallel structure instead of extending an
existing seam is rejected at the gate. "Adhere to existing design" becomes a
gate requirement, not a hope.

### Linear integration

- **Cluster/epic lane:** reuse `tracker-publish --granularity group` as-is —
  it already creates one issue per dependency group, mirrors blockers, and
  writes `.claude/state/tracker-map.json`. Transport via Linear MCP →
  `publish-to-linear.js` → manual CLI, in that order (existing behavior).
- **Single-story lane:** add a `--granularity single` mode to `tracker-publish`
  that creates one Linear issue (title, AC in body) reusing `tracker-config.json`
  + `publish-to-linear.js`, without requiring the full `/build` artifact set
  (epics, dependency-graph, component-map, features.json). Keeping it inside
  `tracker-publish` keeps all Linear logic in one place.
- **PR linkage (new):** every opened PR links back to its Linear issue; the
  Linear issue is left in `Human Review` (never auto-`Done`, per existing
  tracker safety rules).

### New vs reused

**New (small):**
- `/feature` conductor skill + scope classifier.
- Single-issue Linear publish path for the small lane.
- PR ↔ Linear back-linkage.
- Committing the wiki (location promotion + commit step).
- GATE 2 "plan must cite the DeepWiki" check.

**Reused (all heavy lifting):**
- `/brownfield` + `/code-map` — discovery, graph, deterministic wiki render,
  `--files` incremental patch, `graph-refresh` hook.
- `/spec` + `/design` — decomposition into epics/stories/dependency-graph and
  component-map/api-contracts.
- `tracker-publish` — group→Linear publish, config, transports.
- `/change` — single-story test-first implement + review + verify.
- `/auto` — parallel agent-team execution with sprint contracts.
- `/gate` — evaluator + security verification.

## Decisions locked in review

- Command name: `/feature` (alternatives `/brownfield-change`, `/work`
  considered and rejected for brevity/coverage).
- Single-story Linear publish lives in `tracker-publish` as `--granularity
  single`, keeping all Linear logic in one place.

## Testing strategy

- The conductor skill is prompt/markdown logic; validate via the harness's
  existing skill-eval approach (scenario walkthroughs) rather than unit tests.
- Single-story Linear publish path: `--dry-run` against `publish-to-linear.js`
  to confirm one issue with AC body and no epic-artifact prerequisites.
- DeepWiki lifecycle: verify (a) first-run full build commits the wiki,
  (b) a subsequent touched-file change produces an incremental patch + re-render
  in the same PR, (c) the STALE banner triggers a re-render not a full rebuild.
- End-to-end: a single-story `/feature` run and a 2-group epic `/feature` run,
  each landing a reviewed PR linked to a Linear issue with the wiki updated.
