# Agentic Flywheel — Design Narrative

**Status:** Phase A implemented and live (scorecard + `/retro`, auto-invoked at `/auto` session end) · Phase B/C still design-only · **Lane:** `/design --doc-only` (disposable architecture narrative; no planner/generator/evaluator, no `specs/design/` schema set)
**Author:** Harness maintainer · **Date:** 2026-07-13 (updated same day — §9 open questions resolved)

> This is an ARB-style narrative, not product code and not a sprint contract. It explains where the harness sits on Kief Morris's autonomy progression and how to evolve it one safe increment at a time. Implementation escalates to the brownfield SDLC route (`/feature` → `/spec`/`/design`/`/auto`) per component; nothing here ratchets or gates on its own.

---

## 1. Motivation

Kief Morris, *"Humans and agents in software engineering loops"* (martinfowler.com, 2026-03-04), frames human involvement as four modes, distinguished by **who runs, defines, and improves the "how loop"**:

| Mode | Definition |
|---|---|
| Humans **outside** the loop | Vibe coding — humans state outcomes only. |
| Humans **in** the loop | "Human runs the why loop and the how loop." Inspects each artifact. Bottleneck: agents generate faster than humans review. |
| Humans **on** the loop | "Human defines the how loop and the agent runs it." When unsatisfied you **change the harness that produced the artifact**, not the artifact. |
| **Agentic flywheel** | "Human directs agent to **build and improve the how loop** itself." |

The flywheel's defining mechanic, verbatim: *"For each step of the workflow we have the agent review the results and recommend improvements to the harness."* Recommendations carry **risk / cost / benefit scores** and move through graduated autonomy — interactive review → backlog prioritization → *"recommendations with certain scores should be automatically approved and applied."* Its power *"scales with the richness of feedback signals"* (pipeline metrics → operational data → user journeys → commercial results).

Two companion constraints (Thoughtworks, verified 3–0 in research) shape the safety model:

- **Deterministic guardrails must sit outside the flywheel.** *"When AI … orchestrates the entire workflow, the established process, which serves as a harness for ensuring quality, could be at risk. Automated non-AI rules must ensure that minimum guardrails are met."*
- **Conant–Ashby good-regulator theorem.** The human stays a good regulator only by keeping an accurate mental model — periodic manual "go see" spot-checks, because green sensors are insufficient evidence against decay.

## 2. Where the harness sits today

**Fully mature humans-on-the-loop, with a *partial* flywheel.** The autonomy slider already gives 3 → 1 → 0 build-time gates (`build-lane.js`), AUTO_MERGE can remove the merge gate behind required CI checks (`auto-merge.js`), and machine gates are generator-independent. Three flywheel loops are already **closed** — past-run outcomes change future runs with no human:

1. **Ratchet baselines** — `cycle-gate.js`, `coupling-gate.js`, `gates-quality.js` coverage, `assert-readiness-ratchet.js`. Baselines in `.claude/state/*-baseline.*` may only move the right way; regressions auto-block, improvements auto-tighten.
2. **Flake history** — `flake-detector.js` → `specs/drift/flake-history.jsonl`; feeds drift-cadence reporting (non-blocking by design).
3. **Living context + within-run learning** — `graph-refresh.js` keeps `specs/brownfield/code-graph.json` fresh every turn; `failures.md` → `learned-rules.md`/`process-rules.md` extraction (SECTION 12) injects rules verbatim into all agent prompts within a run.

**Updated same day — a fourth loop is now closed.** §4.1/§4.2 shipped: `loop-health.js` condenses run state into a scorecard, and `/retro` reads it and drafts scored recommendations. As of Decision 1 (§9), `/retro` auto-invokes at `/auto`'s two session-terminal branches (Hard stop, Success) — no human has to remember to ask. This is still interactive-only (a human approves/defers/rejects every recommendation; nothing is applied automatically), so the harness has not crossed into the flywheel proper, but the *recommend* half of Morris's mechanic — *"the agent reviews the results and recommends improvements to the harness"* — now runs on its own, not just on demand.

**Where the flywheel still breaks — exactly at Morris's next stage boundary:**

