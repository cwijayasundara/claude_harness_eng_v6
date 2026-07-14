# Agentic Flywheel — Design Narrative

**Status:** Phase A + Phase B implemented and live (scorecard, `/retro`, and `/promote` promotion-as-PR) · Phase C deliberately deferred, blocked on Decision 3's own precondition · **Lane:** `/design --doc-only` (disposable architecture narrative; no planner/generator/evaluator, no `specs/design/` schema set)
**Author:** Harness maintainer · **Date:** 2026-07-13, updated 2026-07-14 (Phase B shipped, §9 Decision 4)

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

**Updated 2026-07-14 — the promotion loop is now closed too, still human-approved twice over.** §4.3/§4.4 shipped: `/promote` takes an *already-approved* recommendation and implements it as a real PR against this repo, gated on the full test suite passing. Two human approvals remain in the loop — approving the recommendation (`/retro`), and merging the PR (normal GitHub review) — but the *implementation and PR-authoring* step in between now runs on its own. `/promote` is on-demand only, never auto-invoked.

**Where the flywheel still breaks — exactly at Morris's next stage boundary:**

- **Telemetry mostly still a dead end.** The `telemetry-ledger.jsonl`, Prometheus rules, and Grafana dashboards still terminate at human eyeballs for everything except the one path `loop-health.js` now condenses. No measurement feeds prompt content or model routing.
- **No scored auto-approval.** §4.5 is unbuilt and deliberately has no default threshold yet (Decision 3, §9) — and, per Decision 4 (2026-07-14), deliberately not attempted at all right now: its own precondition (≥30 resolved recommendations) is nowhere close to met (4 exist as of this writing).

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
**As built (Decision 4, §9):** `/promote <recommendation-id>` — on-demand only, never auto-invoked — takes a human-*approved* recommendation and implements it as a **PR against this repo**. Merge is never automated, in any phase; a human reviews and merges through the normal GitHub flow, unchanged.

