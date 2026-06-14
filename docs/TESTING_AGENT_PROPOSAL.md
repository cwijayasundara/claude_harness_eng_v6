# Testing Agent Proposal — Making the Harness a First-Class Test Generator

**Date:** 2026-06-14
**Input:** Deep dive by four independent read-only explorer agents across (1) the `/test` skill + its references, (2) the runtime evaluator (3-layer + security + perf), (3) how testing is wired into the SDLC pipeline, and (4) the framework's own self-test suite (`test/`, 66 files).
**Goal:** Make the harness produce **comprehensive** tests — test plans, cases, and data covering positive / negative / boundary — from a PRD (greenfield) **and** from existing code + change requests (brownfield), drive them through Playwright E2E, and prove the **framework itself** is correct through unit + integration + behavioral testing.
**Constraint:** Build on the existing skeleton — do not rebuild. Preserve the four guarantees (TDD codegen, engineering verification, security review, greenfield/brownfield lanes) and the prompt-cache prefix rules in `CLAUDE.md`.

---

## 1. Executive Summary

The harness is **not** missing a testing subsystem — it has a strong one. What it lacks is **depth of test-design technique** and **behavioral self-testing**. This proposal fills both. Four approved workstreams:

| # | Workstream | Problem it solves | Primary deliverables |
|---|---|---|---|
| **W1** (P0) | Comprehensive test design | Boundary/negative coverage is shallow — "cover edge cases" with no *method* | `test-design.md` reference; schema-driven constraint extraction; equivalence/boundary/state-transition technique; adversarial fixture factory |
| **W2** (P0) | Framework self-testing | 26 skill prompts + 8 agent prompts have **zero** behavioral tests; golden evals exist but are **not in CI** | Evals wired into CI; behavioral test files per critical agent/skill; script unit-test backfill |
| **W3** (P1) | CR-driven brownfield tests | No flow turns a change request into a regression-pin + delta test plan | `/test --from-cr` mode composing seam-finder + pinning |
| **W4** (P1) | Coverage + a11y gates | Coverage is repo-wide only (dark code can hide); no accessibility verification | Per-diff coverage gate; axe-core check in evaluator Layer 2 |

**Sequencing:** W1 and W2 are independent and ship first (both P0). W4 builds on W1's schema work and the evaluator. W3 builds on W1's test-design technique. Each workstream is independently mergeable.

---

## 2. Current State — What Already Exists (and is good)

This is the foundation each workstream extends. None of it should be rebuilt.

| Capability | Location | Status |
|---|---|---|
| Test plan + cases + fixtures from stories | `/test --plan-only` → `specs/test_artefacts/` | Runs in **Phase 3, parallel with `/design`** (`build/SKILL.md:56-71`) |
| AC→test traceability, **hard grounding gate** | `test-traces.json` + `trace-check.js`; blocks `net_new`/`dropped` | Genuinely strong (`test/SKILL.md:96-111`) |
| TDD enforced 3 ways | pre-write hook (`pre-write-gate.js:107-117`), `/auto` Gate 1, `generator.md:143-153` | Real teeth — production code blocked without a test on disk |
| Coverage ratchet (monotonic, 80% floor) | `/auto` Gate 3, `coverage-baseline.txt` | Works; **repo-wide only** (see §3 Gap D) |
| Playwright E2E (semantic selectors, no `waitForTimeout`, AC-mapped) | `/test --e2e-only`, `evaluate/references/playwright-patterns.md` | Mature, canonical, single-sourced |
| 3-layer runtime eval (API + Playwright + Vision) + security gate + perf ratchet | `/evaluate`, `evaluator.md`, `perf-baseline.js` | Strong architecture; gaps are in *breadth* not structure |
| Brownfield characterization (pin before edit) | `pinning-down-behavior`, `checking-coverage-before-change`, `sprouting-instead-of-editing` | Good safety model; **not composed into a CR flow** (Gap B) |
| Realistic fixture factories (Faker, seeded, override pattern) | `code-gen/references/test-data.md` | Good for *valid* data; no *invalid/edge* factories (Gap A) |
| Framework self-test (hooks, schemas, scripts, e2e, golden evals) | `test/` (66 files, `node:test`) | Infra well-tested; **brains untested** (Gap E) |

---

## 3. Gap Analysis