- **No promotion path.** An approved recommendation still becomes a normal human-driven `/vibe`/`/change` task, not an agent-authored PR. `review-on-stop.js` remains advisory-only for the older learned-rules pathway. Rule/recommendation → standing policy is still 100% human action (§4.3, unbuilt).
- **Telemetry mostly still a dead end.** The `telemetry-ledger.jsonl`, Prometheus rules, and Grafana dashboards still terminate at human eyeballs for everything except the one path `loop-health.js` now condenses. No measurement feeds prompt content or model routing.
- **No scored auto-approval.** §4.5 is unbuilt and deliberately has no default threshold yet (Decision 3, §9).

## 3. Goals / non-goals

**Goals**
- Close the recommend → approve → apply loop for **harness self-improvement**, at graduated autonomy.
- Reuse existing state (ratchets, `failures.md`, telemetry ledger, flake history) as the flywheel's input signal — no new instrumentation until the inner loop spins.
- Keep every deterministic guardrail **outside** the loop the agent can touch.

**Non-goals**
- Auto-tuning of *product* code quality gates on scaffolded projects (that already works via ratchets).
- Production/operational-signal ingestion — deferred to a later horizon (§7 Phase C).
- Removing any human gate that protects security, data, or a loosened ratchet. Those stay human-gated permanently.

## 4. Components

Five components, in dependency order. Each is independently shippable and delivers value even if the later ones are never enabled.

### 4.1 Loop-health scorecard (signal condensation) — the enabler
A deterministic aggregator (`loop-health.js`, npm `loop-health`) that distills one run into `specs/retro/loop-health.json` from state already written. **As built** — grounded in what the real telemetry ledger actually contains (`kind: tool|turn|prompt|subagent_stop`, `exit`, `lane`), not the aspirational fields this section originally listed: tool-call counts and error rate, turn/prompt/subagent counts, lane-activity breakdown and skew detection, failures logged (by category, with a repeated-category note matching SECTION 12's ≥2 threshold), learned/process rule counts, flake-history count, and the four ratchet baselines. Evaluator phase-eval scores and cache-hit rate were in the original design sketch but the ledger doesn't carry them — not added, to avoid inventing a measurement that isn't real. This is the cybernetic "attenuation" half — a condensed dashboard, not raw ledger. **Not registered** in `harness-manifest.json` sensors (see §6) — matches the `agent-readiness.js`/`harness-coverage.js` precedent: a report-only aggregator that doesn't yet govern anything stays unregistered until something consumes it to close a loop. **Report-only, exit 0 always.**

### 4.2 `/retro` recommender — the flywheel's engine
A post-run stage where an agent reads the scorecard + `learned-rules.md` + `process-rules.md` + flake history and emits **scored recommendations** to `specs/retro/recommendations.jsonl`. **As built (Decision 1, §9):** auto-invoked at `/auto`'s two session-terminal stopping-criteria branches only (Hard stop, Success) — not at `/gate`, and not per-iteration. `/gate` was considered in the original draft of this section but deliberately dropped: it runs far more often than `/auto` (every pre-merge check, not once per build session), and the token-cost analysis behind Decision 1 was never done for that frequency. Also invokable standalone, on demand.

```json
{ "id", "target", "change", "risk": "low|med|high", "cost", "benefit",
  "confidence": 0.0-1.0, "class": "docs|sensor-tune|gate-tighten|rule-add|prompt-edit|gate-loosen|security",
  "evidence": ["file:line", "run-id", "..."], "status": "proposed|approved|deferred|rejected",
  "human_gate": true }
```

`human_gate: true` is **required** (enforced by `validate-recommendations.js`) whenever `class` is `gate-loosen` or `security` — the permanently-human-gated invariant (§4.5) baked into the artifact schema itself, not left to prose, even though §4.5's auto-approval machinery doesn't exist yet.

Targets: skill prompts, gate thresholds, `CLAUDE.md` rules, sensor configs, model-tier presets. This is verbatim Morris's *"agent reviews the results and recommends improvements to the harness."* **Stage 1 of graduated autonomy: purely interactive** — the human reviews and directs which to implement. Bounded (a cycle cap like self-heal's) so it escalates rather than spins.

