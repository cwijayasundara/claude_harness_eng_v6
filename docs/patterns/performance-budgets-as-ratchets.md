# Performance Budgets as Ratchets: A Pattern for Keeping Performance from Decaying Increment-by-Increment

**Status:** Design pattern (framework- and domain-agnostic)
**Date:** 2026-07-17
**Companion to:** [Reuse-or-Justify](./reuse-or-justify-evolution.md) — same enforcement chassis, different quality attribute.
**Audience:** Anyone evolving a system increment-by-increment with an AI coding agent in the loop.

---

## 1. The problem this solves

Structural convergence (the [Reuse-or-Justify](./reuse-or-justify-evolution.md) pattern) keeps a system from fragmenting into N cloned slices. But even a perfectly-consolidated system can be **slow** — and performance debt accretes sprint-by-sprint for the same reason structural debt does: **each increment is optimized for "does the story work?", never for "is it still fast enough?", and nothing blocks a regression.**

The motivating audit (see the companion doc) found performance debt that was a direct consequence of the same sprint-by-sprint process:

- **Algorithmic blowups reimplemented per slice** — `O(n²)`/`O(n×m)` all-pairs fuzzy matches over full entity rosters with no pre-built index and no size cap, each solved independently (and poorly) in a different module.
- **Resource anti-patterns** — an `@lru_cache(maxsize=16)` keyed on raw file bytes holding **up to 16 full workbooks** in process memory, never evicted; heavyweight LLM/embedding clients **re-instantiated per call** instead of reused as singletons; the same workbook **parsed twice** because two code paths each parsed it.
- **No budgets anywhere** — nothing declared "this endpoint must stay under X ms" or "this job must stay under Y MB," so there was no line for a regression to cross.

None of these is exotic. Each is the kind of thing a fitness function catches trivially — *if one exists and it blocks.* The failure is not that the problems are hard to detect; it's that **nobody was tracking them, and the checks that existed didn't block.**

---

## 2. Why the usual performance checks miss it

Most harnesses that do *any* perf checking still leak these four ways. Name them so you can design against them:

1. **Regression-only, blind to gradual creep.** A check that fails only on ">X% slower than last time" lets **death by a thousand cuts** through: ten increments each adding 5% never trip a 50% gate, but together they've 1.6×'d the latency. You must ratchet against the **original committed baseline**, not the previous increment, and track **cumulative** drift.
2. **Sequential-only sampling, blind to concurrency.** Measuring one request at a time (to keep the baseline clean) structurally **cannot** see connection-pool exhaustion, lock contention, or cache-stampede — the failures that define "major performance problem in production." Concurrency needs a **load probe**, not a single-request timer.
3. **Advisory, not blocking.** A perf number in a report nobody gates on is telemetry, not a fitness function. Debt you *measure* but don't *stop* still ships.
4. **Contract-scoped blind spot.** You only measure what you declared. An endpoint or job path never listed in the contract is never measured — so the slowest, least-considered paths (exactly the ones nobody thought about) are invisible.

---

## 3. The core invariant

> **Performance Budgets as Ratchets.** Every performance-relevant unit (endpoint, job, hot path, interaction) has an explicit **budget** — absolute, not merely relative. Every increment **inherits** the budget of the seam it extends and must declare a budget for any new seam it creates. A measured breach of an absolute budget, or a regression past the ratchet against the **original baseline**, **blocks the merge** exactly like a failing test.

Performance stops being a thing you notice in production and becomes a thing that is **declared, inherited, measured, and blocked** — a first-class fitness function on the same footing as correctness.

---

## 4. Two enforcement layers

Performance is guarded at two costs/cadences. Both are ratchets (block *new* debt, grandfather existing) so the pattern is adoptable on an already-slow codebase.

| Layer | Runs | Cost | Catches | Example checks |
|-------|------|------|---------|----------------|
| **Static** | Every write / commit | Cheap (no execution) | Bad *shapes* before they run | Cyclomatic/cognitive **complexity ratchet**; **algorithmic-hotspot** heuristic (nested loop calling a similarity/DB/fuzzy fn; unbounded in-memory scan; no size cap); **resource anti-patterns** (per-call heavyweight-client instantiation, unbounded cache on large objects, N+1 query, sync I/O in async path, double-parse) |
| **Dynamic** | Per increment (at the gate/evaluator) + between increments (drift monitor) | Requires running the app | Actual slowness and resource use | **Latency ratchet** (absolute budget + regression vs original baseline); **resource ceiling** (peak memory / handles per job); **load/concurrency probe** for declared hot paths; **cumulative-drift alert** |

**Static catches the audit's algorithmic and resource findings before they ever execute** — the O(n²) fuzzy match, the per-call client, the oversized cache are all *shapes* a static pass flags. **Dynamic catches what shape can't predict** — real latency under real data, and (via the load probe) the concurrency failures that sequential sampling misses.

---

## 5. Closing the two blind spots explicitly

The pattern is defined by how it handles the two failures §2 named as structural:

- **Gradual creep** → the latency ratchet compares against the **first committed baseline for that path**, and a separate **cumulative-drift** signal tracks total movement since origin. Sustained small regressions trip an alert even when no single increment crosses the per-step threshold. (Set the per-step threshold *tight* — e.g. 10-15%, not 50% — precisely because the baseline is absolute, not sliding.)
- **Contract-scope** → **budget declaration is mandatory at intake, not optional at test time.** This is the tie to the companion pattern: when a Reuse-or-Justify decision **creates or extends a seam**, declaring that seam's performance budget is part of the recorded decision. A new endpoint with no declared budget **fails the intake gate** — you cannot ship an unmeasured hot path, because you cannot ship an undeclared one.

