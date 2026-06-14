# Harness Simplification Proposal

**Date:** 2026-06-10
**Input:** Full audit of `.claude/` (27 skills, 9 agents, 22 hooks, 4 dynamic workflows, scaffold command, templates, state, docs) by four independent read-only explorer agents.
**Constraint:** Preserve the four guarantees — TDD code generation, good-engineering verification (low entropy / tech debt), security review of generated code, and the greenfield/brownfield lanes — while cutting the surface a user must understand roughly in half.

---

## 1. Executive Summary

| Surface | Today | Proposed | How |
|---|---|---|---|
| User-facing commands | ~27 invokables (22 in README + lane-classify + 4 `/harness-*` workflows) | **9–10** | Internalize pipeline steps, merge aliases, delete duplicates |
| Skill directories | 27 | **~15** | Merge reference packs, delete pointer stubs |
| Agents | 9 | **5** | Merge the three judges; demote test-engineer/ui-designer to skill steps |
| Hooks (Node spawns per edit: 13) | 22 | **5–6** (2 spawns per edit) | One consolidated hook per event; commit gates become real git hooks |
| Dynamic workflows | 4 | **0–1** | Delete the three strictly-weaker duplicates |
| Scaffold command | 1,174 lines | **~350** | Extract telemetry/tracker/packs; ship templates as files, not inline text |
| README onboarding | 715 lines, ~28 concepts before first build | **~120 lines, 4 concepts** | "Two lanes, one decision" quickstart; everything else moves to `docs/` |
| Per-edit hook latency | ~5–15 s (TS) / 2–8 s (Py) | **~1–3 s** | Kill per-edit telemetry rebuild, project-wide tsc fallback, redundant spawns |

Every guarantee survives with **exactly one owner and one entry point** — and several real enforcement holes get closed in the process (§5, §6).

---

## 2. Diagnosis — why users say "too complex"

The audits found five root causes. None of them is the core architecture; the GAN generator/evaluator split, the ratchet, and the two lanes are sound. The complexity is accidental:

1. **Internal machinery promoted to commands.** `brd`, `spec`, `design`, `test`, `implement`, `evaluate`, `code-map`, `seam-finder`, `lane-classify`, `install-framework-packs` are pipeline *steps*, but they sit in the same command list as real entry points. A new user confronts ~27 invokables when they need ~9.

2. **Duplicate names for the same thing.** `evaluate`/`evaluation`/`evaluator`-agent form a literal three-file pointer cycle (`evaluator.md:71` → `evaluate/SKILL.md:41` → `evaluation/SKILL.md:14` → back). `test` vs `testing`, `tracker` vs `tracker-publish`, `build` vs `lite`, `fix-issue` vs `improve`, and four `/harness-*` workflows that are weaker re-implementations of four skills. Multiple skills contain sections *explaining why they aren't duplicates* — the need for those sections is the proof.

3. **Routing logic in three places.** Lane classification lives in `lane-classify/SKILL.md:25-35`, in each lane skill's own eligibility block, and in `brownfield/SKILL.md:165-184`. They drift (README lists 7 lanes; the classifier recognizes 6).

4. **Docs that contradict the code.** At least 12 count contradictions (agents 7/8/9, skills 27/28, hooks 15/19/21, templates 10/16, gates 6/7, phases 8/10/11, plugins 8/9, eval layers 3/4). The README routes new users through Docker telemetry setup (Steps 4–5, "This is the critical step") *before* the first build, and ~60% of its volume is PromQL/telemetry reference.

5. **Hook sprawl with post-hoc enforcement.** 13 Node processes per edit, three copies of the architecture checker, three contradictory length limits (pre-gate 500 vs post-gate 300), "security" hooks that fire *after* the secret is on disk, and a Stop-hook review gate that never actually verifies a review happened (§6.1).

---

## 3. Target shape

### 3.1 Command surface: 9–10 commands