**Gap A — Test-design technique is shallow.** `code-gen/references/test-strategy.md:47-59` gives a 5-item boundary checklist (empty / boundary / invalid-type / error-path / concurrency). That is the *only* systematic guidance. There is no **equivalence partitioning**, no **constraint extraction from schemas** (the harness already emits `data-models.schema.json` / `api-contracts.schema.json` but never mines them for negative tests), no **state-transition matrices**, no **malformed/adversarial input fixtures**, and concurrency is named but has no pattern. Net effect: the agent is told *to* cover boundaries but not *how to derive them*.

**Gap B — No CR-driven test generation.** Brownfield inputs are "existing code + change requests." `/change` is test-first per-AC, and `pinning-down-behavior` + `seam-finder` exist — but nothing **ingests a CR and emits a test plan** (regression-pin set for behavior that must hold + delta tests for new behavior). The parts exist; the composition does not.

**Gap C — Runtime verification breadth.** No **accessibility** (axe/WCAG) check despite semantic selectors being mandated; perf is **sequential-sample only** (no load/concurrency); no **API contract-drift** detection (schema is validated per-request but never diffed across builds); no **flake detection** (retry is manual, per-check); no **mutation testing** (nothing proves the suite would catch a regression — the `pinning` skill has a one-off "mutation-smoke checkpoint" that could generalize).

**Gap D — Coverage gate is coarse.** `/auto` Gate 3 reads one repo-wide `TOTAL` %. A group can ship 500 dark lines if other groups are well-covered and the ratchet still rises. No per-story / per-diff coverage, no branch coverage, no per-module floor.

**Gap E — The framework barely tests its own brains.** This is the highest-risk gap *for this repo*, whose product **is** prompts. 26 skill `SKILL.md` files and 8 agent prompts have **only structural/metadata tests** (`skills-consistency.test.js`, `plugin-schema.test.js`) — zero behavioral verification. The 7 golden-task evals (`test/evals/tasks.json`) exist with a real assertions engine but **`npm run test:evals` is not in `ci.yml`**. 8 of 13 scripts lack dedicated unit tests.

---

## 4. Proposed Design

### W1 — Comprehensive Test Design (P0)

**Intent:** Turn "cover edge cases" into a repeatable method the generator applies on every project, greenfield or brownfield.

**4.1 New reference: `.claude/skills/test/references/test-design.md`**
The technique playbook the test-authoring generator reads (added to `test/SKILL.md` Step 1 reading list and `test-authoring.md`). Contents:

- **Equivalence partitioning** — for each input field, partition the domain into valid + invalid classes; one representative test per class (e.g., email → `valid` / `missing-@` / `empty` / `oversized` / `unicode` / `injection-payload`).
- **Boundary-value analysis** — for each numeric/length/date constraint, test `{min-1, min, min+1, max-1, max, max+1}`. Worked `@pytest.mark.parametrize` and `describe.each` examples (filling the gap the explorers flagged — parametrize is mentioned but never shown).
- **State-transition testing** — for stateful entities, enumerate the legal transition graph from the ACs; one test per legal transition **and** per illegal transition (forbidden moves must be rejected).
- **Error-path enumeration** — a checklist mapping HTTP statuses (400/401/403/404/409/422/429/500/503) and domain error classes to required negative tests.
- **Concurrency/idempotency** — concrete patterns (`asyncio.gather`, `Promise.all`) for race tests; idempotency tests for retry-safe endpoints.

**4.2 Schema-driven constraint extraction (deterministic helper)**
New script `.claude/scripts/constraints-extract.js`: reads `specs/design/data-models.schema.json` + `api-contracts.schema.json`, and for every field emits a machine-readable **obligation list** (`{field, rule: minLength|maximum|pattern|enum|required, value, suggested_cases}`) → `specs/test_artefacts/constraint-obligations.json`. The generator must produce a negative test for each obligation; a new check in the grounding step verifies every obligation is covered (extends the existing `trace-check.js` pattern — obligations become a second "required" index alongside ACs). This makes negative-test coverage **deterministic and gateable**, not best-effort.

**4.3 Adversarial fixture factory**
Extend `code-gen/references/test-data.md` with `buildInvalid*()` / `buildMalformed*()` factory patterns: oversized strings, wrong types, malformed JSON, boundary numerics, and a curated injection/XSS payload list for security-relevant fields. Pairs with W4's a11y/security and the existing security-reviewer.

