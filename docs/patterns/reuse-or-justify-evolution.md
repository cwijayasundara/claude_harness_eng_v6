# Reuse-or-Justify: A Pattern for Deterministic Sprint-by-Sprint Architecture Evolution

**Status:** Design pattern (framework- and domain-agnostic)
**Date:** 2026-07-17
**Audience:** Anyone evolving a system increment-by-increment with an AI coding agent in the loop.

---

## 1. The problem this solves

When you build a system **sprint by sprint from a per-sprint PRD**, each increment is generated with fresh context and strong local incentives to *ship this sprint's stories*. The path of least resistance for an agent (and a human under time pressure) is **copy-paste-and-adapt**: clone the closest existing thing, tweak it, move on. Do that six times and you get a big ball of mud — not because any single sprint was bad, but because **nothing forced increment N to *extend* increment N-1's structure instead of forking a parallel one.**

The failure is concrete and recognizable. A real audit of a system built this way found:

- **N near-identical vertical slices** (one per report type / entity / feature) that should have been one parameterized structure. This was named "the architectural root cause behind almost every other finding."
- **40+ duplication clusters**; **15+ independent reimplementations** of a single utility (currency parsing) when one correct implementation already existed; multiple byte-identical modules whose docstrings literally said *"mirrors X."*
- **Declared-but-unenforced architecture**: layer rules and file-size limits written into guidance, systematically violated in practice (services importing routers, 500-line "300-line-limit" files).
- **A correctness bug born from bad duplication**: two drifted copies of one gate were merged poorly, producing dead code that silently disabled a data-quality check.
- **Performance and state-management debt** that followed structurally from N uncoordinated slices (O(n²) rescans reimplemented per slice; four independent client-side state hacks because there was no single source of truth per run).

**The point:** every one of those is a *second-order symptom*. The first-order cause is a missing decision at intake — *"does this increment reuse an existing seam, or create a new structure?"* — made explicitly, examined, and enforced.

### Why spec-driven tools don't already prevent this

Devin's Interactive Planning, Kiro, and GitHub spec-kit all share one shape: a persistent **constitution** of invariants + a **specify → plan → tasks** decomposition with human review between steps. They are excellent at pinning down **what** to build. But **none of them has an anti-duplication forcing function** — nothing that makes "reuse the existing seam vs. build a new one" an examined, recorded, enforced decision. They govern *intent*; they do not govern *structural convergence over time*. That gap is exactly where mud accretes, and it is what this pattern adds.

---

## 2. The core invariant

> **Reuse-or-Justify.** No increment may introduce a *new* structure when an existing **seam** can be extended. Before any code is written, each story/feature must either **name the seam it extends**, or **explicitly justify introducing a new seam** — and that choice is made in an evidence-grounded dialogue with a human engineer and recorded immutably.

A **seam** is a domain-independent term for *a designed extension point* — the place the system was built to grow. What plays the role of "seam" is domain-specific (§7), but the invariant is not.

This single rule is the whole pattern. Everything below is machinery to make the rule **cheap to obey, hard to bypass, and verifiable after the fact.**

---

## 3. The loop: four stages per increment

Every increment — a story, a feature, or a release's worth of stories — runs the same four stages:

| # | Stage | Owner | Input | Output | Blocking? |
|---|-------|-------|-------|--------|-----------|
| 1 | **Ground** | Machine | The new story/feature + living design + code-graph | A ranked list of existing seams this change *could* extend, with evidence (files, similarity scores, touched invariants) | No |
| 2 | **Interrogate** | Human ↔ Agent | The grounding pack | An examined reuse-vs-new decision per candidate | Only when it fires (see gating) |
| 3 | **Decide + Record** | Human decides, machine records | The dialogue outcome | An immutable decision record ("options considered → decision → seam named / new-seam justification → invariant impact") | Yes — hard gate |
| 4 | **Enforce** | Machine | The recorded decision + the produced code | PASS, or a BLOCK when code did not honor the decision | Yes — hard ratchet |

**Determinism comes from the ownership split.** Stages 1, 3-record, and 4 are machine-owned and reproducible. Only the *judgment* in stage 2 ("is this genuinely the same thing, or legitimately different?") is human — because that judgment is irreducible, not because it's convenient. The human decision then becomes a **machine-readable constraint** that stage 4 verifies and that future increments' stage 1 grounds against. The loop cannot quietly drift, because every drift-prone choice is either recorded or enforced.

### Gate posture (the tuning that makes this usable)

Naive "review every change" trains teams to rubber-stamp. This pattern uses a deliberately asymmetric posture:

