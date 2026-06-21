# Scaffold v5 → Autonomous Engineer — Grounded Proposal

**Date:** 2026-06-20
**Status:** Analysis + roadmap. Disposable artifact (not product code; not run through the GAN pipeline).
**Inputs:** User vision dump (this session) + codebase audit + external research on Devin and OpenAI Symphony.

---

## 0. TL;DR

~80% of the vision in the proposal **already exists** in v5 (P0–P3 shipped 2026-06-20, 514 tests). The proposal is best read not as "build this" but as "close these specific gaps":

1. **One lane, not two** (greenfield/brownfield) — already true; documented below so it stays true.
2. **Mermaid dependency graph** in `/spec` — real gap, trivial win.
3. **PRD format** — the pipeline grounds on an *FRD*, not a *PRD*; pick one canonical term + schema.
4. **Fast self-healing e2e self-test** — the slow certification suite exists; the ≤20-min self-healing smoke with a browser assertion + modify-existing cycle does not.
5. **Autonomy: PRD→PR→auto-merge** — `symphony_clone` executes a groomed backlog and stops at Human Review; it needs upstream planning + a gated auto-merge mode.

External research validates the architecture: **Symphony's published `SPEC.md` is nearly identical to what `symphony_clone` already does**, and **Devin's main failure mode (self-judged verification) is the exact hole v5's independent GAN evaluator closes** — so the chosen "full auto-merge with gates" direction is sound *because* the gate is an independent evaluator, not the generator grading itself.

---

## 1. Do we need two lanes: greenfield and brownfield? — **No.**

**Answer: one lane, with a state-conditional first step. v5 already works this way; the proposal's instinct is correct.**

The two "lanes" are not two pipelines — they are the same pipeline reading the current state of the repo and choosing the next action:

| Concern | Greenfield | Existing/legacy codebase |
|---|---|---|
| Entry action | `/scaffold` writes harness + **empty** code-map | `/scaffold` runs a **comprehensive** `/code-map` first |
| Code map | starts empty, grows sprint-by-sprint | built once up front, kept current on every check-in |
| `/spec` | decomposes into new stories | decomposes new stories *against* existing structure |
| `/design` | authors new architecture | **extends** existing architecture (brownfield-aware) |
| `/auto` | generates against empty graph | generates against populated graph |

The only genuine fork is the **first action**: a populated repo needs an upfront comprehensive code-map; a greenfield repo starts the map empty. Everything downstream is identical and branches on "does the symbol/architecture already exist?" — which is a *data* question (is the code graph empty?), not a *pipeline* question.

**Why keep it one lane:** two parallel pipelines would double the maintenance surface, double the test matrix, and create drift between them — exactly the kind of fake-abstraction the coding principles warn against. The code graph (`code-graph.json`) is the single source of "where are we," and every stage consults it. Greenfield is just the degenerate case where the graph is empty.

**Action:** keep one lane. Document this invariant in `design.md` so no future change splits it. The current `/brownfield` is *discovery tooling within the lane*, not a separate lane — its name is slightly misleading but (per the prior deep-dive) renaming it churns tests for little gain.

---

## 2. PRD vs FRD — pick one canonical term + a minimal schema

Today: `/brd --frd <path>` grounds the BRD on a **Functional Requirements Document**. The proposal repeatedly says **PRD**. There is no canonical PRD schema in the repo. This is a terminology + format gap, not a capability gap.

