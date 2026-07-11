# Autonomous lane — plan-approve-once → run to PR

> **Canonical source:** the **Approval model** section of `../SKILL.md` is the single source of truth for the gated / `--autonomous` / `--auto` distinction. This file is the *operational detail* of the tail (Phases 4–11, Phase 9.5 ladder, pod fan-out). If the two ever disagree on what a gate *means*, SKILL.md wins — fix this file, don't fork the definition.

The `--autonomous` flow for `/build`. It is the in-session, human-triggered
equivalent of Devin: a developer kicks it off, approves the plan **once**, and the
pipeline runs to an **open PR** with no further human stops. The tracker-driven
path (Jira/Linear + symphony) reuses the same Phases 4–11 tail.

It changes **approval timing only** — every machine gate still runs. The
generator never approves its own output; the barriers (`/auto` ratchet, `/gate`,
the Phase 9.5 acceptance run) are all independent of it. This is the property
that separates the lane from Devin's self-judged verification.

## Semi-auto (`--autonomous`) vs full-auto (`--auto`)

Same lane, one difference: **does the single plan gate run?**
- `--autonomous` (semi-auto): the Phase 3.5 plan gate runs — approve once, then hands-off.
- `--auto` (full-auto): Phase 3.5 is **skipped** — PRD straight through to PR(s), **zero** build-time human gates. The human re-appears only at merge (or the `AUTO_MERGE` key removes even that — activated locally via the `--auto-merge` flag or `AUTO_MERGE=true` env through `.claude/scripts/auto-merge.js`, not only symphony).

Everything else below — PRD grounding, the Phases 4–11 tail, the machine gates, pod fan-out — is identical for both.

## The single gate (Phase 3.5) — `--autonomous` only

Phases 1–3 run **without stopping**, producing BRD, stories, design, and test
plan. In `--auto` the pipeline proceeds straight to Phase 4. In `--autonomous`,
present them together, once:

- BRD: problem, in/out scope, **Forbidden Actions**, success metrics.
- Stories: count, dependency groups, Mermaid dependency graph.
- Design: stack, components, API surface, data model.
- Test plan: case count, coverage, fixtures.
- Detected deliverable shape (API? UI?) + verification mode → which Phase 9.5
  checks will run.

One question: **"Approve this plan to build autonomously through to an open PR?"**
- **Approved** → Phases 4–11 run with no further human stops.
- **Anything else** → fall back to the gated model for the rest of the run.

## The autonomous tail (Phases 4–11)

```
4    init state
4.5  /deploy            (docker mode: compose stack + init.sh)
5-8  /auto              (sprint contracts, agent teams, ratchet, self-heal, chaining)
9    /test --e2e-only   (generate Playwright specs)
9.5  PRE-PR VERIFY      (deploy locally → API tests → E2E → defect-repair loop)   ← the gate
10   README
11   raise PR           (only if 9.5 + /gate green)
```

## Phase 9.5 — the deploy → test → fix ladder (shape-aware)

Detect shape from `project-manifest.json`; run only what applies, in order:

| Deliverable shape | What runs in Phase 9.5 |
|---|---|
| API only | deploy → **API tests** |
| UI + API | deploy → **API tests** → **Playwright E2E** |
| UI only | deploy → **Playwright E2E** |
| CLI / library | deploy (or in-process) → the project's own suite (no browser) |

**Deploy locally** by `verification.mode`: `docker` → `bash init.sh`; `local` →
the manifest start command; `stub` → in-process. Confirm health before testing.

**Defect-repair loop (bounded):** on any failure —
1. Capture concrete diagnostics: failing assertion, HTTP status + response body,
   browser console errors, service logs.
2. Spawn the generator to fix the **implementation** (never the test) grounded in
   those diagnostics.
3. Redeploy and re-run from the API step.
4. Cap attempts (default 3). If still red, **stop — do not raise a PR** — write a
   structured `specs/verification/failure-report.md` (failed suite, final failing
   assertion(s), captured diagnostics, attempt count, last diff tried), then
   surface the diagnostics for a human. In headless mode that report is the only
   durable record of why the run halted.

