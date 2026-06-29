# Harness Engineering Gap Analysis — Thoughtworks/Fowler + SPDD vs `claude_harness_eng_v5`

**Date:** 2026-06-28
**Sources analysed:**
- Fowler/Thoughtworks — *Harness Engineering for Coding Agents* (the control-system framing: guides + sensors + steering loop)
- Fowler/Thoughtworks — *Maintainability Sensors for Coding Agents* (the feedback half, with concrete tools: ESLint w/ custom messages, dependency-cruiser, coupling CLI, Stryker mutation testing, Khononov modularity skill, GitLeaks/Semgrep)
- Fowler — *Structured Prompt-Driven Development (SPDD)* + `open-spdd` + the `token-billing` worked example (REASONS Canvas, prompt-as-artifact, bidirectional sync)
- Anthropic — *Effective harnesses for long-running agents* + the *autonomous-coding* quickstart + multi-context-window prompting guidance (the coding-agent failure-mode table; added 2026-06-28 for the **§7 G13–G14 addendum** — a different source axis from Fowler/SPDD)

**Verdict in one line:** This scaffold is **already ~70% of the harness the articles describe** — and is *ahead* of them on the behaviour harness (GAN evaluator + three-layer runtime verification) and on brownfield discipline. The gaps are real but mostly **organisational** (no explicit guides-vs-sensors model), **continuous** (sensors fire per-change, not on a drift cadence), and **front-of-pipeline** (no SPDD-style versioned, code-synced design prompt). None of the three frameworks conflict; they compose.

---

## 1. How the three frameworks relate (and whether they conflict)

They are **orthogonal layers of the same stack**, not competitors:

| Layer | Article | What it governs | Our equivalent |
|---|---|---|---|
| **Control system** | Harness Engineering | The whole loop: *guides* (feedforward) + *sensors* (feedback) + a human *steering loop* | `program.md`, hooks, gates, GAN loop, `learned-rules.md` |
| **Feedback half** | Sensors for Coding Agents | The concrete sensor catalogue and how to wire signals back as self-correction | `verify-on-save.js`, `lib/layers.js`, `code-map`, `mutation-smoke.js`, reviewer agents, `evaluate` |
| **Front of pipeline** | SPDD | Turning a PRD into a *governable, versioned, code-synced* design artifact before generation | `brd` → `spec` → `design` (but **not** versioned/synced) |

**SPDD does not conflict with harness engineering — it slots into it.** In harness vocabulary, SPDD's REASONS Canvas *is a feedforward guide*, and SPDD's `/spdd-code-review` *is an inferential sensor*. SPDD is opinionated about the **artifact at the front**; harness engineering is opinionated about the **control loop around it**. We can adopt SPDD's artifact discipline without touching our GAN/ratchet machinery.

---

## 2. What we already do well (credit, mapped to the articles)

Verified by direct inspection of the harness, not assumed:

1. **Sensors are wired into the agent's inner loop.** `verify-on-save.js` (PostToolUse on Write/Edit/MultiEdit) runs `ruff`+`mypy` / `eslint` **plus a layered-import check** on the saved file and **blocks** with a fix instruction. This is exactly the article's "fast computational sensors during the coding session" column.
2. **Architecture-fitness sensor exists.** `.claude/hooks/lib/layers.js` enforces one-way layered imports (`types→config→repository→service→api→ui`), configurable per project via `project-manifest.json#architecture`. This is a (partial) `dependency-cruiser`/ArchUnit equivalent — and it runs on *every write*, not just CI.
3. **Computational coupling + dead-code sensor exists.** `code-map` builds `code-graph.json` and `coupling-report.md` (fan-in/out, cycles, unstable hubs, dead-code candidates) — the article's "coupling CLI" and "dead-code detection," AST-based.
4. **Mutation testing exists (deliberately lightweight).** `mutation-smoke.js` is a single-mutant smoke gate over high-signal operators (JS/TS + Python), chosen over Stryker/mutmut because full mutation runs are "too slow for agent loops" (`docs/behavior-preservation.md`). The "does the suite bite?" guarantee the Stryker section argues for is present in miniature.
5. **The behaviour harness — the article's weakest everywhere — is our strongest.** The GAN generator↔evaluator separation + `evaluate`'s **three-layer runtime verification (API · Playwright · schema)** + security gate + **performance ratchet** is materially ahead of "put faith in AI-generated tests." We verify against a *running app*, not just self-graded tests.
6. **Inferential review sensors** are plural and role-split: `clean-code-reviewer`, `diff-reviewer` (fresh-context correctness), `security-reviewer`, `design-critic` (vision scoring).
7. **Brownfield is a first-class lane**, not an afterthought: `brownfield`, `seam-finder`, `code-map`, plus the legacy-code skill set (`checking-coverage-before-change`, `pinning-down-behavior`, `sprouting-instead-of-editing`, `keeping-refactors-pure`, `checking-migration-safety`, `upgrading-dependencies`). This is the "harness is hardest where most needed" problem, directly addressed.
8. **Shift-left layering is real:** PreToolUse gate → inner-loop verify-on-save → commit `gate` → integration `evaluate`. Cost/speed-tiered exactly as the article's "keep quality left" prescribes.
9. **Steering loop exists:** `program.md` (Karpathy human↔agent bridge), `learned-rules.md`, and the `review-on-stop` hook that *suggests* CLAUDE.md updates between sessions.