### 4.3 Promotion-as-PR — closing the loop safely
When a recommendation is approved (or later auto-approved), the agent implements it as a **PR against the harness repo itself**, drafted between sessions. This resolves three constraints at once:
- **Prompt-cache prefix** — `CLAUDE.md`/`.mcp.json`/settings edits must land inter-session; `pre-write-gate` already enforces this. The PR flow *respects* it instead of fighting it (escape hatch `HARNESS_PREFIX_EDIT=1` only inside the promotion job).
- **Auditability** — every harness mutation is a reviewable diff with evidence.
- **Guardrails outside the loop** — the harness's own machine gates (`/gate`, manifest honesty validator, wiring-contract tests) now govern harness evolution. This *structurally* satisfies the Thoughtworks deterministic-guardrail requirement.

### 4.4 Harness eval suite — the confidence infrastructure
Auto-approval is unsafe without a way to detect that a prompt/policy change degraded the loop. Extend the existing `test/evals/run-evals.js` harness into a **golden-task suite**: a handful of canned stories run through the pipeline (or replayed against recorded transcripts in `test/evals/`), scored on gate outcomes and evaluator verdicts. A recommendation-PR must pass it before merge. (This was already flagged in the 2026-06 scaffold-maintenance research; it is now the load-bearing precondition for §4.5, not a nice-to-have.)

### 4.5 Asymmetric scored auto-approval — last, and deliberately lopsided
Thresholds live in `program.md` / `harness-manifest.json`. Recommendations above a confidence score **in low-risk classes only** (`docs`, `sensor-tune`, `gate-tighten`, `rule-add`) auto-approve via the promotion-PR + AUTO_MERGE path once the eval suite is green.

**Hard invariant, never threshold-crossable:** any recommendation whose class is `gate-loosen`, `security`, or that weakens a ratchet is **permanently human-gated**. The flywheel must not be able to disarm its own guardrails. Enforced deterministically (a non-AI check in the promotion job that rejects the PR class), mirroring `update-readiness-baseline.js`'s refusal to lower a baseline without `--force`. *Ratchet the ratchets.*

## 5. Safety model

- **Guardrails outside the loop** — §4.3/§4.5: harness self-edits pass through the same machine gates and a deterministic class-filter the agent cannot rewrite in the same run.
- **Asymmetric autonomy** — tightening is cheap; loosening is always human. Auto-approval is opt-in per class, gated on a green harness eval suite.
- **Conant–Ashby "go see"** — keep `/agent-readiness` and a standing human spot-check cadence. The design explicitly does **not** treat green sensors as sufficient evidence; the scorecard *informs* the human regulator, it does not replace them.
- **Bounded, escalate-don't-spin** — `/retro` inherits the self-heal discipline: a cycle cap, then it stops and reports.
- **Monotonic memory preserved** — `learned-rules.md`/`process-rules.md` remain append-only; `/retro` reads them, never prunes them.

## 6. Integration points (file inventory)

| Component | Status | Anchors |
|---|---|---|
| Scorecard | **Shipped.** `.claude/hooks/lib/loop-health.js` (pure helpers) + `.claude/scripts/loop-health.js` (CLI, `npm run loop-health`) + `test/loop-health.test.js`. **Not** registered in `harness-manifest.json` sensors — matches the `agent-readiness.js`/`harness-coverage.js` precedent: a report-only aggregator that doesn't yet govern anything stays unregistered until something consumes it to close a loop | reads `.claude/state/{failures.md,learned-rules.md,process-rules.md,telemetry-ledger.jsonl}`, `specs/drift/flake-history.jsonl`, ratchet baselines |
| `/retro` | **Shipped.** `.claude/skills/retro/SKILL.md` — no `.claude/commands/retro.md` needed or written; a skill's `name:` frontmatter is its own `/<name>` invocation surface. Registered in `scaffold-copy.js` `CORE_SKILLS`; writes `specs/retro/recommendations.jsonl` | consumes scorecard + learned/process rules + flake history |
| Auto-invoke wiring | **Shipped (Decision 1, §9).** `.claude/skills/auto/references/section-11-11-stopping-criteria.md` (Hard stop + Success branches), `--no-retro` escape hatch, registered as guide `retro-auto-invoke` in `harness-manifest.json`, locked by `test/retro-auto-wiring-contract.test.js` | — |
| `recommendations.jsonl` cap | **Shipped (Decision 1 prerequisite).** `archiveResolvedRecommendations()` in `.claude/scripts/archive-state.js` — caps resolved entries at 100, keeps every `proposed` entry forever; manual/on-demand like the rest of `archive-state.js`, not hook-triggered | `test/archive-state.test.js` |
| Scaffold scope | **Shipped (Decision 2, §9).** `loop-health.js`, `validate-recommendations.js`, `retro` added to `scaffold-copy.js` `CORE_SCRIPTS`/`CORE_SKILLS` | untested against a real scaffolded project — only dogfooded here |
| Promotion-PR | **Not built (§4.3, Phase B).** | would reuse `auto-merge.js`, `pre-write-gate`, `HARNESS_PREFIX_EDIT` |
| Eval suite | **Not built (§4.4, Phase B).** | would extend `test/evals/run-evals.js`, `test/evals/tasks.json` |
| Auto-approval | **Not built (§4.5, Phase C).** No default threshold — see Decision 3, §9 | would need `program.md` thresholds + a class-filter guard mirroring `update-readiness-baseline.js` |

