---
name: change
description: Change the behavior of existing code — story-driven by default, or --issue N for a GitHub bug fix. Test-first, full verification, code review.
argument-hint: "[description | story-id | --issue N]"
context: fork
---

# Change Skill — Behavior Change on Existing Code

One lane for changing what existing code *does*: adding to or altering observable behavior (story-driven), or fixing a reported bug (`--issue N`). For changes that must **not** alter behavior, use `/refactor`. For a tiny low-risk edit (≤3 files, <150 lines, no auth/API/persistence), use `/vibe`.

## Usage

```
/change "add confidence scores to extraction"   # story-driven enhancement
/change E2-S3                                    # implement an existing story
/change --issue 42                               # fix GitHub issue #42
```

- **Description or story ID** → story-driven mode (Steps S1–S7). The change is traceable to a story with acceptance criteria.
- **`--issue N`** → issue mode (Steps I1–I9). The change is a test-first bug fix that branches, reproduces, fixes, and opens a PR.

Both modes are **test-first**: no production code changes until a test that captures the desired behavior (or reproduces the bug) has been written and observed failing.

## Step 0 — Lane check (auto-route)

`/change` is the safe default entry for "modify existing code" — you don't have to pre-pick the lane. Before any change work, classify the request and route it. Estimate scope from the request (and `specs/brownfield/risk-map.md` + `change-strategy.md` if present): files touched, lines, and whether observable behavior actually changes.

| If the request is… | Route to | Why |
|---|---|---|
| **No observable behavior change** — pure rename / move / extract / dedupe; tests would be unchanged | **stop → `/refactor`** | Behavior-change ceremony (new story, red-first test) is wrong for structure-only work |
| **Tiny and low-risk** — ≤3 files, <150 lines, and no auth/authz/payments/persistence/public-API change | **recommend `/vibe`** | Lighter micro-contract. Proceed here only if the user wants full ceremony |
| **Too large for one bounded change** — needs more than ~2–3 stories, spans many modules, or introduces a new subsystem | **stop → `/build`** (brownfield-aware) | `/build` plans BRD→spec→design and runs `/auto`; `/change` is one story or issue, not a multi-story build |
| **A single behavior change to existing code** | **continue with this skill** | The intended lane |

State the chosen lane in one line. When you redirect (`/refactor` or `/build`), say why and stop — do not silently switch lanes. For the `/vibe` case, note it as the lighter option, then proceed if the user invoked `/change` deliberately.

> **CR-driven brownfield tests:** when the change is described by a change-request document or a GitHub issue, run `/test --from-cr <file.md>` (or `--from-cr --issue N`) first. It produces a regression-pin set (existing behavior to hold) plus a CR-grounded delta test plan (new behavior to prove), so the test-first step below has its oracle and its targets ready.

> **/goal tip (optional unattended iteration):** On Claude Code v2.1.139+ you can let `/goal` drive this single bounded session toward a verifiable condition — e.g. `/goal pytest exits 0 and lint is clean, or stop after N turns` (issue mode: `/goal the failing repro test now passes and lint is clean, or stop after N turns`). Always include the "or stop after N turns" safety clause, and phrase conditions so each turn must produce *fresh* evidence (re-run the tests, show the exit code) to avoid false-positive completion. `/goal`'s evaluator (Haiku) only judges what is in the transcript — it does **not** run tools or read files — so the proof (test output, exit codes) must be printed in the conversation, not routed through subagents. That makes `/goal` suitable for this small lane only. Do **not** use `/goal` inside `/auto`: it is single-session and would conflict with session chaining, the GAN evaluator, and sprint contracts. `/goal` does not replace the evaluator/sprint-contract gate.

---

## Story-driven mode (default)

### Step S1 — Ensure a Story Exists

Every behavior change must have a story file in `specs/stories/` before implementation begins.