**Touched:** `test/SKILL.md` (Step 1 + Step 4 obligation gate), `test/references/test-design.md` (new), `code-gen/references/test-data.md`, new `scripts/constraints-extract.js`. **No cache-prefix risk** (no `CLAUDE.md` edits).

### W2 — Framework Self-Testing (P0)

**Intent:** The framework whose product is prompts must test its prompts. Today it tests only that files exist.

**4.4 Evals into CI**
Add `test:evals` to `ci.yml` with a pinned `EVAL_MODEL` (default `claude-haiku-4-5` for cost, overridable to opus for release gates). The 7 golden tasks (`surgical-bugfix`, `vibe-escalates-auth`, `tdd-new-behavior`, etc.) become a **merge gate**, catching prompt drift. Mark cost/runtime clearly; allow a `CI_SKIP_EVALS` escape for doc-only PRs.

**4.5 Behavioral test files for critical agents/skills**
New `test/behavioral/` suite (one file per critical brain, run under the evals harness so they share fixtures and the model pin):
- `evaluator` emits a verdict conforming to `phase-eval-result.schema.json` and the runtime verdict shape.
- `security-reviewer` flags a **seeded** SQL-injection fixture (true-positive) and does **not** flag a parameterized-query fixture (false-positive guard).
- `/vibe` escalates ineligible auth work; `/test --plan-only` produces a grounded `test-traces.json` for a 2-story fixture.
- `generator` writes a failing test before implementation (TDD order) on a trivial fixture.

**4.6 Script unit-test backfill**
Dedicated `node:test` files for the 8 untested scripts, prioritising `validate-contract.js`, `constraints-extract.js` (new, W1), and `telemetry-skill-helpers.js`. Pure-function level, fast, CI-included.

**Touched:** `.github/workflows/ci.yml`, `test/behavioral/*` (new), `test/scripts-*.test.js` (new), `docs/testing.md` (document the new layers).

### W3 — CR-Driven Brownfield Test Lane (P1)

**Intent:** Turn a change request into a test plan that *protects* existing behavior and *proves* the new behavior — the brownfield mirror of the greenfield PRD→test flow.

**4.7 New mode: `/test --from-cr <file|--issue N>`**
Pipeline:
1. **Read** the CR (markdown file or GitHub issue) + `specs/brownfield/code-graph.json`.
2. **Locate** affected symbols (reuse `seam-finder` to rank cut-points; reuse `checking-coverage-before-change` to classify COVERED/UNCOVERED).
3. **Emit two test sets** into `specs/test_artefacts/cr-<id>/`:
   - **Regression-pin set** — characterization tests over behavior that must stay identical (delegates to `pinning-down-behavior` for UNCOVERED seams; lists existing oracle tests for COVERED ones).
   - **Delta test plan** — new positive/negative/boundary cases for the CR's new behavior, using W1's technique + constraint extraction.
4. **Trace** every delta case to a CR acceptance line (extends `trace-check.js` with the CR as the upstream index — same grounding-gate mechanics as ACs).

This composes existing skills rather than adding a parallel engine. `/change` gains a note to run `/test --from-cr` first when a CR document exists.

**Touched:** `test/SKILL.md` (new mode + prerequisites), `change/SKILL.md` (pointer), reuses `seam-finder`, `pinning-down-behavior`, `trace-check.js`.

### W4 — Coverage + Accessibility Gates (P1)

**Intent:** Close the two enforcement holes — dark code and inaccessible UI.

**4.8 Per-diff coverage gate**
Augment `/auto` Gate 3: in addition to the repo-wide ratchet, compute coverage **on the diff of the current group** (changed files/symbols vs `coverage_map.py` output) and require it to meet a per-diff floor (default 80%, configurable in `project-manifest.json`). Record per-group coverage to `coverage-history.jsonl` for trend visibility. This stops dark code hiding behind a healthy repo-wide average.

**4.9 Accessibility check in evaluator Layer 2**
Add an optional axe-core pass to the Playwright layer: after a page renders, run `axe.run()` and fail on configurable impact levels (default: block `critical`/`serious`). Add a `accessibility_checks` block to the sprint-contract schema (`contract-schema.json`) mirroring the existing `design_checks` shape (`required`, `block_impacts`). Lean mode: WARN; Full mode: gate.