Deviates from the original sketch in one deliberate way: **prefix-cache-protected targets (`CLAUDE.md`/`.mcp.json`/`settings*.json`) are refused outright, not deferred to an inter-session `HARNESS_PREFIX_EDIT` bypass.** Building that bypass safely (when is "between sessions" actually true from inside a running skill?) was judged more machinery than a first version needs — a human handles those manually. Everything else (`/vibe`/`/change`, `npm test`, `git`, `gh pr create`) runs within the current session; there's no inter-session handoff for non-protected targets. This resolves:
- **Auditability** — every harness mutation is a reviewable diff with evidence (the recommendation's `target`/`change`/`evidence`/`class`/`risk`/`cost`/`benefit` go straight into the PR body).
- **Guardrails outside the loop** — a deterministic script (`promote-recommendation.js`, not the skill's own prose) refuses `gate-loosen`/`security`-class recommendations, an already-`promoted` one, or anything not `status: approved`, before any implementation work starts. **Honesty about its limits:** this check is a real code gate the skill is instructed to obey unconditionally — but nothing at the filesystem/permission level stops the skill from hand-editing `recommendations.jsonl`'s `status`/`class` to force a false pass. The boundary is currently instructional, backed by `validate-recommendations.js` schema validation (which validates *shape*, not *honesty* of a hand-forged status) — not a permission-level lock. Same caveat class as `human_gate: true`'s "belt and suspenders, not yet enforced against a determined bypass" framing.
- **No PR over a red build** — the harness's own "no PR is ever opened over a red build regardless of model" invariant, applied to itself.

### 4.4 Harness eval suite — the confidence infrastructure, deliberately scoped down
**As built (Decision 4, §9), narrower than the original sketch:** the promotion-PR gate is the **existing full `npm test` suite** (1850+ tests, including every per-gate wiring-contract test and the `harness-manifest.json` honesty invariant) — not a new golden-task framework. The original sketch proposed extending `test/evals/run-evals.js`, but that framework does live-model API calls to test *general coding-agent behavior* (surgical fixes, honest failure reporting) and is meant for "before releases / model bumps" — it's the wrong tool for "did this harness change break the harness," which the deterministic suite already answers far more comprehensively and without API cost. Reusing what's already load-bearing beat building a parallel, weaker mechanism. A future, purpose-built harness-self-modification eval (verifying an *intended* improvement actually manifests, not just "nothing broke") remains a real, unbuilt idea — not attempted here.

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
| Promotion-PR | **Shipped (Decision 4, §9).** `.claude/skills/promote/SKILL.md` (on-demand, never auto-invoked), `.claude/scripts/promote-recommendation.js` (deterministic eligibility guardrail — pure `checkPromotionEligible()` + CLI, `test/promote-recommendation.test.js`). Registered as guide `promote-eligibility-gate` in `harness-manifest.json`. Refuses prefix-cache-protected targets outright (no `HARNESS_PREFIX_EDIT` bypass built); `auto-merge.js` intentionally **not** reused — `/promote` never merges, in any phase | `scaffold-copy.js` `CORE_SCRIPTS`/`CORE_SKILLS` — shipped broadly like `/retro`, untested against a real scaffolded project (same caveat as Decision 2) |
| Eval suite | **Shipped, scoped down (Decision 4, §9).** The promotion-PR gate is the existing full `npm test` suite + `validate-harness-manifest.js` — not a new golden-task framework. `test/evals/run-evals.js` untouched | — |
| Auto-approval | **Not built, deliberately not attempted (§4.5, Phase C, Decision 4, §9).** Precondition unmet: 4 resolved recommendations exist, Decision 3 requires ≥30 | would need `program.md` thresholds + a class-filter guard mirroring `update-readiness-baseline.js` |

Every new sensor/guide **must** be registered in `harness-manifest.json` and pass `validate-harness-manifest.js` (honesty invariant) — otherwise the control is orphaned. (`loop-health.js` is the deliberate exception, per the row above — it isn't a sensor yet because nothing consumes it to close a loop on its own; `/retro` reading it doesn't count, since `/retro`'s own output stays human-reviewed.)

## 7. Phased rollout

- **Phase A — shipped.** §4.1 scorecard + §4.2 `/retro`, auto-invoked at `/auto` session end (Decision 1, §9), scoped to both this repo and scaffolded projects (Decision 2, §9). Still fully interactive — the human approves everything; nothing is applied automatically.
- **Phase B — shipped (Decision 4, §9).** §4.3 `/promote` + §4.4 eval-gate (the existing full test suite). Crosses from on-the-loop to flywheel — but still human-approved *twice*: once approving the recommendation, once merging the PR. `/promote` is on-demand only.
- **Phase C — deliberately not attempted (Decision 4, §9).** §4.5 scored auto-approval remains unbuilt; its own precondition (Decision 3: ≥30 resolved recommendations) is nowhere close to met. Richer signals (production telemetry from scaffolded apps) remain a further-out horizon on top of that.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Recommender proposes plausible-but-wrong harness edits | `/promote` gates on the full `npm test` suite before opening a PR (§4.4), plus normal human PR review before merge (Phase B, shipped) |
| Flywheel loosens its own guardrails | `checkPromotionEligible()` is an **allowlist** (only `docs`/`sensor-tune`/`gate-tighten`/`rule-add`/`prompt-edit` are eligible — fixed from an original denylist that fail-opened on a missing/mis-cased/unrecognized class, code-review CR-003). **Still an instructional boundary, not a permission-level lock** (Decision 5): nothing stops `/promote` from hand-editing `recommendations.jsonl` to force a false pass. Honest, tracked gap — bounded by the human PR-merge gate, which is real and external |
| Recommendation `id` used unsafely in shell commands (branch name, commit message, PR body) | **Fixed 2026-07-14 (Decision 5):** `id` format (`REC-YYYYMMDD-NNN`) validated at drafting time (`validate-recommendations.js`) and again at promotion time (`promote-recommendation.js`) — a real choke point before it ever reaches `git checkout -b retro/<id>`. Free-text fields (`target`/`change`/`evidence`) now go through temp files (`git commit -F`, `gh pr create --body-file`), never inline `-m`/`--body` interpolation |
| `git add -A` sweeps untracked files into a commit pushed to the real remote | **Fixed 2026-07-14 (Decision 5):** `git add -u` + explicit paths only; a concrete instance was found during review (`.claude/state/graph-refresh.lock`, untracked and not gitignored) and closed directly |
| Prompt-cache prefix churn from self-edits | **Revised from the original design:** `/promote` refuses `CLAUDE.md`/`.mcp.json`/`settings*.json` targets outright rather than using an inter-session `HARNESS_PREFIX_EDIT` bypass — simpler and safer than the originally-sketched mechanism, at the cost of those recommendations staying fully manual |
| Human loses mental model (automation complacency) | Conant–Ashby spot-check cadence retained; scorecard informs, doesn't replace. `/promote` adds its own checkpoint: the human sees the diff and drafted PR body and must explicitly confirm before `gh pr create` runs (Decision 5) |
| Recommender oscillates | Bounded cycle cap, escalate-don't-spin (mirrors `/auto` backstops) |
| `recommendations.jsonl` grows unbounded under routine invocation (Decision 1) | `archiveResolvedRecommendations()` in `archive-state.js` caps resolved entries at 100; `proposed` entries always kept. Still manual/on-demand — not yet hook-triggered, so growth is bounded only once someone runs it |
| `/retro`'s fork spend evades `budget-state.js`'s caps | **Resolved 2026-07-14**, and it was a bigger bug than expected: `record-run.js`/`concurrency-gate.js` checked `tool_name === 'Task'`, but the real value is `"Agent"` — meaning cost/agent-count tracking had never fired for *any* subagent, ever, not just `/retro`'s. Fixed, empirically verified live (first-ever `kind:'subagent'` record; `budget-state.js` went from permanently 0 agents to a real reading) |
| A `/promote` run opens a PR but crashes/is interrupted before recording the promotion on `main` (the original ordering bug, Decision 5 BLOCK) | **Fixed:** bookkeeping now commits directly to `main` as its own synchronous step (Step 9) right after the PR exists, not deferred or left on the feature branch. Residual risk: if *that specific* push fails, the skill is instructed to stop and report exactly what's uncommitted rather than leave it silently undone — not yet tested against a real failure case |
| A stuck `/promote` run could leave `retro/<id>` branches accumulating on the remote | No automated cleanup built; a human deletes abandoned branches manually, same as any other stale PR branch |
| Eligibility guard has no permission-level backstop (Decision 5, tracked, not fixed) | `specs/retro/recommendations.jsonl` isn't in `prefix-cache.js`'s protected set; a hand-edit to `class`/`status` isn't resisted by any hook, and `human_gate: true` provides no independent defense (the check never reads it). Bounded by the human PR-merge gate today. Follow-up: extend `pre-write-gate.js` to protect these fields the same way `prefix-cache.js` protects `CLAUDE.md` |

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

### Decision 4 — Phase B shipped; Phase C explicitly skipped, not just deferred (2026-07-14)

Three scoping calls made before any Phase B code was written, each with a stated rationale rather than assumed:

1. **Phase C: skip entirely for now**, rather than build the machinery hard-disabled or pick a threshold anyway. Decision 3's own precondition (≥30 resolved recommendations) is nowhere close to met — 4 exist as of this writing. Building auto-approval's mechanics now would be premature relative to a safety decision made the same session, not a different day's forgotten constraint.
2. **`/promote`'s PR autonomy: the agent opens a real PR (branch, push, `gh pr create`); merge always stays human.** Matches the design's original "Phase B: still human-approved per PR" framing exactly — no expansion, no contraction.
3. **Promotion scope, and a correction mid-implementation:** the initial call was "this meta-repo only," reasoning from Decision 2's flagged gap that a scaffolded project's promotion target is undesigned. Once built, `/promote` turned out to be project-relative in practice — nothing in `promote-recommendation.js` or the skill hardcodes this repo; `git`/`gh`/`npm test` all operate on whatever `cwd` it runs in. Registered it broadly in `scaffold-copy.js` (matching `/retro`'s precedent) rather than fighting that, with the same "shipped but untested against a real scaffolded project" caveat Decision 2 already carries for `/retro`. The *meta-repo-only* framing described this session's verification scope, not an architectural restriction — worth naming explicitly since the two could easily be conflated later.

Also, mid-build: the original §4.3 sketch assumed prefix-cache-protected recommendations would use the documented `HARNESS_PREFIX_EDIT=1` inter-session escape hatch. Building that safely — reliably knowing "this is a genuinely separate session" from inside a running skill — turned out to be real, unscoped machinery of its own. Simplified to an outright refusal instead: `/promote` never touches `CLAUDE.md`/`.mcp.json`/`settings*.json`, full stop, human handles those manually. Cheaper and safer than the original plan; the cost is that class of recommendation never gets automated promotion in this version.

### Decision 5 — independent review before first commit, real findings fixed (2026-07-14)

Given `/promote` is genuinely novel, higher-risk capability (autonomous `git push` + `gh pr create` against the real authenticated remote, not a sandbox), it got an independent `code-reviewer` + `security-reviewer` pass before any commit — the same discipline used for the earlier telemetry/tool-name fixes, applied here with explicit instructions to look harder given the reach. Verdict: 1 BLOCK, 7 WARN (3 overlapping between the two reviews), 5 INFO. All BLOCK and WARN findings were fixed before commit; none were argued away.

**Fixed:**
- **The BLOCK** — Step 7's original ordering committed `status: "promoted"` nowhere durable: it happened after the branch was already pushed and the PR opened, so the bookkeeping lived only on the feature branch, `main` never reflected the promotion, and once that branch was deleted at merge time a second `/promote` run against the same (now-merged) recommendation would pass eligibility again and open a duplicate PR. Fixed: the bookkeeping commit now happens on `main` directly, synchronously, as the skill's second-to-last step (current Step 9) — after the PR exists (so `pr_url` is known) but as its own direct-to-main commit, matching how this repo already handles bookkeeping-only changes.
- **Fail-open eligibility class check** — `checkPromotionEligible()` was a denylist (refuse only `gate-loosen`/`security`); a missing, mis-cased, or future-added class silently passed. Flipped to an allowlist (`docs`/`sensor-tune`/`gate-tighten`/`rule-add`/`prompt-edit` only) — refuse unless explicitly recognized, not the reverse.
- **False scope claim** — the skill's own header claimed `/promote` was *not* registered for scaffolding, while the same diff's `scaffold-copy.js` change registered it. Both reviewers caught this independently. Corrected to match reality (Decision 4 item 3).
- **Branch-name / shell-construction risk** — a recommendation `id` was interpolated straight into `git checkout -b retro/<id>` with no format constraint (a shell-injection vector before git's own ref-name validation would even run), and the skill's original template nudged toward inline `-m "..."`/`--body "..."` with the recommendation's free-text fields. Fixed at the root: `validate-recommendations.js` now rejects any id not matching `REC-YYYYMMDD-NNN` at drafting time (so a malformed id never reaches the tracked file), `promote-recommendation.js` checks the same format again at promotion time (defense in depth), and the skill now mandates writing the commit message and PR body to temp files (`git commit -F`, `gh pr create --body-file`) rather than inline interpolation.
- **`git add -A` over-staging** — could sweep any untracked file sitting in the working tree (the security review found a concrete instance: `.claude/state/graph-refresh.lock` existed, untracked, and wasn't gitignored) into a commit pushed to the real remote. Fixed: `git add -u` plus explicit paths for genuinely new files, with an instruction to review the staged set before committing; also closed the gitignore gap directly (`.claude/state/*.lock`).
- **No confirmation before the PR goes public** — added an explicit checkpoint: show the human the diff and drafted PR title/body and wait for their go-ahead before `gh pr create` runs. The pushed branch is already visible on the remote by that point, but the PR itself — the point of no easy retraction — isn't, until this checkpoint clears.
- **Undefined failure handling** — Steps 1/3/5 already had explicit stop-and-report contracts; Step 6 (push, `gh pr create` — the highest-consequence step) didn't. Added explicit stop-and-report guidance for a failed push and a failed `gh pr create`, and clarified the commit step so it doesn't double-commit when `/vibe`/`/change` already committed the change itself.

**Deliberately not fixed, tracked instead — the eligibility guard remains an instructional boundary, not a permission-level lock.** Both reviews independently confirmed: nothing at the filesystem/permission level stops `/promote` from hand-editing `recommendations.jsonl`'s `class`/`status` fields to force a false eligibility pass — `specs/retro/recommendations.jsonl` isn't in `prefix-cache.js`'s protected set the way `CLAUDE.md`/`settings*.json` are, so no hook resists the edit. `human_gate: true` provides no independent defense here — `checkPromotionEligible()` never reads it, and a bypass would relabel *away* from the gated classes in the first place. The code-reviewer's suggested mitigation — extend the pre-write-gate hook to make `recommendations.jsonl`'s `class` field (and any status downgrade on a gated-class row) immutable-in-place, the same technique `prefix-cache.js` already uses for `CLAUDE.md` — is real, precedented, reuses existing machinery, and was judged out of scope for this pass on effort grounds (JSONL-diff-aware hook logic, not a one-line change). What bounds the residual risk today: this is not an unattended capability (`/promote` only runs when a human explicitly types it against a specific, already-approved recommendation) and merge is never automated, so a forged eligibility pass produces at worst an unauthorized, misleadingly-described PR on the real repo — visible, attributable, and blocked from landing by the same human review every other PR gets. **Follow-up, not yet built:** extend `pre-write-gate.js` to protect `recommendations.jsonl`'s gated fields the way `prefix-cache.js` protects `CLAUDE.md`.