---

## 3. Gap analysis (prioritised)

Legend: **P0** = closes an enterprise-readiness hole; **P1** = high-leverage; **P2** = polish/maturity.

| # | Gap | Article basis | Status today | Priority |
|---|---|---|---|---|
| G1 | **No explicit "guides vs sensors" harness model / sensor registry.** Pieces exist but aren't organised or discoverable as a control system; no way to answer "what governs maintainability vs architecture vs behaviour?" | Harness Eng. (the central matrix: {Maintainability, Architecture, Behaviour} × {Guides, Sensors}) | Implicit only | **P0** |
| G2 | **No continuous/drift sensors outside the change lifecycle.** All sensors fire per-change. Nothing runs coupling-drift, dead-code accumulation, dependency freshness, or SLO degradation on a *cadence*. | Both articles' "Repeatedly — slower cadence" column | ✅ **DONE** — `drift-report.js` diffs cycles/hubs (architecture), orphans (dead-code), and npm/pip CVEs against a committed snapshot; flags only *new* regressions; exit 1 for cron/CI/`/schedule`. Design-vs-code (G4) and SLO (G9) drift still pending. | ~~P0~~ |
| G3 | **No computational security sensors.** Security is inferential-only (`security-reviewer` + checklists). No Semgrep/Bandit (SAST), GitLeaks/trufflehog (secrets), `npm audit`/`pip-audit` (deps). | Sensors article (Semgrep, GitLeaks named explicitly) | ✅ **DONE** — baseline secrets at pre-write+commit; gitleaks/semgrep/npm+pip-audit via `security-scan.js`, boundary-gated in `/gate`, graceful degradation | ~~P0~~ |
| G4 | **No structured-prompt artifact, and no prompt↔code sync.** We emit BRD/spec/design once; they can silently drift from code. No REASONS Canvas, no `/prompt-update` (requirements→prompt→code) or `/sync` (code→prompt). | SPDD core | ✅ **DONE (v1)** — `/design` emits `reasons-canvas.md` (REASONS + machine-read `Governs`); `validate-canvas.js` structure gate; Canvas↔code drift wired into the G2 monitor; "fix-prompt-first" discipline documented. Full regeneration commands deferred by choice. | ~~P1~~ |
| G5 | **Linter/sensor messages are generic, not LLM-optimised.** `verify-on-save` blocks with "Fix: resolve the lint errors above" — not the article's per-rule self-correction guidance ("positive prompt injection"), and no "raise-threshold-with-justification" escape valve. | Sensors article (custom ESLint formatter is the headline technique) | ✅ **DONE** — `lib/sensor-guidance.enrich()` appends a per-rule fix line for each flagged ruff/eslint/mypy rule to the `verify-on-save` lint/type blocks, including the threshold-bump-with-justification valve. | ~~P1~~ |
| G6 | **No inferential modularity review.** We have the computational `coupling-report.md` but no LLM modularity skill *on top* of it (semantic duplication, misplaced responsibility, argument-clump detection) grounded in that CLI output. | Sensors article (Khononov "Modularity Skills") | ✅ **DONE** — `modularity-pack.js` builds grounding evidence from the code-graph (pre-classifying legitimate hubs to avoid the article's factory/schema false-positives); the `modularity-reviewer` agent judges it against source in `/brownfield --full`. | ~~P1~~ |
| G7 | **Mutation testing exists but is not a ratchet gate.** `mutation-smoke.js` runs only inside `pinning-down-behavior` / the brownfield CR lane. A group can pass **all 8 `/auto` gates** with tests that execute every line yet assert nothing on any boundary — the article's exact "false sense of security in test effectiveness." | Sensors article (Stryker section is the headline test-effectiveness argument) | ✅ **DONE** — `mutation-gate.js` diff-scopes mutation-smoke to a group's changed files; pre-commit enforces it during `/auto` (block on survivors below threshold, naming the exact flip). Folded into Gate 3 (test adequacy). | ~~P1~~ |
| G8 | **Architecture-fitness is horizontal only.** `lib/layers.js` enforces one-way *layer* ordering (Repository→Service→API…) but there is **no vertical bounded-context rule** — `src/billing/` may freely import `src/user/`. Cycles are *reported* (`coupling-report.md`) but not *enforced*. No ArchUnit/dependency-cruiser/Deptrac equivalent for module boundaries. | Harness Eng. (Architecture Fitness Harness) + Sensors (dependency-cruiser) | ✅ **DONE** — `lib/contexts.js` enforces bounded-context boundaries (opt-in via `architecture.contexts`) on every write + pre-commit, and `cycle-gate.js` adds a monotonic import-cycle ratchet (`/auto` Gate 4, `/gate`, `npm run cycles`). | ~~P2~~ |
| G9 | **Generated apps get no observability baseline.** The harness instruments *itself* (telemetry/Grafana) but does not scaffold OTEL traces / structured-log conventions / a `/metrics` endpoint into the *product*, so the article's runtime sensors (SLO/error-rate/log-anomaly) have nothing to read. This is a gap on **both** the guide axis (observability conventions) and the continuous-sensor axis. | Harness Eng. (observability conventions as feedforward; SLO/log-anomaly as continuous sensors) | ✅ **DONE** (guide-half + sensor-half: `slo-check.js` scrapes /metrics, FAILs on 5xx error-rate over SLO in /evaluate) | ~~P2~~ |
| G10 | **No harness templates per topology.** `/scaffold` detects stack but doesn't ship per-topology *bundles* of guides+sensors ("CRUD-on-JVM", "event-processor-in-Go"). | Harness Eng. (Ashby's Law / variety reduction) | ✅ **DONE** — `topologies.js` registry resolves web-app / api-service / cli-or-library and presets the manifest-knob bundle in `buildManifest` (behavior-preserving refactor of the implicit lite/projectType branching; drop-in extensible). | **P2** |
| G11 | **No harness-coverage metric.** The articles' open question: "how do we know our sensors are adequate?" We have no report of which code is/isn't under which sensor. | Harness Eng. (open question) | ✅ **DONE** — `harness-coverage.js` maps source files against the sensors' validated `scope` field and reports per-axis coverage % + ungoverned holes (`npm run harness-coverage`); report-only. | **P2** |
| G12 | **Behaviour-harness extras absent:** approved-fixtures pattern, default-on accessibility (axe/WCAG only fires when the contract opts in), flake detection, and **API contract-drift** across builds (`oasdiff` is *referenced* in `keeping-refactors-pure` but never wired as a gate). | Sensors article + our own `TESTING_AGENT_PROPOSAL.md` | 🟡 **PARTIAL** — ✅ API contract-drift (`oasdiff` breaking gate, `contract-drift-gate.js`, wired in `/gate` + `npm run contract-drift`) + ✅ default-on axe/WCAG accessibility (`contract-accessibility-default.js`, injected in `/auto` Step 3.5, sensor active). Remaining: approved-fixtures, flake detection (separate slices; flake deferred per `TESTING_AGENT_PROPOSAL.md`). | **P2** |
| G13 | **No distinct first-context-window prompt.** `/auto` ran identical recovery logic on window 1 and window N; the initializer/continuation split lived only *across commands* (`/scaffold`→`/auto`), not inside the loop. | Anthropic — *Effective harnesses* + multi-context-window prompting ("a different prompt for the very first context window") | ✅ **DONE** — SECTION 2 first-window vs continuation split (`first-window-init` guide): verifies initializer artifacts (populated `features.json`, executable `init.sh`, `specs/` prerequisites) before the first wave. See §7. | P1 |
| G14 | **No session-start smoke test.** Health-checking was deferred to the post-implementation evaluator; a fresh-process resume could build on a crash-broken tree with no startup sanity check. | Anthropic — autonomous-coding quickstart ("run a basic test on the dev server to catch undocumented bugs" at session start) | ✅ **DONE** — SECTION 2 `resume-smoke` sensor boots the app + evaluator Health-Check Retry on a fresh-process resume, before selecting work; failure routes to self-healing as `failure_layer: infrastructure`. See §7. | P1 |

