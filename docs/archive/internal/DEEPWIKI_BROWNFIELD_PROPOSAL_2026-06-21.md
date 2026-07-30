# Proposal: DeepWiki-grade code-map / brownfield

**Date:** 2026-06-21
**Status:** Design proposal (disposable analysis artifact — not run through the SDLC pipeline).
**Trigger:** The live e2e alter step (`/brownfield` on a 1-file CLI) took **~20 minutes**. Investigation showed why, and pointed at Devin's DeepWiki as the bar.

---

## 0. TL;DR

Our brownfield system has **two layers**: a fast, deterministic, incremental **code-graph** (already DeepWiki-grade — arguably ahead of DeepWiki, which exposes no explicit dependency DAG) and a slow, **eager, monolithic, uncached LLM narrative layer** (six markdown essays generated *every run, regardless of repo size*). The 20-minute cost is entirely the second layer.

The fix is not to rewrite the graph — it's to make the narrative layer behave like DeepWiki: **lazy, scoped, cached/incremental, and queryable** instead of eager and pre-written. Target: the alter step drops from ~20 min to **~2–3 min** on small repos and scales sub-linearly on large ones, because we stop paying to re-narrate unchanged code.

---

## 1. What's slow, exactly

`/brownfield` (see `.claude/skills/brownfield/SKILL.md`) writes:

| Artifact | How produced | Cost |
|---|---|---|
| `code-graph.json` (+`.meta.json`) | **deterministic** AST indexer (`code_index.py`) | fast, incremental (`--files`) |
| `symbol-map.md`, `dependency-graph.md`, `coupling-report.md` | **script-rendered** from the graph | fast |
| `ci-map.md`, `flag-inventory.md`, `perf-baseline.json` | **deterministic** extractors | fast |
| `codebase-map.md` | **LLM essay** | slow |
| `architecture-map.md` | **LLM essay** | slow |
| `test-map.md` | **LLM essay** | slow |
| `risk-map.md` | **LLM essay** | slow |
| `change-strategy.md` | **LLM essay** | slow |
| domain glossary | **LLM essay** | slow |

So for a **1-file CLI** we paid for **six full LLM document generations** when the deterministic graph already held the structure. That is precisely the anti-pattern DeepWiki avoids.

## 2. What DeepWiki does that we don't

From Devin's docs (DeepWiki = auto-generated *"architecture diagrams, documentation, links to sources, and summaries,"* organized as **hierarchical wiki pages** with Mermaid + **source citations**) and the inspectable open clone (deepwiki-open / deepwiki.com):

1. **Static wiki + queryable RAG, sharing one index.** It's *both*: generated hierarchical pages **and** "Ask the wiki" (plus a multi-hop "Deep Research" mode that follows call chains). You query ("where's the auth boundary?") and it retrieves + answers with citations — cheap, because you generate only the answer you need.
2. **Bounded, cluster-based page planning.** Generation is agentic and groups the repo into **topic clusters → one page per cluster, hard-capped** (max 30 pages, 80 enterprise; overridable via `.devin/wiki.json`). This is the insight a "fixed 7 essays" approach misses: page count is **repo-shaped and bounded**, not constant.
3. **Persistent embedding index + RAG.** The open clone: shallow-clone → **excluded-dir filter** (`.git`, `node_modules`, `venv`…) → chunk → **embed** → persistent vector DB (`adalflow LocalDB`) → RAG (Memory + Retriever + Generator) → deterministic Mermaid. Retrieval is reused across every page *and* every later question, so cost is sub-linear, not O(repo) per run.
4. **Grounds agents by retrieval, not front-loading** — the economic framing in Devin's own docs ("<20% of time writing code; most goes to *understanding* systems"): front-load comprehension once into the index, serve it on-demand per task.