Every new sensor/guide **must** be registered in `harness-manifest.json` and pass `validate-harness-manifest.js` (honesty invariant) — otherwise the control is orphaned. (`loop-health.js` is the deliberate exception, per the row above — it isn't a sensor yet because nothing consumes it to close a loop on its own; `/retro` reading it doesn't count, since `/retro`'s own output stays human-reviewed.)

## 7. Phased rollout

- **Phase A — shipped.** §4.1 scorecard + §4.2 `/retro`, auto-invoked at `/auto` session end (Decision 1, §9), scoped to both this repo and scaffolded projects (Decision 2, §9). Still fully interactive — the human approves everything; nothing is applied automatically.
- **Phase B:** §4.3 promotion-as-PR + §4.4 harness eval suite. Crosses from on-the-loop to flywheel — but still human-approved per PR.
- **Phase C (horizon):** §4.5 scored auto-approval for low-risk classes; later, richer signals (production telemetry from scaffolded apps feeding the recommendation backlog).

## 8. Risks

| Risk | Mitigation |
|---|---|
| Recommender proposes plausible-but-wrong harness edits | Promotion-PR through full machine gates + human review (Phase B); eval suite (§4.4) before any auto-merge |
| Flywheel loosens its own guardrails | Deterministic class-filter rejects `gate-loosen`/`security`/ratchet-weakening PRs (§4.5); not overridable by the agent |
| Prompt-cache prefix churn from self-edits | Inter-session promotion only; `pre-write-gate` enforced; `HARNESS_PREFIX_EDIT` scoped to the job |
| Human loses mental model (automation complacency) | Conant–Ashby spot-check cadence retained; scorecard informs, doesn't replace |
| Recommender oscillates | Bounded cycle cap, escalate-don't-spin (mirrors `/auto` backstops) |
| `recommendations.jsonl` grows unbounded under routine invocation (Decision 1) | `archiveResolvedRecommendations()` in `archive-state.js` caps resolved entries at 100; `proposed` entries always kept. Still manual/on-demand — not yet hook-triggered, so growth is bounded only once someone runs it |
| `/retro`'s fork spend evades `budget-state.js`'s caps | Very likely already covered via the same `SubagentStop` receipt mechanism `evaluate` uses (Decision 1) — not empirically confirmed; verify against a live post-run budget reading before relying on it |

## 9. Decisions (resolved 2026-07-13, same day as the original draft)

### Decision 1 — `/retro` auto-invokes at `/auto`'s two session-terminal branches

Wired into `.claude/skills/auto/references/section-11-11-stopping-criteria.md`: **Hard stop** (item 1) and **Success** (item 4) both invoke `/retro` once, after reporting/README-generation and before hand-off/exit. The per-story **Escalate** branch (item 2, continues the session) and the coverage-revert branch (item 3, also continues) do **not** invoke it — neither is session-terminal. A `--once` intermediate link (SECTION 10.1) never reaches SECTION 11 at all, so a chained build fires `/retro` exactly once, at whichever link actually completes or hard-stops — never per-wave. Suppressible with `--no-retro`, for an outer caller (e.g. a `Workflow` script driving `/auto` as a sub-step) that wants to invoke `/retro` itself at its own boundary instead.

**Prerequisite shipped first, not skipped.** `specs/retro/recommendations.jsonl` had no size cap, and `/retro`'s own dedup step re-reads the whole file every run. At the measured ~1.2KB/entry, unmoderated growth under routine invocation would have reproduced the exact unbounded-ledger bug just fixed in `record-run.js`/`telemetry-ledger-rotate.js` (REC-002/003 earlier the same session) — in a brand-new file. Fixed via `archiveResolvedRecommendations()` in `.claude/scripts/archive-state.js`: caps *resolved* (approved/deferred/rejected) entries at 100, oldest archived first to `.claude/state/archive/`; every `proposed` entry is kept forever regardless of age, since it's a pending human decision, not settled memory. Like every other file `archive-state.js` caps, this is manual/on-demand, not hook-triggered — routine invocation raises the growth rate but doesn't by itself run the archival; someone (or a future automation) still has to run `archive-state.js`.

**Also shipped:** `/retro`'s Step 5 now skips the interactive-review prompt entirely when zero new recommendations were drafted. A quiet `/auto` run stays quiet — frequent use doesn't train the human to dismiss the prompt reflexively.

**Correction to the earlier cost analysis:** that analysis assumed `/retro`'s token spend would be invisible to `budget-state.js`'s wall-clock/agent-count/cost caps. On inspection this was wrong, or at least too pessimistic: `record-run.js`'s `SubagentStop` handler writes a receipt for every `context: fork` invocation to `.claude/runs/*.jsonl`, which `budget-state.js` already reads — the same mechanism that tracks `evaluate` (also `context: fork`). `/retro`'s spend very likely already flows into the existing budget accounting with no extra wiring. Not empirically confirmed against a live post-run `budget-state.js` reading — treat as "very likely fine" and verify on the first real auto-invoked run, not as fully proven.

**Deliberately not done:** `/gate` was named as a second possible auto-invoke site in the original §4.2 draft. Dropped — `/gate` runs far more often than `/auto` (every pre-merge check, not once per build session), and the cost analysis behind this decision was never done for that frequency. Extending to `/gate` needs its own analysis, not an assumption that this decision transfers.

### Decision 2 — scorecard/`/retro` scope: both this repo and scaffolded target projects

`loop-health.js` takes `--root DIR` (mirroring `agent-readiness.js`), and `loop-health.js`, `validate-recommendations.js`, and the `retro` skill are now in `scaffold-copy.js`'s `CORE_SCRIPTS`/`CORE_SKILLS` — every scaffolded project ships its own independent `/retro`, run against its own local state. This had already happened by accident (copying `agent-readiness.js`'s convention without a deliberate scope decision); it's now the deliberate one.