- If a story ID was provided (e.g. `E2-S3`): read `specs/stories/E2-S3.md` and confirm it has acceptance criteria.
- If a description was provided: check for a matching story. If none exists, create `specs/stories/{next-id}.md` with Title, Problem statement, Acceptance criteria (numbered, each testable), and Out of scope (explicit).

Do not proceed until acceptance criteria are written and confirmed.

### Step S2 — Impact Assessment

Read the current codebase to understand what is affected:

- **Learned rules:** read `.claude/state/learned-rules.md`. If it exists and is non-empty, inject its contents verbatim into your working context before making any edits — the same convention `/auto` already uses for every spawned agent.
- **Process rules:** read `.claude/state/process-rules.md` if it exists and is non-empty; inject workflow constraints (e.g. no destructive git during parallel work, no stub-to-green) before editing.
- **Context-first (Iron Law) — REQUIRED when `specs/brownfield/code-graph.json` exists and is not a placeholder.** Before any production source `Read` of a large file, or any unconstrained repo-wide search, run:
  ```bash
  node .claude/scripts/context-pack.js --diff --budget 1600 "<story problem / user request>"
  ```
  (or `/context "..."`). Then:
  - Read **only** the `read_next` line ranges (and `skeletons/` + `Read(offset, limit)` for god files).
  - Use `task_map.edit_candidates` / `must_not_break` / `tests_to_run` as the impact seed.
  - If `status` is `missing`/`placeholder` → run `/code-map` or `/brownfield` first.
  - If `confidence` is `low` or `status` is `low_confidence`/`no_match` → ask a clarifying question using `task_map.clarify_options` / clusters, **or** run **one** narrow `rg` and re-pack. Do **not** open a multi-file exploration loop.
  - Do **not** front-load all brownfield essays. Prefer the pack. Read `risk-map.md` only if pack hits auth/billing/persistence/security paths or the user asked for risk. Read `architecture-map.md` / `test-map.md` / `change-strategy.md` only when pack confidence is low or scope is still ambiguous after one re-pack.
- **Brownfield map (fallback):** if the graph is missing on a non-trivial existing codebase, recommend `/brownfield` first. If maps exist and the pack is low-confidence, use them as orientation — not as a substitute for the pack when the graph is real.
- **Symbol navigation:** use pack `read_next` first; fall back to `specs/brownfield/symbol-map.md` (`Lstart-Lend` anchors). For files flagged in `skeletons/`, read the `.skel.md` first and then only the relevant symbol slice via `Read(offset, limit)` — never whole-file-read a skeleton-flagged file.
- **Seam plan:** if `specs/brownfield/seams-<goal-slug>.md` exists for this change's goal (or the user named a seam), read it and prefer its top-ranked seam (`extend`/`wrap`/`introduce-adapter` action) as the cut-point for the change. Note in the impact assessment which seam you adopted or why you rejected it.
- **Reuse-or-justify — REQUIRED SUB-SKILL: `reuse-or-justify`** when this change adds or materially extends behavior. Invoke `reuse-or-justify` at intake with the story goal, before Step S4. The sub-skill grounds on reuse-scout itself and gates the dialogue: when a goal-relevant seam, touched invariant, or same-release clone fires it settles reuse-vs-new (plus any invariant / performance budget); when nothing fires it records the net-new assumption and proceeds. Either way the decision is recorded — do not run reuse-scout here yourself.
- **Coverage preflight — REQUIRED SUB-SKILL: `checking-coverage-before-change`** for every symbol in the planned diff. COVERED → run the listed oracle tests before and after each edit. UNCOVERED → `pinning-down-behavior` (or `sprouting-instead-of-editing`) before touching the symbol. If structural cleanup is needed alongside the behavior change, split commits per `keeping-refactors-pure`.
- **Migration preflight — REQUIRED SUB-SKILL: `checking-migration-safety`** when the planned diff touches ORM models, `migrations/`, schema files, serializers/DTOs, or message shapes. Destructive/transform schema changes go expand-contract; the contract step never ships in this change.
- **Dependency bumps — REQUIRED SUB-SKILL: `upgrading-dependencies`** when the diff touches a package manifest or lockfile. The bump lands in its own commit, never mixed with this change's code.
- **Risk-heavy changes default to a flag.** If the change touches authentication, authorization, payments, or data migration paths, put the new behavior behind a feature flag (config or env toggle) so old and new paths can run side by side and cutover is reversible without a deploy. For critical-path services with real traffic, run both paths and compare (GitHub Scientist pattern — see `pinning-down-behavior` step 6). Plan flag removal as explicit follow-up work — a flag with no removal plan is permanent complexity.
- **Affected files:** which source files implement the functionality being changed?
- **Affected API contracts:** does this change any request/response shape, endpoint signature, or event payload?
- **Existing test coverage:** run the current suite. Record which tests cover the affected files — these must keep passing (with updates where behavior changes intentionally).
- **Downstream consumers:** does any other module, service, or UI component depend on the behavior being changed?