```
SETUP        /scaffold        (absorbs install-framework-packs as a verify step)

GREENFIELD   /build           one entry; absorbs /lite as auto-detected or --lite path;
                              gains a deploy phase (fixes the orphaned /deploy);
                              internally runs brd → spec → design ∥ test-plan → auto
             /auto            kept user-facing (resume/steer the loop directly)

BROWNFIELD   /brownfield      absorbs /seam-finder as --seams "<goal>"; runs code-map internally
             /vibe            tiny bounded change (unchanged — best-designed skill in the repo)
             /change          MERGE of /improve + /fix-issue; --issue N adds gh intake/branch/PR
             /refactor        behavior-preserving cleanup (unchanged, keeps --sweep)

GATE         /gate            the single on-demand quality+security gate
                              (absorbs /evaluate's manual role; renamed from /review)

OPTIONAL     /tracker-publish ideally a separate plugin; absorbs the tracker overview skill
```

**Internalized (still exist as skills `/build`/`/auto` invoke, with human gates intact, dropped from the advertised table):** `brd`, `spec`, `design`, `test`, `deploy`, `implement`, `evaluate`, `code-map`, `clarify`.

**Deleted:** `evaluation` (39-line tombstone — its `references/` move under `evaluate/`), `testing` (self-admittedly defers to `code-gen`), `lane-classify` (pure telemetry plumbing — the lane file is written by whichever lane skill runs, via a shared 5-line helper), `tracker` (overview folds into tracker-publish), `lite` (folds into build), `seam-finder` (folds into brownfield), `improve`+`fix-issue` (merge into `/change`), `install-framework-packs` (folds into scaffold).

**Merged reference packs:** `architecture` + `testing` + `code-gen` → one **`engineering-standards`** reference skill (the TDD/typing/error-handling/layering canon injected into every generator). One source of truth for "what good code looks like."

### 3.2 Agents: 9 → 5

| Keep | Why |
|---|---|
| `planner` | Spec generation; absorbs ui-designer's mockup step as a `/design` sub-task |
| `generator` | TDD generation; absorbs test-engineer (test patterns live in `engineering-standards` references; `/test --plan-only` binds to planner) |
| `evaluator` (merged) | Absorbs **phase-evaluator** (artifact-rubric mode) and **design-critic** (design mode). All three are "skeptic that scores against criteria and writes a verdict JSON." Pin `model: opus` in frontmatter. Mode-specific rubrics move to `evaluate/references/`. |
| `security-reviewer` | Independent blocking security gate — untouched. Fix the README contradiction (frontmatter says opus; README.md:259 says Sonnet). |
| `codebase-explorer` | 68 lines, read-only, load-bearing for the brownfield lane. |

**Not merged: generator ↔ evaluator.** That seam is the load-bearing GAN separation (separate context, evidence from the *running app*, no self-evaluation) and it is real today — keep it.

Cross-cutting: put `model:` in **every** agent's frontmatter and delete the README table column and the `program.md` restatement — today only 2 of 9 agents pin a model, so the "Opus judges / Sonnet builds" story is partly decorative. Reduce phase-evaluator gating from six sites to the two artifacts downstream agents consume mechanically (`spec`, `design`); demote brd/brownfield/deploy/seam gates to optional. An LLM rubric-scoring another LLM's prose at six checkpoints is the single biggest contributor to perceived pipeline weight.

### 3.3 Hooks: 22 → 5–6, enforcement moved *before* the damage

One consolidated hook per event, dispatching checks in-process (one Node spawn instead of 13):