---

## 4. Deep dives on the high-value gaps

### G1 — Make the harness a *legible* control system (the cheapest highest-leverage fix)

The articles' core contribution is a **mental model**: every quality concern is governed by a *guide* (prevent) and/or a *sensor* (detect), across three axes — maintainability, architecture fitness, behaviour. We have most of the pieces but they're scattered across hooks, skills, and agents. Nobody (human or agent) can currently answer "what's my behaviour harness?"

**Recommendation:** Ship a committed `HARNESS.md` (and a machine-readable `harness-manifest.json`) that is the **registry** of guides and sensors, organised by the article's matrix:

```
                    GUIDES (feedforward)                 SENSORS (feedback)
Maintainability     code-gen skill, layers config        eslint/ruff, clean-code-reviewer,
                                                          coupling-report, mutation-smoke
Architecture        architecture.md, layer_roots         layers.js, code-graph cycles,
                                                          (NEW: dep rules, fitness tests)
Behaviour           BRD/spec/REASONS Canvas, ACs         evaluate (API·PW·schema), GAN,
                                                          perf ratchet, (NEW: contract-drift)
```

This is a documentation+manifest artifact, not new engine code. It (a) makes coverage gaps obvious, (b) gives `/scaffold` something concrete to instantiate per topology (G8), and (c) directly answers the articles' "keep the harness coherent" open question. **Do this first** — it frames everything else.