Document this assessment before writing any code.

### Step S3 — Consult Architecture Docs

Read `specs/design/` for relevant architecture decisions and `.claude/skills/code-gen/references/architecture.md` for layering rules. Confirm the planned implementation stays within the correct layer (new type → `types/`, new query → `repository/`, …). Do not shortcut layers.

If `specs/design/reasons-canvas.md` exists, treat it as the living design contract. Behaviour changes that create, move, or materially alter governed source files must update the Canvas first: `Requirements`/`Operations` for intent and implementation steps, `Safeguards` for risks, and `Governs` for changed paths. After code changes, run `npm run canvas-sync`; a mismatch is a **self-correct** finding in `/change` until the Canvas and diff agree.

### Step S4 — Write the Failing Test(s) First

**Acceptance test — REQUIRED SUB-SKILL: `writing-acceptance-tests-first`.** Before any other test or implementation code for this story, write its acceptance test(s) first against the Ports-and-Adapters seam identified in Step S2 (or via `/seam-finder` if none exists yet), with a test-double adapter standing in for I/O. Run it and confirm it fails for the right reason. This AT is the primary, business-readable acceptance-criteria verification loop; the AC-by-AC tests below proceed once it is red.

For each acceptance criterion, **write or update the test before the implementation, and observe it fail (red)**:

- If an existing test covers the old behavior and the behavior is changing: update it to assert the *new* expected behavior, then run it and confirm it fails against the current code. Add a comment noting which AC it covers.
- If no test covers the criterion: add a new test and confirm it fails for the right reason (feature missing — not a typo).

A test that passes before the change is not exercising the new behavior. Changing a test to pass rather than fixing the code is never acceptable — the test is the specification.

### Step S5 — Implement Changes

Modify the existing implementation files until the red tests go green. Do not create parallel implementations.

- Modify in place. No `_v2` function alongside the original.
- If a function signature changes, update all call sites before committing.
- If an API contract changes, update the schema definition and all serializers.
- Keep changes scoped to what the acceptance criteria require.

Run the full test suite — all tests must pass. Then run the project's lint and type checks (`npm run lint` / `ruff check .`, and `tsc --noEmit` / `mypy .`) and fix anything the change introduced — don't leave it for the reviewer to catch a diff that already has the error.