1. **`pre-write-gate.js`** — PreToolUse `Write|Edit|MultiEdit`. Consolidates 8 hooks: scope check → env-file deny → secret scan **on the new content only** → security patterns → ONE length limit (300; delete the contradictory 500) → function length → test-first. Everything blocks *before* disk; first failure wins, one clear message. **Must add MultiEdit simulation** (today `enforce-length-pre.js` silently passes MultiEdit). This single hook carries all three guarantees deterministically.
2. **`verify-on-save.js`** — PostToolUse. Lint + typecheck **without `--fix`** (today `lint-on-save` mutates files behind the model's back, causing stale-read edit failures) and **without the project-wide tsc fallback** (today every TS edit can trigger a whole-project typecheck). Includes the per-file layer check.
3. **`commit-gate`** — installed as a real **git `pre-commit` hook** (the harness already installs `prepare-commit-msg`, so the mechanism exists). Consolidates pre-commit-gate + coverage-gate + sprint-contract-gate. A git hook blocks the commit *before it exists*, fires once regardless of how the commit was invoked, and can't be fooled by `--amend` or by unrelated commands containing the string "git commit" (both are live bugs today). Skip coverage when only non-source files are staged; allow a documented baseline reset.
4. **`review-on-stop.js`** — Stop. Derives pending files from `git diff --name-only` (deletes `track-writes` and its per-write context spam); absorbs `session-learnings` advisories. **Fix the `name === 'Agent'` → `'Task'` bug** that makes today's gate a no-op (§6.1).
5. **`record-run.js`** — UserPromptSubmit/Stop/SubagentStop **only** (off the per-edit hot path). Stop embedding the full skill inventory in every record (the ledger is already 11.9 MB and is re-parsed per tool event); push incremental metrics; auto-archive past 10 MB.
6. *(optional)* **`task-gate.js`** — TaskCompleted, only if agent-teams mode stays; thin call into the same test-existence module as the pre-write gate.

**Deleted outright:** `lane-router`, `brownfield-staleness`, `teammate-idle-check` (contradicts test-first-gate's own conventions), `task-completed` (third copy of the architecture checker + a nag). Their content becomes one line in the relevant skill docs.

### 3.4 Dynamic workflows: 4 → 0–1

`harness-eval` (no security layer, doesn't update `features.json`), `harness-review` (doesn't write `security-verdict.json`, so it can't gate anything), and `harness-brownfield-map` (skips the quality gate, misses one map) are **strictly weaker duplicates** — delete them. `harness-implement-group` is the only one with semantics the skill lane lacks (isolated worktrees + human merge): either fix its ceremonial reviewer (it currently judges the implementer's *self-reported* JSON without running anything — make it run the tests in the worktree) and keep it as *the* parallel-implementation lane, or delete it too. Do not keep both lanes of anything.

### 3.5 Scaffold: 1,174 → ~350 lines

- Telemetry stack → `/scaffold --telemetry` (default off); tracker setup → `/tracker-publish`; framework-pack choreography → a scaffold verify step.
- Inline `design.md` (~160 lines) and CLAUDE.md templates → shipped as template *files* and copied.
- **Stop copying everything into every target project.** A minimal project currently receives all 27 skills, 9 agents, 22 hooks, and 4 workflows — a second, instantly-stale source of truth. Copy a lane-appropriate subset, or rely on the plugin mechanism entirely.
- Replace hardcoded count assertions (`SKILL_COUNT = 27`, duplicated twice) with existence checks on load-bearing files — today every skill addition breaks the scaffold.

### 3.6 Docs: "two lanes, one decision"

New README ≤120 lines. Of the six decision axes a user faces today (lane, execution mode, verification mode, runtime, skill-vs-workflow form, effort), **only the lane is a genuine user decision** — everything else has a sane default or is inferred at scaffold time. Say so:

```
Are you building something NEW?
├── Yes → small (≤5 stories, no DB/auth)?  → /build --lite
│         otherwise                        → /build
└── No (existing codebase) → first time? run /brownfield once, then:
          ├── tiny edit (≤3 files, <150 LOC, no auth/API)  → /vibe
          ├── behavior change (add --issue N for a GH bug) → /change
          ├── structure only, no behavior change           → /refactor
          └── big enough to need specs                     → /build (brownfield-aware)
Not sure? Describe the change — the harness classifies it.
```

Concepts before first success drop from ~28 to 4: *the lane decision, the ratchet blocks regressions, a separate evaluator verifies, you merge.* Telemetry, tracker, framework packs, Understand-Anything, and tuning move to one-line links under `docs/`. Also: fix all 12 count contradictions by **deleting the counts** (they're maintenance debt — describe roles, not numbers), stop shipping the author's run residue (`.claude/runs/*.jsonl`, the 11.9 MB `telemetry-ledger.jsonl`, `state/current-lane` containing the invalid value `loop`, `docs/superpowers/` dev plans, root-level `.pptx`/`.png` decks).

---

## 4. Execution modes: 4 → 2

Full/Lean/Solo/Turbo is a 4×7 mode-by-gate matrix that leaks into `evaluate` and `review` tables that must stay in sync. Collapse to:

- **full** (today's Full): all gates per iteration.
- **fast** (today's Lean): skips design-critic per-iteration, keeps it at group end.

**Delete Turbo** (defers gates 4–7 to the end — the failure mode is "discover everything is broken at the finish line"). **Delete Solo** or make it safe: today Solo skips Gate 7, `/evaluate` is a no-op in Solo, and nothing triggers the `/gate` that docs call "the Solo security gate" — i.e., Solo mode ships unreviewed code with only hooks standing guard. If a cheap mode is kept, it must still hard-require `/gate` before commit.

---

## 5. The four guarantees — where each lives after the change

| Guarantee | Single owner after simplification | Strengthened by |
|---|---|---|
| **TDD** | `pre-write-gate` (deterministic test-first) + git `commit-gate` (coverage ratchet) + `generator.md` teammate mandate (red-first wording) | MultiEdit bypass fixed; `improve`'s weak "update and add tests" replaced by `/change`'s red-first requirement; teammate-idle-check's contradictory convention check deleted |
| **Good engineering / low entropy** | `engineering-standards` reference (one canon) + one length limit + `verify-on-save` + `/refactor --sweep` | Three contradictory length hooks → one; lint no longer mutates files behind the model's back; architecture check has one implementation instead of three |
| **Security** | `security-reviewer` agent (blocking `security-verdict.json`, missing-file = FAIL) + secret/env/pattern checks moved **pre-write** | Secrets blocked before disk, not after; `/change` adds a security-reviewer step on auth/data-touching diffs (today `/fix-issue` goes test→PR with *no* review step); Solo-mode hole closed (§4) |
| **Two lanes** | Greenfield = `/build`→`/auto`. Brownfield = `/brownfield` → `/vibe`·`/change`·`/refactor`·`/build`. | Lane routing defined in exactly one place; the classifier and the README finally agree |

---

## 6. Bugs to fix regardless of simplification (found during audit)

1. **`require-review.js:57` checks for a tool named `Agent`; the real tool is `Task`.** The reviewer timestamp is always 0, every code-writing turn gets one confusing stop-block, and the retry path *wipes the queue* — the review gate has never actually verified a review.
2. **The `code-reviewer` agent referenced by `implement/SKILL.md:149`, `refactor/SKILL.md:126`, `improve/SKILL.md:88` does not exist** in `.claude/agents/`. If the `pr-review-toolkit` plugin isn't installed, those review steps silently can't resolve.
3. **`enforce-length-pre.js` doesn't simulate MultiEdit** despite matching it — MultiEdit writes bypass the pre-gate entirely.
4. **`/deploy` is orphaned**: `/auto` Gate 5 docker mode requires `init.sh`, which only `/deploy` generates, but `/build`'s 11 phases never invoke it.
5. **Post-hoc "blocking"**: `protect-env`, `detect-secrets`, `scope-directory`, and all three commit gates fire *after* the write/commit succeeded. The block is a message, not a block.
6. **`coverage-gate` one-way ratchet brick**: one flukey high reading permanently raises the baseline; trigger also fires on `--amend` and on any command containing the substring `git commit`.
7. **`detect-secrets` scans the whole on-disk file**, so one pre-existing fixture string blocks every future unrelated edit to that file; meanwhile entire `/hooks/`, `/evals/`, `/templates/` trees are exempted.
8. **Silent-failure-as-policy**: nearly every hook ends `catch (_) { /* silent */ }` — any internal crash silently disables a "guarantee" with no signal. Consolidated hooks must log failures loudly (to stderr + a state file) even when failing open.

---

## 7. Migration plan — executed in TDD

The repo already has the right harness for this: `node:test` (Node 24), `test/helpers/record-run-fixture.js` with `runHook(projectDir, hookInput)` + `makeProject()` fixtures, and `test/e2e/run.sh`. Every phase below is red → green → refactor against that infrastructure.

**Phase 0 — Characterize current guarantees (tests first, no behavior change).**
Write `test/hooks/` specs that pin the behaviors we must keep: test-first blocks untested source; coverage ratchet blocks regression; security patterns block; secrets block; length blocks. Also write the *failing* tests that encode the known bugs: MultiEdit bypass (red), `require-review` Task-vs-Agent (red), `--amend` false trigger (red), post-hoc env write (red). These red tests are the contract for Phase 1.

**Phase 1 — Consolidated hooks.**
Build `pre-write-gate.js`, `verify-on-save.js`, git `commit-gate`, `review-on-stop.js` as thin dispatchers over extracted pure modules (`lib/length.js`, `lib/tdd.js`, `lib/secrets.js`, `lib/layers.js` — each unit-tested in isolation, no Node-spawn needed). Green = all Phase 0 tests pass, including the formerly-red bug tests. Then rewire `settings.json` in one commit and delete the 16 superseded hooks. *Measure:* per-edit wall time before/after (target ≤3 s).

**Phase 2 — Skill merges (docs-as-code, verified by lint).**
Add a `test/skills-consistency.test.js` that asserts: every agent/skill referenced by name in any SKILL.md exists; no SKILL.md says "do not invoke" (tombstone smell); lane table appears in exactly one file; command count in README matches `skills/` entry points. Red on today's tree (catches the nonexistent `code-reviewer`, the `evaluation` tombstone, the lane-table triplication). Then perform the merges of §3.1 until green.

**Phase 3 — Agent merges.**
Merge phase-evaluator + design-critic into evaluator (mode parameter, rubrics as references); fold test-engineer/ui-designer content into references; pin `model:` everywhere. Verify with the existing `test/phase-eval-*.test.js` suites updated to the merged agent, plus a consistency test that every spawn site references an existing agent.

**Phase 4 — Scaffold diet + docs.**
Update `test/scaffold-command.test.js` to assert the new copy-set and the absence of hardcoded counts; rewrite README around the decision tree; move telemetry/tracker/packs docs under `docs/`; purge shipped state/run residue and add those paths to `.gitignore`.

**Phase 5 — End-to-end ratchet check.**
Run `test/e2e/` greenfield + brownfield pipelines against the slimmed harness; confirm `security-verdict.json` gating, coverage ratchet, and lane trailers still function. Only then delete the `/harness-*` workflows (or land the fixed `harness-implement-group`).

Each phase is independently shippable and reversible; nothing in a later phase is needed to keep the guarantees of an earlier one.

---

## 8. What is deliberately lost, and why that's acceptable

- **Independent test authorship** (test-engineer as a separate agent): a weak anti-self-deception property; the evaluator's black-box runtime layer already covers the risk where it matters.
- **Per-concern context isolation among the three judges**: `/evaluate` already orchestrates them sequentially; the merged evaluator still never generates, so GAN independence is intact.
- **Turbo mode's speed**: it traded away exactly the guarantees this harness exists to provide.
- **Standalone `/code-map`, `/seam-finder`, `/brd`, `/spec`, `/design` commands**: power users can still invoke the internal skills directly; they just stop being advertised as things everyone must understand.
- **Per-edit telemetry granularity**: OTEL (`OTEL_LOG_TOOL_DETAILS=1`, already in settings) provides per-tool data natively; the hand-rolled per-edit ledger rebuild was redundant with it.

---

## 9. Suggested sequencing

| Priority | Item | Effort | Risk |
|---|---|---|---|
| P0 (this week) | §6 bug fixes 1–3 + stop shipping run residue | S | none — pure fixes |
| P1 | Hook consolidation (Phases 0–1) | M | low — characterization tests first |
| P1 | README rewrite + doc-count purge | S | none |
| P2 | Skill merges + command-table cut (Phase 2) | M | low |
| P2 | Agent merges (Phase 3) | M | medium — touches 6 spawn sites |
| P3 | Scaffold diet, workflow deletion, mode collapse (Phases 4–5) | M | medium |