### G2 — Continuous drift sensors (the missing third column)

Both articles split sensors into three cadences: **during session**, **at integration (CI)**, and **repeatedly, slower** (drift). We have the first two; the third is empty. Drift is precisely where *maintenance/brownfield* quality rots — the enterprise failure mode.

We already own the runners (`coupling-report`, `mutation-smoke`, dead-code candidates, `upstream-watch`) and the scheduling primitives (`/schedule`, `/loop`, `scheduled_tasks.lock`). The gap is a **drift-sensor job** that, on a cadence, runs:
- coupling/hub/cycle delta vs last snapshot → flag new architectural debt
- dead-code accumulation delta
- dependency freshness (`npm outdated`/`pip list --outdated`) + advisory audit
- (if telemetry on) SLO/error-rate/latency regression from the runtime

…and writes a `drift-report.md` + opens a tracked task. This is the article's "janitor army"/"garbage collection" loop (OpenAI/Thoughtworks examples) and converts our per-change sensors into a maintenance harness.

### G3 — Computational security sensors

Inferential security review is necessary but not sufficient (and non-deterministic). The articles name **Semgrep** (SAST) and **GitLeaks** (secrets) as table-stakes computational sensors. For enterprise software this is non-negotiable. Add, tiered to match shift-left:
- **Inner loop / pre-commit:** GitLeaks (secrets) — fast, deterministic, high-value.
- **Commit `gate`:** Semgrep (SAST) + `npm audit`/`pip-audit` (dependency CVEs), gated to fire only when the diff crosses the security boundary the `review-policy` already computes.
- **Drift (G2):** scheduled `pip-audit`/`npm audit` for newly-disclosed CVEs in unchanged code.