**Impact-scoped local regression (G16) — required, in addition to the unit suite above, not instead of it.** The full unit suite only proves this change didn't break its own layer; it says nothing about earlier features — but running the WHOLE accumulated `e2e/` suite on every single `/change` is too expensive for local iteration. Run `node .claude/scripts/run-gate-checks.js --only local-regression` (add `--exclude-group <this change's group>` if the change is scoped to an in-flight sprint group). It computes which prior story-group(s) this change's diff could plausibly affect — a deterministic dependency-graph blast radius over `code-graph.json`, not an LLM guess — via `specs/test_artefacts/verification-matrix.json` (or `specs/design/component-map.md` as a fallback), and re-runs only THOSE groups' e2e specs and sprint-contract `api_checks`, plus any human-curated `project-manifest.json#verification.golden_paths`. A `blocked` verdict is a **BLOCK**: fix the regression before proceeding to Step S6, the same way a failing unit test would block. Tests already quarantined in `specs/drift/flake-history.jsonl` are excluded. This is the fast local complement to gap G15's full regression-suite-full check, which still runs unabridged (the whole accumulated suite, not just the impacted subset) at `/gate` and `/auto`'s pre-merge step as the final backstop before merge.

If `specs/test_artefacts/` exists, update `test-cases.md` and `test-data/` to reflect the changed acceptance criteria — keep the test plan in sync with the actual state of the stories. If Playwright E2E specs exist in `e2e/`, update the affected files to match the new behavior.

### Step S6 — Adaptive Review

Write or refresh `specs/reviews/review-context-pack.md` with the story, acceptance criteria, changed files, relevant DeepWiki/code-map links, and the exact test/lint/typecheck commands that passed.

Resolve code-review mode (same auto thresholds as `/implement` / Gate 8):

```bash
node .claude/scripts/review-tier.js --files <n> --lines <n> [--security-boundary]
```

- **standard:** spawn one `code-reviewer` on the full diff → `specs/reviews/code-review-verdict.json`.
- **adversarial:** spawn **two independent** `code-reviewer` instances (fresh context each; diff + AC + context pack only — no builder reasoning). Write `code-review-verdict-a.json` / `code-review-verdict-b.json`, then:
  ```bash
  node .claude/scripts/merge-review-verdicts.js \
    --a specs/reviews/code-review-verdict-a.json \
    --b specs/reviews/code-review-verdict-b.json \
    --policy union
  ```
  Canonical verdict stays `code-review-verdict.json`; audit at `adversarial-review-audit.json`. Fail safe to stricter on instance error/timeout.

**Spawn `security-reviewer` only if the diff touches authentication, authorization, secrets, user input handling, uploads/downloads, network fetch/redirect/proxy code, payments/billing, persistence/schema/migrations, API routes/controllers/middleware, or configured security patterns**. Run selected reviewers in parallel in a single message.

If the diff includes a new or changed acceptance-test file (typically under `specs/test_artefacts/acceptance/`), instruct `code-reviewer` to specifically judge that file's **readability**: could a non-technical stakeholder follow the Given/When/Then narrative and understand the requirement it verifies? Note this instruction in the context pack — per Vaccari, readability is itself the correctness signal for whether the story was understood.

Reviewers read only the context pack, final diff, test output, and directly touched files. Do not pass the whole implementation transcript or raw full-suite logs.

Findings: **BLOCK** must be fixed; **WARN** should be fixed (document if deferring); **INFO** optional. Maximum 3 retry cycles for BLOCK findings — if any remain after 3 cycles, stop and report.

### Step S7 — Update Story File

Add an implementation status section to the story file:

```markdown
## Implementation Status

Status: COMPLETE
Implemented: {date}
Files changed: {list of files}
Tests added/updated: {list of test files}
AC coverage:
  - AC1: covered by test {test name}
  - AC2: covered by test {test name}
```

---

## Issue mode (`--issue N`)

### Step I1 — Read the Issue

```
gh issue view {n}
```

Read the full issue: title, body, labels, linked issues, comments. Extract the specific failure, any reproduction steps, and any stated acceptance criteria. If the issue is too vague to reproduce, stop and request clarification (`gh issue comment {n} --body "..."`). Do not proceed with a vague issue.

### Step I2 — Systematic Debugging

Before writing any fix, invoke `superpowers:systematic-debugging` to diagnose the root cause. This prevents jumping to conclusions and informs both the failing test (I4) and the fix (I5).

### Step I3 — Create a Branch