**Real implication this creates, not yet resolved:** §4.3's promotion-as-PR design (unbuilt) only makes sense for *this* meta-repo — "a PR against the harness repo itself." A scaffolded project's `/retro` recommending a change to its own local `CLAUDE.md`/skills has no promotion path designed. Phase B, when built, needs a second branch for the scaffolded-project case — or an explicit decision to scope promotion to the meta-repo only, leaving scaffolded-project recommendations permanently interactive-only. This is now a named, tracked gap for Phase B rather than a silent one.

**Untested:** `loop-health.js`'s assumptions (state file paths, ratchet baseline locations) are standard scaffolded conventions and should generalize, but this has only been dogfooded against this repo — never run against an actual scaffolded target project.

### Decision 3 — no default confidence threshold for Phase C; explicit revisit trigger instead

Phase C (§4.5 scored auto-approval) remains unbuilt and ungated by any number. Inventing a threshold now, with no real history, would anchor an unvalidated figure that could get carried forward uncritically once Phase C is eventually implemented — worse than leaving it unset. **Decision: revisit calibration once `specs/retro/recommendations.jsonl` has ≥30 resolved (approved/rejected/deferred) entries.** That's a modest but real sample, and not new instrumentation — once a decision is recorded via `--apply-decisions`, the file's own `status` field *is* the labeled dataset (confidence vs. actual human verdict) Phase C calibration needs. Decision 1's auto-invoke wiring is what makes that count climb at a meaningful rate instead of stalling indefinitely on manual invocation.