Keep `security-reviewer` as the inferential layer *on top* — computational catches the known-patterns cheaply; inferential catches the semantic/logic flaws.

### G4 — Adopt SPDD's structured prompt + bidirectional sync (the big one for brownfield)

This is the most novel idea in the material and the one that most improves the **PRD→BRD step** the user asked about.

**First, an important nuance: we are already *ahead* of SPDD on one axis.** SPDD keeps its artifacts versioned but relies on *human review* to keep them honest. Our pipeline already has a **deterministic, machine-verified traceability chain** — `grounding-check.js` (BRD vs FRD) and `trace-check.js` (spec vs BRD, test vs AC + obligations) are *hard blocks*, not LLM judgment. The `token-billing` SPDD example has nothing equivalent. So we should *not* replace our grounding gates with SPDD; the SPDD win is narrower and specific: **the living, code-synced design artifact**, which we lack.

**What SPDD's worked example actually shows** (verified from `token-billing`): the SPDD `[Analysis]` doc is *richer than a typical BRD* — it carries **Domain Concept Identification (existing-vs-new, citing the codebase)**, a **Key Design Decisions trade-off table**, a **Risk & Gap analysis** with an *ambiguity table*, an *edge-case table*, and an **AC-coverage matrix**. The `[Feat]` REASONS Canvas then adds **Entities (Mermaid class diagram)**, **Approach**, **Structure** (layers/DIP), **Operations** (down to method signatures + execution order), **Norms** (naming/annotation/logging standards), and **Safeguards** (invariants, precision rules, security limits).

Two things to take:

1. **Enrich our planning artifacts with the SPDD sections we lack.** Our `brd`/`clarify`/`design` should gain: domain-concept *existing-vs-new* (we have brownfield `code-graph` to ground this — a real advantage over the example, which scans manually), the trade-off/ambiguity/edge-case/AC-coverage tables, and an explicit **Norms + Safeguards** block. In harness terms, a stronger Canvas *is a stronger feedforward guide* → fewer sensor firings downstream.

2. **Adopt the prompt↔code sync discipline — this is what we genuinely lack.** SPDD's rule "*when reality diverges, fix the prompt first, then the code*", plus `/sync` (code→Canvas after refactor) keeps the design artifact a *living* document instead of a write-once spec that rots. For **maintenance/brownfield** this is the headline win: today our `specs/` can drift from code with nothing noticing. Pairing this with G2 (drift sensors) gives us "design-vs-code drift" as a first-class signal.

**Where SPDD fits our existing lanes (no new top-level workflow needed):**
- SPDD **strong-fit** (standardized delivery, high-compliance/financial systems) → our `/build` and `/feature` full pipeline. The REASONS Canvas becomes an artifact *inside* `design`.
- SPDD **poor-fit** (hotfixes, spikes, one-offs, "context black holes") → our `/vibe` lane. This alignment is exact — SPDD's own "don't use it for" list *is* our vibe-escape-hatch criteria. Reassuring: our lane taxonomy already encodes SPDD's fitness assessment.
- SPDD's `/spdd-code-review` (diff-vs-Canvas intent check) → our `gate` + `diff-reviewer`, extended to read the Canvas.

**Net:** treat the REASONS Canvas as the *spec/design artifact format* and add a sync command. Do **not** import `open-spdd` wholesale — it would duplicate our brd/spec/design and fragment the pipeline. Borrow the **Canvas schema** and the **sync discipline**.

### G5 — LLM-optimised sensor messages ("positive prompt injection")

The sensors article's single most actionable technique: rewrite linter/sensor output to *coach the agent*. Today `verify-on-save` emits generic "fix the errors." Upgrade to per-rule guidance and the **threshold-bump-with-justification** valve (the article found agents quietly raised complexity thresholds instead of refactoring — until the message told them not to, and made the suppression a review focal point). Low effort, high signal-to-token ratio, and it makes every existing sensor more effective without adding new ones.

---

## 5. Recommended roadmap