- **Stage 2 firing is *confidence-gated*.** The dialogue only surfaces when grounding shows a real reuse candidate above a threshold, **or** a constitution invariant is touched. Trivial, obviously-net-new work proceeds without interrogation. (Devin-style: don't stop for nothing.)
- **When it fires, the stage-3 decision *blocks*.** At a genuine fork, the reuse-vs-new choice is non-negotiable and must be answered. (Kiro-style: real gate at real forks.)
- **Stage 4 is a *hard ratchet*.** New duplication above baseline, or code that forked a parallel module after the human said "extend seam X," blocks the merge.

The threshold that governs stage-2 firing should be **a per-project setting with a sane default** — most teams never touch it; a team doing heavy platform consolidation turns sensitivity up.

> **Design rationale.** The common failure is *not* too few approval gates — mature pipelines already have them. It is that the approvals are rubber-stampable ("looks like a fresh design, approve") because **no forcing function points the reviewer at the specific reuse decision.** This posture fixes the *aim* of the human's attention, not its *frequency*.

---

## 4. Stage 2 in detail — the "superpowers-style" dialogue

Stage 2 is a Socratic, **one-question-at-a-time** exchange (in the spirit of a brainstorming dialogue), but scoped narrowly to **evolution decisions**, not open-ended clarification. It surfaces three kinds of question, each only when grounding justifies it:

1. **Reuse-vs-new.** *"This looks like the 2nd instance of pipeline-shaped work. Seam `X` already implements upload → dedup → map. Do we (a) extend `X`'s generic node, (b) add a pluggable strategy to `X`, or (c) does this genuinely need a new structure — and if so, justify it?"*
2. **Invariant impact.** *"This change touches constitution invariant `I-3` (all orchestration goes through the graph). Confirm the change stays inside it, or propose amending the invariant (which is itself a reviewed decision)."*
3. **Contract / data-shape impact.** *"This alters a persisted shape / a public contract. Confirm the expand-contract path."*

Each answered question is appended to the decision record. Questions the grounding pass didn't raise are never asked — the human's attention is a scarce resource spent only at forks.

---

## 5. The persistent spine (artifacts)

The loop is only deterministic because it reads and writes durable artifacts, not the model's short-term memory:

- **Living design baseline** — one persistent architecture description that increments *amend*, never regenerate. (If you regenerate the design each sprint, you have already lost; the baseline is the memory that makes convergence possible.)
- **Seam registry** — the enumerated extension points, each with: name, responsibility, where it lives, how you extend it (add a config? a strategy? a node?), and its current instances. This is what stage 1 grounds against and what stage 2 offers as reuse options.
- **Constitution** — the short list of non-negotiable invariants. Changing one is itself an architectural decision that goes through review.
- **Decision log** — immutable, append-only records (ADR / amendment style). A correction after approval is a *new* record, never an edit. This is the audit trail of *why* the structure is what it is.
- **Code-graph** — a deterministic dependency/symbol graph (AST-derived) that powers grounding, duplication detection, and enforcement.

---

## 6. Granularity and batching

The unit of the loop scales, and **the batching behavior at larger units is what prevents same-release cloning:**

- **Story** — checked against the living baseline (new-vs-existing).
- **Feature / release (multiple stories at once)** — checked against the baseline **and cross-checked against each other (intra-batch)**. When three stories in one release all need amount-parsing, the loop collapses them to one shared seam *before any code is written*.

> Intra-batch checking is not optional polish. Single-story-scoped tools structurally **cannot** catch this: two stories that both invent the same utility each pass a "does this already exist in the baseline?" check, because neither exists *yet*. Several of the 15 duplicate parsers in the motivating audit were born inside the same push. If your loop only compares against shipped code, you prevent half the failure.

---

## 7. Instantiating the pattern (it is domain-agnostic)

"Seam," "clone," and "enforce" take concrete form per domain. The invariant does not change.

| Domain | A "seam" is… | A "clone" (what to block) looks like… | Enforcement signal |
|--------|--------------|----------------------------------------|--------------------|
| **ETL / pipelines** | One parameterized pipeline with generic nodes + pluggable strategies | An Nth near-identical `upload→dedup→map→submit` module per entity | Token/AST clone detector; "new module not routed through the pipeline" |
| **CRUD / services** | A shared service + repository layer with typed entities | A new endpoint re-implementing persistence/validation inline instead of via the service | Layer gate; duplication ratchet |
| **UI** | A shared component/design-system library + hooks | A copy-pasted component with renamed CSS classes | Component-similarity / duplication check |
| **Multi-agent / orchestration** | A single state-machine graph + one authoritative run-state object | An agent calling another agent directly, bypassing the graph; ad-hoc state buses | "Direct cross-node call outside graph"; "state not carried in run-state object" |

The multi-agent row is the LangGraph-spine case: the graph *is* the seam, and "reuse-or-justify" means every new capability is a node/edge on the graph unless a new sub-graph is explicitly justified. But note the pattern would have equally prevented the motivating ETL failure with a *parameterized-pipeline* seam and no LangGraph at all. **The spine is an instantiation, not the pattern.**

---

## 8. Stage 4 fitness functions (what makes enforcement real)

The decision from stage 3 is only worth something if code is verified to honor it. Enforcement is a **ratchet** — it blocks *new* debt and grandfathers pre-existing debt, so it can be adopted on a messy codebase without a boil-the-ocean refactor:

1. **Duplication ratchet** — a real AST/token clone detector (not a "shared imports" heuristic). Blocks when new duplication rises above baseline. Must run in two modes: (a) changed-vs-existing, and (b) **whole-tree for brand-new modules** (closing the net-new blind spot) and **intra-batch for multi-story units** (§6).
2. **Seam-conformance check** — the decision said "extend seam `X`"; verify the diff actually touched `X` and did *not* create a parallel module. This is the check that turns the human's promise into a machine constraint.
3. **Layer / coupling / cycle ratchets** — structural guards (forward-only dependencies, no new import cycles, no new unstable hubs) so convergence isn't undone by tangling.
4. **Complexity ratchet** — cyclomatic/cognitive complexity per function, not just line count (a god-class can hide under a line limit by spreading across many small methods).
5. **Drift monitor** — runs *between* increments (scheduled, not per-diff) to catch decay that no single change introduced: newly dead code, new cycles, design-vs-code divergence.

Enforcement that is **advisory only does not count.** The single most common way this pattern fails in practice is shipping stage 4 as a report nobody blocks on.

---

## 9. Anti-patterns (how this pattern gets defeated)

- **Rubber-stamp gate** — a human approval with no forcing function pointing at the reuse decision. (The failure this pattern exists to fix; don't reintroduce it.)
- **Advisory duplication check** — detection that warns but never blocks. Debt you *measure* but don't *stop* still accumulates.
- **Net-new blind spot** — only comparing against shipped code, so brand-new clones and same-release twins pass. (See §6.)
- **Interrogating over trivia** — firing stage 2 when there's no real reuse candidate. Trains the team to dismiss the dialogue. Confidence-gate it.
- **Seam sprawl** — so many seams that "which one do I extend?" is itself confusing. Keep the seam registry small and curated; a seam that never gets a second instance probably shouldn't be a seam.
- **Regenerating the baseline** — any workflow that rewrites the whole design each sprint destroys the memory convergence depends on. Amend, never regenerate.

---

## 10. How this maps onto existing SDD tools

| Capability | Devin | Kiro | spec-kit | **Reuse-or-Justify** |
|------------|-------|------|----------|----------------------|
| Persistent invariants (constitution) | partial | ✅ steering | ✅ constitution.md | ✅ constitution |
| Interactive intake dialogue | ✅ (checkpoint) | ✅ (gated) | ⚠️ template-driven | ✅ **confidence-gated, blocks at forks** |
| Specify → plan → tasks decomposition | ✅ plan | ✅ | ✅ | ✅ (reuses whatever you have) |
| **Reuse-vs-new forcing function** | ❌ | ❌ | ❌ | ✅ **core** |
| **Machine enforcement that code honored the decision** | ❌ | ❌ | ❌ | ✅ **stage 4** |
| **Intra-batch dedup (same-release clones)** | ❌ | ❌ | ❌ | ✅ |

Reuse-or-Justify is **additive**: it layers the missing forcing function + enforcement onto any specify→plan→tasks tool you already use. It does not replace Devin/Kiro/spec-kit; it fills the hole all three leave open.

---

## 11. Adoption

- **Greenfield.** Sprints 1-2 are where seams are born. Establish the seam registry and constitution early; from sprint 2 onward, the loop runs on every increment. The cheapest time to have one parameterized pipeline is *before* you have two hand-built ones.
- **Brownfield (the common case).** You already have the mud. Before the loop can force reuse, **you must first extract seams from the existing code** — run a duplication/modularity analysis, identify the "this should have been one thing" clusters, and record them as seams to extend. In the motivating audit, the duplication matrix the team produced *was already the seam specification* — read the other way, "what's copy-pasted across the N slices" is exactly "what the generic seam must absorb." Extraction is a one-time investment; the loop then keeps the extracted structure from re-fragmenting.

---

## 12. One-paragraph summary

Sprint-by-sprint systems rot because nothing forces increment N to extend increment N-1's structure instead of cloning it. **Reuse-or-Justify** makes that the central, examined decision: a deterministic **Ground → Interrogate → Decide+Record → Enforce** loop where the machine grounds the choice in a living baseline + code-graph, a confidence-gated human dialogue resolves the irreducible "same or different?" judgment at real forks, the decision is recorded immutably as a constraint, and fitness functions verify the code honored it. It is domain-agnostic (the "seam" is a pipeline, a service, a component, or an orchestration graph depending on your problem), and it is additive to the spec-driven tools you already use — supplying the anti-duplication forcing function and the enforcement that Devin, Kiro, and spec-kit all leave out.