---

## 6. Budgets are declared and inherited (the tie to Reuse-or-Justify)

Budgets live with seams, not scattered in test files:

- **Declared at seam creation.** When a new seam is justified (companion pattern, stage 3), its budget is declared alongside it: *"the pipeline `map` node: ≤ 800 ms p95 per 10k rows, ≤ 512 MB peak."*
- **Inherited by extensions.** An increment that extends an existing seam inherits that seam's budget automatically — it does not get to silently redefine "fast enough." Loosening a budget is itself a reviewed decision (like amending a constitution invariant), recorded immutably.
- **Consolidation makes budgets meaningful.** This is why the companion pattern is a precondition: with 6 cloned fuzzy-match implementations there are 6 places to measure and 6 budgets to drift; with **one seam** there is one budget, one baseline, one hotspot to optimize. **Consolidation makes performance *fixable*; budgets-as-ratchets make it *stay fixed*.**

---

## 7. Instantiating the pattern (domain-agnostic)

The budget's *units* are domain-specific; the ratchet is not.

| Domain | Budgeted quantities | Load-probe target | Resource ceiling |
|--------|--------------------|--------------------|------------------|
| **Services / API** | p95 / p99 latency, error-rate SLO | concurrent-request throughput; pool saturation | connections, memory/req |
| **ETL / pipelines** | rows/sec throughput, wall-clock per batch | parallel-batch contention | **peak memory per job** (the workbook-cache case) |
| **UI** | interaction latency (INP), bundle size | — | main-thread blocking, memory |
| **Multi-agent / LLM** | **tokens per task, $ cost per run**, tool-call count, wall-clock | concurrent-session cost blowup | **per-call client reuse** (the singleton case), context size |

The multi-agent row matters for AI systems specifically: the "per-call heavyweight client" and "cost per run" budgets are the performance fitness functions an agentic app needs and rarely has.

---

## 8. Anti-patterns (how this pattern gets defeated)

- **Sliding-window baseline** — ratcheting against the previous increment instead of origin; re-enables gradual creep.
- **Sequential-only measurement** — no load probe, so every concurrency failure ships. The most common cause of a "sudden" production perf incident.
- **Advisory perf report** — measured, never blocked. Telemetry masquerading as a gate.
- **Optional budget declaration** — budgets you *may* declare are budgets nobody declares for the risky paths. Make declaration a hard gate at seam intake.
- **Loose regression threshold to "reduce noise"** — a 50% gate is a 49%-regression license. Reduce noise with a stable baseline environment, not a loose threshold.
- **Micro-optimizing un-budgeted code** — spending effort where no budget says it matters. Budgets also tell you where *not* to look.

---

## 9. Relationship to Reuse-or-Justify

They are **peers on one enforcement chassis**, guarding orthogonal quality attributes:

| | Reuse-or-Justify | Performance Budgets as Ratchets |
|---|---|---|
| Guards | Structural convergence (no clones) | Runtime efficiency (no decay) |
| Decision at intake | reuse seam vs. justify new | inherit budget vs. declare/loosen |
| Static enforcement | duplication + seam-conformance | complexity + hotspot + resource smells |
| Dynamic enforcement | — | latency/resource ratchet + load probe |
| Shared machinery | stage-4 ratchet, drift monitor, immutable decision log, code-graph | same |

Run them together: the structural loop keeps the system to **one** hotspot per concern; the performance loop keeps that hotspot **within budget**. Neither substitutes for the other — a consolidated system can be uniformly slow, and a fast system can still be an unmaintainable clone-pile.

---

## 10. Adoption

- **Greenfield.** Declare budgets when seams are born (sprints 1-2). Cheap, and it sets the baseline while the system is fast.
- **Brownfield (the common case).** You cannot ratchet against a budget you never set. Onboarding is two steps: (1) **measure current** latency/throughput/resource for each hot path and **freeze it as the baseline** (grandfathering today's slowness — you block *worse*, you don't demand *better* on day one); (2) run the **static** layer immediately (it needs no baseline) to surface the algorithmic and resource smells already present, and triage them as explicit debt. From there every increment ratchets.

---

## 11. One-paragraph summary

Performance decays sprint-by-sprint because each increment is optimized for "does it work?" and nothing blocks a regression. **Performance Budgets as Ratchets** makes efficiency a first-class fitness function: every hot path has an **absolute, declared, inherited budget**; a **static** layer (complexity, algorithmic-hotspot, and resource-anti-pattern checks) blocks bad shapes before they run, and a **dynamic** layer (latency/resource ratchet against the *original* baseline, plus a **load/concurrency probe**) blocks measured breaches — closing the four ways usual perf checks leak (regression-only, sequential-only, advisory, contract-scoped). Budgets are declared at seam intake (tying it to the [Reuse-or-Justify](./reuse-or-justify-evolution.md) decision), so no unmeasured hot path can ship. It rides the same enforcement chassis as its structural companion: consolidation makes performance *fixable*, budgets-as-ratchets make it *stay fixed*.