**Touched:** `auto/SKILL.md` (Gate 3), `coverage-map`/`coverage-preflight` helpers, `evaluate/SKILL.md` (Layer 2), `evaluate/references/contract-schema.json`, `evaluator.md`.

---

## 5. Roadmap

| Phase | Workstream | Deliverables | Self-test (proves it works) |
|---|---|---|---|
| **1** | W1 | `test-design.md`, `constraints-extract.js`, adversarial fixtures, obligation gate in `/test` | Unit tests for `constraints-extract.js`; golden eval: 2-field schema → expected negative obligations |
| **2** | W2 | Evals in CI; `test/behavioral/`; script backfill | The new tests are themselves the deliverable; CI green is the proof |
| **3** | W4 | Per-diff coverage gate + `coverage-history.jsonl`; axe-core Layer 2 + contract schema | Unit test: diff-coverage rejects a dark-code fixture; behavioral test: evaluator fails a known-inaccessible page |
| **4** | W3 | `/test --from-cr` mode | Behavioral test: a fixture CR → expected regression-pin + delta plan with a clean grounding verdict |

Each phase is an independent PR. W1 → W4 ordering matters (W4 reuses W1's constraint plumbing); W2 and W3 are independent of the others.

**Delivered so far:** W1 (PR #3); **mutation-smoke** (PR #4, promoted out of §6 — the obligation gate proves a negative test *exists*, mutation-smoke proves the tests *bite*); **W2** (PR #5) — eval runner (`test/evals/run-evals.js`, injectable invoker) + guarded CI `evals` job + structural task-spec validator + `validate-contract.js`/`telemetry-skill-helpers.js` backfill + a security-reviewer behavioral task; **W4** (PR #6) — per-diff coverage gate (`coverage-diff.js`, Istanbul + Python, `coverage-history.jsonl` trend) wired into `/auto` Gate 3, and an axe-core `accessibility_checks` gate in the evaluator's Playwright layer (Full=FAIL / Lean=WARN). **W3** (PR #7) — the brownfield CR lane: `/test --from-cr <file|--issue N>` turns a change request into a regression-pin set (`pinning-down-behavior` + `mutation-smoke`) plus a CR-grounded delta test plan, with `cr-index.js` building the CR acceptance index that `trace-check.js` gates the delta tests against. The deterministic parts (runner orchestration, task-spec validation, script units, coverage-diff, schema, cr-index) run in plain `npm test`; the model-driven golden run is gated on `ANTHROPIC_API_KEY`.

**Roadmap complete:** W1, mutation-smoke, W2, W4, W3 all shipped (PRs #3–#7). Remaining work is the §6 P2 backlog (load/concurrency testing, contract-drift detection, systematic flake detection) — each a follow-up that adds a tool dependency.

## 6. Out of Scope (deferred to a later P2 roadmap)

~~Mutation-testing gate (generalize the pinning "mutation-smoke")~~ — **done** (dependency-free runner, relational/equality/logical/boolean operators, JS + Python, string/comment-safe so false survivors are impossible). Still deferred: load/concurrency testing (k6/Artillery in perf layer), API contract-drift detection (baseline-diff on `api-contracts.schema.json`), and systematic flake detection (N× E2E re-run). These add tool dependencies and belong in a follow-up once W2–W4 land.

## 7. Risks & Mitigations

- **Eval cost/flake in CI (W2).** Mitigate: pin a cheap model by default, gate opus-level evals to release branches, allow `CI_SKIP_EVALS` for doc-only PRs, and assert on robust signals (schema conformance, presence/absence) not exact prose.
- **Over-generation of negative tests (W1).** The obligation gate could explode test count on a wide schema. Mitigate: one representative case per equivalence class, not per value; cap and `log()` truncation rather than silently dropping.
- **Cache-prefix invalidation.** None of W1–W4 edits `CLAUDE.md`. New references are read on demand inside forked skill contexts, preserving the cached prefix per `CLAUDE.md` §Prompt Caching.
- **Brownfield CR ambiguity (W3).** A vague CR yields a weak delta plan. Mitigate: route through the existing `/clarify` gate when the CR lacks acceptance lines, before emitting tests.