**Recommendation:** standardize on **PRD** as the human-authored entry artifact (it's the term you use and the industry-standard term), and define a minimal, machine-checkable schema so the BRD's net-new/dropped grounding gate can run against it. Optimal PRD format for *this* harness (lean, gate-able):

```markdown
# PRD: <product/feature name>

## 1. Problem & Goal            (1 paragraph — why this exists)
## 2. Users & Jobs-to-be-done   (who, and what they're trying to do)
## 3. Functional Requirements   (FR-1, FR-2, … — each atomic, testable, id'd)
## 4. Non-Functional Requirements (NFR-1, … — perf, security, a11y, SLOs; id'd)
## 5. Out of Scope              (explicit non-goals — feeds Forbidden Actions)
## 6. Acceptance / Done         (observable end-state per FR — postconditions)
```

Why this shape: every FR/NFR has a stable id → the existing deterministic grounding gate (`frd-requirements.json`) works unchanged (just rename FRD→PRD). Section 5 maps to a Devin-style **Forbidden Actions** list (steal this primitive). Section 6 gives the evaluator **postconditions** to verify instead of self-judged "looks done." Sections 4 + 6 are where NFRs enter the grounding chain — the proposal explicitly asked for NFR coverage.

**Action:** rename `--frd`→`--prd` (keep `--frd` as a deprecated alias), add the schema above as a `/scaffold` template, and have `/brd` emit Forbidden Actions + per-FR postconditions into the BRD so they propagate to sprint contracts.

---

## 3. Mermaid dependency graph in `/spec` — quick win

`/spec` writes `specs/stories/dependency-graph.md` as **tables only** (Group A/B/C with Story/Layer/Depends-On columns). The proposal wants a **visual graph**. `/code-map` already emits Mermaid for code structure, so the capability exists — it's just not applied to the *story* graph.

**Action:** add a `Step 4.5` to the `spec` skill that emits a Mermaid `flowchart` alongside the tables — nodes = stories (colored by group/layer), edges = `depends_on`. Cheap, deterministic, directly answers the ask. Pin its presence with a one-line addition to the spec contract test.

---

## 4. The automated e2e self-test — what's missing and the design

### What already exists
`test/e2e/` runs **8 live layers** against real `claude -p` (via `helpers/claude-runner.js`): framework validation, greenfield pipeline, real-workflow certification (`scaffold→brd→spec→design→build --lite` + runs the generated project's own test suite), adversarial fixture + live brownfield mutation (Claude edits legacy fixtures, protected files preserved), auto-build + telemetry, brownfield + native-command integration. Total ≈ **90 min**.

### What the proposal asks for that is NOT covered
1. **A fast (≤20 min) single full-lifecycle smoke** — the current suite is a 90-min certification, not a quick "is the engine wired?" smoke.
2. **A browser (Playwright) assertion in the loop** — the evaluator agent *has* Playwright tools, but the self-test never drives a browser app and asserts behavior deterministically.
3. **A clean "modify/extend already-generated code" cycle** — adversarial-live mutates *legacy fixtures*, not code v5 *just generated*. The proposal explicitly wants: scaffold → build → **then add/alter a feature on the generated code** → prove old + new both work.
4. **A self-healing fix loop** — today failures are *recorded*, not *repaired*. The proposal asks "loop and how do we fix these errors?"

### Design: `automated_e2e_test/` (built this session)
A new top-level package that **reuses** the existing `claude-runner.js` (don't reinvent) and adds the three missing pieces. Target app = a **minimal counter web app** (smallest thing that is (a) Playwright-assertable and (b) has a clean "add a feature" step). Flow:

```
1. /scaffold            → harness into a fresh temp dir
2. /build --lite "..."  → generate a tiny counter web app (server + page + tests)
3. VERIFY v1 (browser)  → launch app, Playwright: click +, assert count = 1
   └─ on failure → FIX LOOP: feed console errors + failing assertion + screenshot
      back via /change, re-launch, re-assert (bounded, N≤3)
4. /change "add a decrement button"   → MODIFY already-generated code
5. VERIFY v2 (browser)  → Playwright: decrement works AND increment still works (regression)
   └─ same FIX LOOP on failure
PASS only if v1 + v2 both green within the retry budget.
```

Why a web counter, not the existing todo-CLI: the CLI path is already certified by `harness-real-workflow.test.js`; the **web + browser + modify + fix-loop** path is the uncovered one, so this is additive, not duplicative. Why a fix loop at the e2e level: it's the GAN evaluator pattern applied to the *whole app* — and it's the single most Devin-like capability (observe failure → re-plan → repair) while keeping v5's independent-verifier advantage (Playwright is the oracle, not the generator).

**Keeping `npm test` green without paying for a live run:** follow the repo's own convention (`real-workflow-e2e-contract.test.js`) — a **static contract test** asserts the smoke harness wires the right stages (scaffold, build, browser-verify, /change, regression, fix-loop). The live run is gated/manual (`npm run test:smoke`), like the other live layers.

---

## 5. Autonomy: from "backlog executor" to "PRD → PR → auto-merge with gates"

**You chose: full auto-merge with quality gates, human gate behind an activation key.** Research says this is the right target *and* that v5 is closer than it looks.

### Where `symphony_clone` is today
It already implements the Symphony `SPEC.md` spine: polls Linear, claims an eligible group, isolated git workspace per issue, `claude --print` runs `/auto --group`, opens a PR, posts proof to Linear, **self-heals stuck runs** (reclaim on crash), **parallel runs** (`MAX_CONCURRENT_RUNS`), exponential backoff. It stops at **Human Review** (never `Done`) — exactly Symphony's default. This is "autonomous coding from a groomed backlog."

### The two gaps to reach Devin-style autonomy
**Gap A — start earlier (upstream planning).** Today a human must run `/brd→/spec→/design` and groom the backlog before symphony can claim anything. To go PRD→PR, the orchestrator needs a **planning stage**: given a PRD issue, run `/brd --prd → /spec → /design → /tracker-publish` autonomously to *produce* the groomed groups, then proceed as today. This is a new orchestrator state (`Planning`) ahead of the existing `Ready` state — not new pipeline code, just wiring existing skills into the orchestrator's reconcile loop.

**Gap B — close the merge (auto-merge mode).** Today it stops at Human Review by design. Add an **`AUTO_MERGE` activation key** (matching your "optional gate via activation key" model) that, when set, lets the orchestrator merge a PR **iff** the gate is green:
- `/gate` (evaluator + security-reviewer) passes,
- generated project test suite green,
- CI green,
- no Forbidden-Actions violations (from the PRD).

When the key is unset, behavior is unchanged (stops at Human Review). This is the single most important safety design: **the gate is an independent evaluator, not the generator** — which is precisely the property Devin lacks and the reason its real-world success rate is ~15%. Borrow Symphony's **reconcile-every-tick + stall-timeout + bounded backoff** spine (already present) and Devin's **Forbidden Actions + postcondition specs** (add via the PRD schema in §2) as the gate's teeth.

### Primitives worth stealing (from the research)
- **Machine snapshots / warm-start** (Devin): snapshot a built env so each orchestrator run skips cold `init.sh` setup. Cost + latency win for parallel runs.
- **Session-health telemetry** (Devin ACU/Session-Insights): flag XL sessions as "unhealthy" → a concrete trigger for `/auto`'s session-chaining to start a fresh context instead of rotting.
- **Knowledge as trigger-retrieved memory, not front-loaded** (Devin): aligns with v5's prompt-cache discipline — relevance-gated recall beats dumping into CLAUDE.md.
- **Per-state concurrency caps** (Symphony): cap `Planning`/`Todo` separately so the review queue doesn't bottleneck.
- **Symbol-level (AST) locking** (Wit, advanced): if you ever push beyond one-agent-per-issue, lock at the symbol level (v5 already has the AST graph from `/code-map`).

---

## 6. Staged roadmap

| Stage | Work | Size | Risk |
|---|---|---|---|
| **S0 (this session)** | `automated_e2e_test/` fast self-healing smoke + contract test | M | low |
| **S1** | Mermaid story graph in `/spec`; PRD rename + schema + Forbidden Actions/postconditions | S | low |
| **S2** | symphony `Planning` state — orchestrator runs `/brd→/spec→/design→/tracker-publish` from a PRD issue | M | med |
| **S3** | symphony `AUTO_MERGE` activation key — gate-conditional merge (evaluator+security+CI+forbidden-actions) | M | **high** (autonomy) |
| **S4** | Steal: machine snapshots (warm-start), session-health → chaining trigger | M | med |

S3 is the one to roll out behind the activation key and watch closely — it's the genuine "no human engineer" step, and the gate quality is everything.

---

## 7. What the research explicitly warns against

- **Don't copy Devin's self-verification.** Same model writing and grading → "illusory solutions." v5's separate evaluator is the moat; the auto-merge gate must stay independent of the generator.
- **Don't over-build orchestration.** Symphony is deliberately *a spec + throwaway reference impl*, tracker-as-truth, no DB/bus. `symphony_clone` already matches it. Resist adding a control-plane DB or message bus — the tracker is the backplane and the recovery mechanism.
- **Budget enforcement is a real gap in Symphony** (token accounting only, no caps). v5 should add **per-task budget caps** (the `--max-budget-usd` already used in the e2e runner) to the orchestrator — a cheap edge over Symphony.