```
git checkout -b fix/{short-description}
```

Base the name on the issue title — short, lowercase, hyphenated (e.g. `fix/order-total-rounding`).

### Step I4 — Write a Failing Test, Verify It Fails

Before touching production code, write a test that directly exercises the reported failure. It must live in the affected module's test directory, have a name describing the bug, and **fail when run against the current code**. Run it in isolation and confirm the red state with the expected error. If it passes, it does not reproduce the bug — revise it.

### Step I5 — Fix the Root Cause

Read the affected code, identify the root cause (not the symptom), and make the minimal change to fix it. Do not refactor unrelated code, add features, or change behavior outside the issue's scope.

### Step I6 — Run the Full Test Suite

Run the affected module's tests and the full suite. Every previously passing test must still pass. Do not comment out or delete tests to make the suite pass.

### Step I7 — Lint and Type Checks

Run the project's lint and type checks (`npm run lint`, `mypy`, `tsc --noEmit`, …) and fix anything introduced by the change.

### Step I8 — Adaptive Review

Write or refresh `specs/reviews/review-context-pack.md` with the issue, reproduction, root cause, changed files, test proof, and risk triggers.

Resolve code-review mode via `node .claude/scripts/review-tier.js --files <n> --lines <n> [--security-boundary]` (same as Step S6): standard = one `code-reviewer`; adversarial = two independent instances + `merge-review-verdicts.js --policy union`. **Spawn `security-reviewer` only if the fix touches authentication, authorization, secrets, user input handling, uploads/downloads, network fetch/redirect/proxy code, payments/billing, persistence/schema/migrations, API routes/controllers/middleware, or configured security patterns**. Run selected reviewers in parallel in a single message. Resolve BLOCK findings (max 3 cycles).

### Step I9 — Commit and Open a PR

```
git add {changed files}
git commit -m "fix: {description} (closes #{n})"
gh pr create --title "fix: {description}" --body "..."
```

Stage only the files changed for this fix. The PR body must include `Closes #{n}`, the root cause, the fix approach, and confirmation that the reproducing test now passes.

---

## Distinction from /refactor

| Dimension | /change | /refactor |
|-----------|---------|-----------|
| Behavior change | Yes — intentional | No — must be zero |
| Requires story / issue | Yes (story or `--issue N`) | No |
| Tests | Written/updated red-first to match new behavior | Must pass unchanged |
| API contracts | May change | Must not change |

If you are not changing observable behavior, use `/refactor` instead.

---

## Output

| Artefact | Purpose |
|----------|---------|
| `specs/stories/{id}.md` (story mode) | Story with AC and implementation status |
| `fix/{description}` branch + PR (issue mode) | Review-ready change set with `Closes #{n}` |
| Failing test (now passing) | Proof the new behavior / fix is exercised |
| Modified source + updated tests | The change and its verification |

---

## Gotchas

- **No story / vague issue.** Never implement without written acceptance criteria or a reproducible issue. Write the story or request clarification first.
- **Test does not actually fail first.** A test that passes before the change is not exercising it. Verify the red state in both modes.
- **Updating tests to pass instead of fixing code.** Tests define expected behavior; a failing test after a change means the implementation is wrong — unless the AC explicitly changes that behavior.
- **Fixing symptoms, not root cause** (issue mode). A null check that hides an upstream data problem is not a fix. Trace to the actual source.
- **Scope creep.** Stick to the AC / issue. Open new stories or issues for adjacent work rather than bundling it.
- **Not updating API contracts.** If a response shape changes, update the TypeScript interface or Pydantic model, the serializer, the OpenAPI spec, and any clients. Partial updates cause runtime failures.
- **Creating parallel paths.** Adding `get_extraction_v2()` alongside `get_extraction()` is dead code. Modify in place and update callers.
- **Incomplete staging** (issue mode). Stage every file that is part of the fix; a partial commit leaves the branch broken.