**Where DeepWiki is actually WEAK — and we can beat it:** its wiki is **regenerated on a schedule, not on commit/PR; there is no incremental/diff update** (it "can lag `main` by hours to days"; the open clone has the same gap — new commits don't appear). The research's verdict: *"incremental regeneration keyed to graph deltas is the single biggest win DeepWiki itself lacks."*

**What we already have that DeepWiki doesn't expose:** an explicit, **incremental** dependency DAG (`code-graph.json` with symbol-level edges, routes, god-file skeletons, `--files` patching) + a **graph-refresh hook** that tracks dirty files. That incremental graph is exactly the substrate to do the thing DeepWiki can't — so this is our moat *and* our path to surpassing it on currency.

> Sourcing caveat (from the research): Cognition does not publish DeepWiki's exact pipeline/embedding-model/store; the generation-time figures (~30s–few min) and the deepwiki-open internals are secondary/separate-project, suggestive not authoritative. The *shape* (index → bounded cluster pages → RAG; scheduled non-incremental refresh) is well-supported.

## 3. Proposal — make the narrative layer DeepWiki-grade

Ordered by impact-per-effort (fast wins first).

### 3.1 — Lazy + scoped by default (biggest, cheapest win)

`/brownfield` today generates all six essays unconditionally. Change the default to **graph-only** (deterministic, seconds), and make the narrative maps **opt-in and scoped**:

- `/brownfield` → deterministic graph + the script-rendered maps only. Fast.
- `/brownfield --maps architecture,risk` → generate only the requested essays.
- `/brownfield --for "<change goal>"` → generate only the narrative the change actually needs (the seam-finder already does goal-scoped analysis — generalize it).

For the **`/change` / alter path specifically** (the thing that was slow): it does **not** need `architecture-map` + `test-map` + `risk-map` + `change-strategy` + glossary. It needs the **graph** (what depends on what I'm touching) + coverage. So `/change` should consume `code-graph.json` directly and skip the essay generation entirely. **This alone takes the alter step from ~20 min to ~2–3 min.**

### 3.2 — Incremental narrative caching

When narrative *is* requested, key each section to the **content hashes already in `code-graph.json#files`**. The graph-refresh hook already computes dirty files. Only re-summarize modules whose hash changed; copy the rest from the previous map. A second `/brownfield` on an unchanged repo should be near-instant; after a small change, only the touched module's section regenerates.

### 3.3 — Queryable wiki ("ask the codebase") instead of pre-written essays

The strategic upgrade. Add a thin **retrieval layer** over `code-graph.json` + source so agents *query* instead of reading essays:

- A `code-map query "<question>"` (or skill) that, given a question, pulls the relevant subgraph (symbols + neighbors + source slices) and answers — DeepWiki's "ask the wiki."
- `/change`, `/refactor`, `/auto` consume this on-relevance (retrieve the slice around the symbols they touch) rather than front-loading six documents.
- For large repos, back the retrieval with an **embeddings/vector index** of symbol/file chunks (the DeepWiki-Open approach) so retrieval is sub-linear; the deterministic graph supplies exact edges, embeddings supply fuzzy "where is X-ish" recall. (Exact index/model TBD from the research pass.)

This is what makes it both **fast** (generate only the answer) and **scalable** (retrieve, don't read everything).

### 3.4 — One deterministic, always-current wiki backbone

Render a single `WIKI.md` (or a small site) **deterministically from `code-graph.json`** — module index, per-module symbol lists with line ranges, the Mermaid dependency graph, god-file skeletons, routes. Instant, never stale, zero LLM. Layer LLM prose **only** on top where it adds value (a one-paragraph "what this module is for" per hub module, cached per §3.2). This is the always-current backbone; the essays become optional enrichment.

### 3.5 — Keep it current automatically

Wire the existing **graph-refresh hook** (post-write/commit) to also refresh §3.4's wiki backbone incrementally (it already patches the graph via `--files`). The wiki then tracks HEAD with no manual `/brownfield` re-run — DeepWiki's "no staleness" property, which we get cheaply because the graph is already incremental.

### 3.6 — Bounded, cluster-shaped narrative (replace "fixed 6 essays")

Adopt DeepWiki's cluster-based planning, but driven by **our graph**: run community detection / connected-components on `code-graph.json` edges to get topic clusters, then generate **one bounded page per cluster, capped** (e.g. ≤ N pages), instead of six fixed essays. Small repo → 1–2 pages; large repo → bounded set of the important clusters. Page count becomes repo-shaped, not constant — which is also what makes incremental regen (§3.2) natural: invalidate only the clusters whose member hashes changed.

### 3.7 — Cheap, immediate wins

- **Exclusion config before indexing** — ensure vendored/generated/test dirs (`node_modules`, `dist`, `.venv`, migrations…) never enter narrative generation. Our AST indexer already has `SKIP_DIRS`; extend the same exclusion to the narrative pass. Largest single cost-saver on big repos.
- **Source citations with line ranges in every map** — the graph already carries exact line ranges; emit them into the narrative so every claim links to `file:line`. Near-zero effort, big trust/navigation win (DeepWiki's "links to sources").
- **Deterministic Mermaid only** — keep diagrams script-rendered from the graph (we already do in `/code-map`); reserve the LLM strictly for prose.

## 4. Impact

| | Today | After |
|---|---|---|
| `/brownfield` on a 1-file CLI | ~20 min (6 LLM essays) | seconds (graph + rendered maps); essays opt-in |
| `/change` alter step | ~20 min | ~2–3 min (consumes graph, no essays) |
| Re-map unchanged repo | full regen | near-instant (hash cache) |
| Large repo | linear in files × 6 essays | sub-linear (retrieve, don't narrate everything) |
| Agent grounding | read 6 front-loaded docs | query on-relevance (cheaper context) |

## 5. Phasing

- **P1 (days):** §3.1 lazy/scoped default + make `/change`/`/refactor` consume `code-graph.json` directly (skip essays). Captures ~90% of the speed win.
- **P2:** §3.2 hash-keyed incremental narrative + §3.4 deterministic `WIKI.md` backbone + §3.5 graph-refresh wiring.
- **P3:** §3.3 queryable "ask the codebase" retrieval; add embeddings index for large repos.

## 6. What NOT to do

- **Don't drop the dependency DAG** for an embeddings-only wiki. The exact symbol-edge graph is our advantage over DeepWiki (whose docs expose no DAG) and is what makes `/seam-finder`, coupling analysis, and safe refactors work. Embeddings *augment* it for fuzzy recall; they don't replace it.
- **Don't make the wiki self-judged/LLM-only.** Keep the deterministic backbone authoritative; LLM prose is enrichment, never the source of truth (same principle as our generator/evaluator split).
- **Don't pre-generate six essays "just in case."** That's the whole bug. Generate on demand, scope to the task, cache by hash.

---

**Bottom line:** we don't need to chase DeepWiki on the *graph* — we're ahead there. Copy its **economics** (index once, retrieve on relevance, bounded cluster pages — §3.3/§3.6) and we match it; add **incremental regen keyed to graph deltas** (§3.2/§3.5) — the one thing DeepWiki itself doesn't do — and we **surpass** it on currency (continuously fresh vs their hours-to-days lag). And the first step is tiny: **§3.1 — `/change` / `/refactor` consume `code-graph.json` directly and skip the six essays — removes the ~20-minute pain immediately**, with the rest as follow-on phases.

---

## Sources

Devin DeepWiki docs (`docs.devin.ai/work-with-devin/deepwiki`), Devin SDLC integration (`docs.devin.ai/essential-guidelines/sdlc-integration`), Cognition DeepWiki announcement (`cognition.com/blog/deepwiki`), deepwiki-open (`github.com/AsyncFuncAI/deepwiki-open`) + its self-wiki, deepwiki-open issue #402 (no incremental sync), codersera guide (secondary, generation-time figures). Our system: `.claude/skills/brownfield/SKILL.md`, `.claude/skills/code-map/SKILL.md`, `.claude/skills/code-map/scripts/code_index/`.