**Phase 1 — Frame + close enterprise holes (P0)**
- ✅ G1: `HARNESS.md` + `harness-manifest.json` registry (guides×sensors×{maintainability,architecture,behaviour,traceability}) + manifest honesty validator. *Shipped.*
- ✅ G3: computational security sensors — baseline secrets (pre-write + pre-commit); gitleaks + Semgrep + npm/pip-audit via `security-scan.js`, boundary-gated in `/gate`, graceful degradation. *Shipped.*
- ✅ G2: `drift-report.js` drift monitor over architecture (cycles/hubs), dead-code (orphans), and dependency CVEs — snapshot-diff, flags only new regressions, runnable by any cadence (`npm run drift` / `/schedule` / CI). *Shipped.*

**Phase 2 — SPDD artifact discipline (P1)**
- ✅ G4a: `/design` emits `reasons-canvas.md` (REASONS sections + machine-read `Governs`), grounding entities existing-vs-new in `code-graph`; `validate-canvas.js` structure gate in Step 1.9. *Shipped.*
- ✅ G4c: "fix-prompt-first" discipline documented; **Canvas↔code drift** wired into the G2 monitor (`drift-design-code` sensor — governed paths that vanished). *Shipped.* Full bidirectional regeneration (`/sync`, prompt-update→codegen) deferred by choice.
- G4b: enrich `brd`/`clarify` with SPDD's trade-off/ambiguity/edge-case/AC-coverage tables. *Still open (smaller follow-on).*
- ✅ G5: `lib/sensor-guidance.enrich()` adds per-rule self-correction guidance + the threshold-bump-with-justification valve to `verify-on-save` lint/type blocks. *Shipped.*

**Phase 2.5 — Test-effectiveness + boundaries (P1)**
- ✅ G6: `modularity-pack.js` (deterministic grounding, legit-hub pre-classification) + `modularity-reviewer` agent, wired into `/brownfield --full`. *Shipped.*
- ✅ G7: `mutation-gate.js` diff-scopes `mutation-smoke` to a group's changed files; pre-commit enforces it during `/auto` (Gate 3 / test adequacy), blocking on survivors below threshold with file:line + the exact flip. `npm run mutation`. *Shipped.*

**Phase 3 — Depth + maturity (P2)**
- G8: richer fitness functions — vertical bounded-context rules, cycle-fail (promote the existing detection to enforcement), orphan/dead-code rules, test-architecture rules. Wire `oasdiff` (G12) as the API contract-drift gate here too.
- ✅ **G9 (both halves)**: `observability-conventions.md` + `observability-python-fastapi.md` shipped (guide-half); `slo-check.js` scrapes `/metrics` and FAILs on 5xx error-rate over SLO in `/evaluate` (sensor-half). G9 fully complete.
- ✅ **G10**: per-topology harness templates in `/scaffold` — `topologies.js` registry + `buildManifest` preset merge. *Shipped.*
- ✅ **G11**: `harness-coverage.js` maps source files against the sensors' validated `scope` field and reports per-axis coverage % + ungoverned holes (`npm run harness-coverage`); report-only. *Shipped.*
- G12 (partial): ✅ `oasdiff` contract-drift slice shipped (`contract-drift-gate.js`, wired in `/gate` + `npm run contract-drift`). ✅ Default-on axe/WCAG accessibility shipped (`contract-accessibility-default.js`; injected in `/auto` Step 3.5; `accessibility` sensor flipped active, scope runtime). Remaining: approved-fixtures, flake detection (already scoped in `TESTING_AGENT_PROPOSAL.md`); optional Stryker/mutmut incremental tier for flagged high-assurance modules.

---

## 6. Bottom line

- **Greenfield:** already strong. Phase-1 G1 (framing) + G3 (computational security) + Phase-2 SPDD Canvas as the design format make it enterprise-grade rather than POC-grade.
- **Brownfield/maintenance:** the biggest unlock is the **drift cadence (G2)** + **prompt↔code sync (G4c)** — together they turn a build harness into a *maintenance* harness, which is exactly the "hardest where most needed" problem the lead article calls out.
- **SPDD vs harness engineering:** complementary, not conflicting. Harness engineering governs the loop; SPDD governs the artifact at the front of it. Adopt SPDD's **Canvas schema** and **sync discipline**; keep our GAN/ratchet/three-layer engine, which already exceeds what the articles describe for behaviour.