The evaluator agent (runtime mode: API + Playwright + schema) is the oracle for
pass/fail; the generator only repairs.

## Phase 11 — raise PR

Reachable only when the applicable Phase 9.5 suites and `/gate` (evaluator +
security + quality-card) are green. Push the branch, then open the PR with a
**machine-assembled** body (never a thin hand summary):

```bash
node .claude/scripts/pr-body.js --require-gate --title "<stories>" > /tmp/pr-body.md
gh pr create --title "..." --body-file /tmp/pr-body.md
```

`pr-body.js` embeds `quality-card.md` + logical `walkthrough.md` + navigation
links and **exits 1** if the quality card is FAIL/incomplete — refuse PR open
in that case. Cover stories delivered, Phase 9.5 proof, and the PRD link in
the title/extra sections. **Do not merge** — merge is a separate decision
(human, or `AUTO_MERGE` — activated locally via `--auto-merge` flag /
`AUTO_MERGE=true` env through `.claude/scripts/auto-merge.js`, or via
symphony's `AUTO_MERGE` key).

## Pod mode (`--pod N`) — one PR per cluster

By default the autonomous tail produces **one integrated PR**. Add `--pod N` to run
the **architect + engineers pod** instead: the architect plans once (Phases 0–3.5),
then `/auto --pod N` fans the work out so **each cluster raises its own stacked draft PR** — opened immediately, with no merge wait between waves. PR granularity is decided by `.claude/scripts/wave-plan.js` (`pr_mode`).

```
ARCHITECT (plan once)
   │  fan out over clusters, wave-ordered by the dependency graph
   ▼
engineer A (cluster A)     engineer B (cluster B)     engineer C (cluster C)
 branch: auto/group-A       branch: auto/group-B       branch: auto/group-C
 base: main                 base: main (independent)   base: auto/group-A (stacked)
 build (teammates)          build (teammates)          build (teammates)
 Phase 9.5 per cluster      Phase 9.5 per cluster      Phase 9.5 per cluster
 OWN draft PR (base=main)   OWN draft PR (base=main)   OWN stacked draft PR
                                                        (base=auto/group-A)
   ← next wave starts immediately; no merge wait — humans merge bottom-up →
```

- **Per-cluster stacked PR** — each engineer-orchestrator opens a draft PR via
  `wave-pr.js` for its cluster (stories + Phase 9.5 proof + Forbidden-Actions check);
  never merges. Independent clusters base on `main`; a single-parent dependent cluster
  bases on its predecessor's branch (`auto/group-{predecessor}`) — a stacked PR opened
  **immediately**. Diamond-join clusters branch from `main` and merge each predecessor
  branch in locally.
- **No merge wait** — dependent clusters open their stacked PRs immediately; the next
  wave starts right away. Humans merge the stack bottom-up; GitHub auto-retargets each
  child PR to `main` as its parent merges. `AUTO_MERGE` (full-auto) auto-merges per PR
  when checks pass — it does **not** mean "wait between waves." Waves never block on merge.
- **Conflict defense** — independent clusters in a wave have disjoint file ownership
  and all branch from the same `WAVE_BASE`, so PRs don't collide; shared/cross-cutting
  files live in foundation clusters that land in earlier waves. Mechanics: `/auto`
  Section 4B → Pod mode.

## Relationship to symphony

Symphony (Jira/Linear-driven) is the *other trigger* for the same tail. Where
`/build --autonomous` is one developer pressing go in-session, symphony polls a
tracker and launches this same Phases 4–11 flow per issue in an isolated
workspace. Both end at an open PR; neither merges without the explicit
`AUTO_MERGE` activation key — set locally via `/build --auto --auto-merge` (the
`--auto-merge` flag or `AUTO_MERGE=true` env, resolved by `.claude/scripts/auto-merge.js`),
or via symphony's `AUTO_MERGE` key. In both cases GitHub merges only once the repo's
required status checks pass.