---

## 7. Addendum — Anthropic long-running-agent principles (G13–G14)

This section is on a **different source axis** from the rest of the document. Sections 1–6 measure the harness against Fowler/Thoughtworks (control-system framing) and SPDD (front-of-pipeline artifact). This addendum measures it against **Anthropic's own coding-agent guidance** — *Effective harnesses for long-running agents*, the *autonomous-coding* quickstart, and the multi-context-window prompting docs. That guidance frames quality as an **initializer-agent + coding-agent** loop and lists four failure modes with prescribed fixes.

### Adherence audit (verified against the harness, 2026-06-28)

| Anthropic failure mode | Prescribed fix | Harness | Verdict |
|---|---|---|---|
| Declares whole project done too early | Structured feature-list JSON | `features.json` (seeded by `/scaffold`, filled by `/spec`); each feature `passes:false` until verified | ✅ adheres |
| Leaves a buggy / undocumented environment | Initial git repo + progress notes; read them at session start | `claude-progress.txt` Session 0 + `git init`; `/auto` SECTION 2 reads progress/features/`program.md` every iteration | ✅ adheres (state-read) — *but see G14 for the missing startup test* |
| Marks features done prematurely | Self-verify; only mark passing after careful testing | Evaluator sets `passes:true` only after all three layers (API + Playwright + schema) pass — GAN separation, no self-grading | ✅ adheres (exceeds) |
| Wastes time figuring out how to run the app | `init.sh` that starts the dev server | `init.sh` generated from template; evaluator runs `bash init.sh` | ✅ adheres |
| *(multi-context best practice)* | **A different prompt for the very first context window** | Was identical for window 1 and window N inside `/auto` | ❌ → **G13** |

**Net:** the harness already satisfied 4 of the 5 Anthropic points and *exceeds* them on self-verification (the GAN evaluator is stronger than the quickstart's self-grading). Two real deltas remained, and neither was tracked by the Fowler/SPDD roadmap (G1–G12) — they are a separate axis, recorded here as G13–G14.

### G13 — distinct first-context-window initialization

Anthropic's multi-context-window guidance calls for *a different prompt for the very first context window*: the first window initializes (scaffold, author the feature list, write `init.sh`) while continuation windows recover-and-execute. The harness *did* separate these across **commands** (`/scaffold` → `/brd` → `/spec` → `/auto`), but `/auto` itself ran identical SECTION 2 recovery logic on window 1 and window N.

**Shipped:** `/auto` SECTION 2 now branches on the state it reads. A **first window** (Session 0 only, no completed groups, `current_group: none`) runs an initialization preflight — verify `features.json` is populated, `init.sh` exists and is executable, and the `specs/` prerequisites are present — and refuses to build against a half-scaffolded project. A **continuation window** runs the G14 smoke check and resumes. Registered as the `first-window-init` feedforward guide.

### G14 — session-start smoke test on resume

The quickstart's fix for *"leaves the environment with undocumented bugs"* is to **run a basic test on the dev server at session start**. The harness deferred all health-checking to the post-implementation evaluator, so a fresh process resuming after a mid-group SIGKILL could start building on a broken or half-built tree — exactly the state the append-only progress log cannot record.

**Shipped:** the first time `/auto` enters SECTION 2 in a fresh process *with prior committed work*, it boots the app the way the evaluator does (`project-manifest.json#verification.mode`) and runs the evaluator's **Health-Check Retry** loop *before* selecting work; a failure routes to the SECTION 6 self-healing loop as `failure_layer: "infrastructure"`. It is deliberately skipped on the first window (nothing built yet) and on later in-process iterations (the previous PASS already booted the app), and its boot output is redirected to keep the orchestrator context lean. Registered as the `resume-smoke` computational sensor. This is the same `init.sh` + health-probe machinery the evaluator already owns, relocated to the recovery boundary where the crash-resume risk actually lives.

> **Why P1, not P2:** both close a *correctness-of-the-loop* hole on the autonomous path (the riskiest lane), not a slow-cadence maintainability concern. They are cheap (prompt-level changes reusing existing machinery) and high-leverage on long multi-window builds. The remaining G9–G12 stay P2.
