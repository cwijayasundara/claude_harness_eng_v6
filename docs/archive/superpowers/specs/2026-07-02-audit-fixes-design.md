# Audit Fixes — 2026-07-02 Fitness Deep-Dive

**Status:** Proposed
**Source:** 2026-07-02 three-agent fitness audit (runtime/e2e trace, grounding-chain audit, Devin-parity + usability). Five ranked fixes, delivered as five independent branches → PRs, in order: **#2 → #5 → #3 → #4 → #1** (smallest-trust-win first, design-heaviest last).

**User decisions recorded:** Fix #1 lives as an **in-session skill** (chosen over symphony_clone daemon / GitHub Action; the skill is trigger-agnostic so those can call it later). Review-comment autonomy: **fix + push with verify-first discipline** (recommended default taken while user was away; a propose-only mode is noted as a future knob, not built now).

---

## Fix #2 — Verification-matrix pre-commit backstop (branch 1)

**Problem.** All five invocation points of `verification-matrix-gate.js` are prompt-discipline — bash commands the orchestrating LLM is instructed to run. The pre-commit hook re-checks contract *shape* (`validateContractShape`) but never the matrix, yet `auto/SKILL.md:131` claims "the pre-commit hook repeats this check deterministically". A session that skips Gate 9 can commit with a stale or failing matrix verdict.

**Design.**
- Extend `checkSprintContract` in `.claude/git-hooks/pre-commit` (after `checkSecurityVerdict`, ~line 197): when `specs/test_artefacts/verification-matrix.json` exists, spawn `node .claude/scripts/verification-matrix-gate.js --phase executed --group <group>` (the same group already resolved from `claude-progress.txt`). Non-zero exit → `fail()` with the gate's output and remediation ("run /evaluate to regenerate runtime evidence, then retry"). This re-runs the **real gate** (single-sourced semantics, including the stale-evidence mtime check from `3bface9`) rather than re-implementing it; it is pure fs/JSON work, so hook latency is negligible. Follow the hook's existing spawn/`shouldBlock` conventions and its loud-fail-open behavior for spawn errors.
- Guard: skip silently when the matrix file is absent (pre-matrix projects, /vibe lanes) — same existence-guard pattern the hook already uses for contracts.
- Fix the false claim: reword `auto/SKILL.md:131` to state exactly what pre-commit re-checks (contract schema shape + `--phase executed` matrix gate), which the backstop makes true.
- Update the `verification-matrix-gate` sensor entry in `harness-manifest.json` (enforcement: pre-commit) and `HARNESS.md`.

**Tests.** Pre-commit integration test round-tripping the real gate script (per CLAUDE.md principle #5): commit blocked on a failing/stale matrix fixture, allowed on a green one, skipped when no matrix exists. `validate-harness-manifest.js` stays green.

---

## Fix #5 — Docs polish (branch 2)

Three small, independent edits; no behavior change.

1. **README "If your run dies" section** — document what already exists: re-invoking `/auto` resumes from `claude-progress.txt` (continuation-window logic + startup smoke check, `auto/SKILL.md:96-106`); a `BUDGET —` stop resumes by raising the cap or `--budget off`; `node .claude/scripts/build-chain.js <prd>` for long unattended runs.
2. **README budget-cap disclosure** — surface the default tiers from `budget-state.js` (balanced: 90 min wall-clock / 200 agents / ~$25 est., plus the other tiers as defined in code) in the autonomy section, so a first `--auto` run's clean budget stop is expected, not a surprise.
3. **Internal-skill markers** — the five unflagged internal micro-skills (`checking-coverage-before-change`, `checking-migration-safety`, `keeping-refactors-pure`, `pinning-down-behavior`, `sprouting-instead-of-editing`) get an explicit internal marker in their frontmatter `description`, **appended after** the existing "Use when…" trigger phrase (never prepended — the trigger phrasing drives auto-invocation and must stay first; this deliberately differs from `seam-finder`'s leading-prefix style, and HARNESS.md will note why). Extend the existing skills-consistency test to require the marker on the internal-skill list.

---

## Fix #3 — Interview-mode BRD grounding (branch 3)

**Problem.** `grounding-check.js` only runs in `--frd` mode; a greenfield build from the Socratic interview has no upstream artifact, so nothing mechanically catches a BRD requirement invented (or dropped) relative to what the human actually confirmed. `HARNESS.md:77` acknowledges the hole.

**Design.** Give the interview a requirement spine of its own and reuse the existing engine unchanged:
- During `/brd` Step 2, as each dimension is confirmed by the human, append the confirmed requirement statements to `specs/brd/interview-requirements.json` — `[{ id: "INT-<n>", text, section: <dimension> }]`, the exact shape `grounding-check.js` takes as its `required` set (verified against `trace-check.js`/`grounding-check.js` sources). Entries are written **at confirmation time**, not synthesized afterward — the artifact must capture what the human signed off, before BRD synthesis can drift.
- BRD requirements in interview mode must carry `traces` citing `INT-n` ids (clarifications `C-n` remain valid optional trace targets, unchanged).
- Step 4.4 stops skipping in interview mode: run `grounding-check.js --frd specs/brd/interview-requirements.json --clarifications specs/brd/clarification-log.json --brd specs/brd/brd-requirements.json --out specs/reviews/brd-grounding.json`. Hard block on `net_new`/`dropped`, same as FRD mode. The skip remains only when *neither* FRD nor interview-requirements exists.
- No script changes needed — `grounding-check.js` is already source-agnostic (`required`/`optional`/`downstream`). The `--frd` flag name is kept (renaming would churn callers for cosmetics); the SKILL text explains the interview file is passed as the required set.
- Update `HARNESS.md:77` (the caveat narrows to "pre-confirmation interview dialogue is human-judged; post-confirmation is deterministic"), the `grounding-check` sensor scope in `harness-manifest.json`, and `/brd` SKILL Step 2 + 4.4 text.

**Tests.** Integration test that round-trips a realistic interview fixture through the **real** `grounding-check.js`: a BRD with an uncited requirement fails `net_new`; a confirmed `INT-n` with no BRD coverage fails `dropped`; a clean pair passes.

---

## Fix #4 — E2E CI template + ownership sensor (branch 4)

Two independent controls in one branch (both close "session-only enforcement" gaps).

**4a. E2E workflow template.** New `.claude/templates/github-workflows/e2e.yml`, copied into target projects by `/deploy` (which already owns runtime artifacts: init.sh, docker-compose) when `e2e/` + `playwright.config.ts` exist. Content: on `pull_request` + `workflow_dispatch` — checkout, setup Node, `npx playwright install --with-deps chromium`, `npx playwright test`. The generated `playwright.config.ts` `webServer` block already self-starts the stack (`docker compose up -d --build`) and `CI=true` in Actions forces a fresh build, so the workflow needs no bespoke startup logic. This closes the "no CI ever re-runs the generated e2e suite" gap and the Gate-5-vs-spec-file divergence risk (spec files now run on every PR, not just Phase 9/9.5).

**4b. Browser-install resilience.** Add an idempotent `npx playwright install --with-deps chromium` step to `/build` Phase 9.5 before the suite runs — chained/resumed sessions can span days and the install currently happens exactly once in `/test` Step 7.

**4c. Ownership sensor.** New `.claude/scripts/ownership-check.js`: parse the ownership entries in `specs/design/component-map.md` into path globs; given a file list (staged files in pre-commit, diff range in `/gate`), report production-source files owned by no component-map entry and outside a standing allowlist (`specs/**`, `docs/**`, test dirs, dotfiles, `.claude/**`). Verdict JSON + exit code, same conventions as the other sensors. Wiring: `/gate` always runs it when `component-map.md` exists; pre-commit gets a `checkOwnership` guarded on the same existence check, hard-block with the existing sensor-waiver mechanism as the escape hatch. Registered in `harness-manifest.json` (traceability axis) + `HARNESS.md`.

**Deferred (recorded, not built):** hash-locking sprint contracts after negotiation ("immutable after negotiation" is currently a stated rule only).

**Tests.** `ownership-check.js` pure-core unit tests + a round-trip against a real component-map.md fixture in the design-template format; template-copy test for `e2e.yml` in the scaffold/deploy suite.

---

## Fix #1 — `/pr-respond`: post-PR CI-failure & review-comment response loop (branch 5)

**Problem.** Every lane stops at "human owns merge": nothing polls an open harness PR for red CI or reviewer comments and acts. Biggest remaining Devin-parity gap.

**Design — two units, deterministic poller + LLM responder:**

**`.claude/scripts/pr-poll.js`** (deterministic, unit-testable with an injected `gh` runner):
- Input: PR number, `--state-file .claude/state/pr-respond-<pr>.json`.
- Uses `gh` (`pr view`, `pr checks`, `api` for review threads) to fetch head SHA, check runs, review comments/threads, review states.
- Diffs against the state file (handled check-run ids per head SHA; replied-to comment ids) and emits JSON: `{ head_sha, failures: [{check, workflow, run_id}], comments: [{id, thread_id, path, line, body, author, resolved}], approved, mergeable }`. Exit 0 with JSON; exit 2 only when `gh` is unavailable/unauthenticated. Never throws mid-parse; malformed API payloads degrade to empty lists with a stderr warning (loud, not silent).

**`.claude/skills/pr-respond/SKILL.md`** — `/pr-respond <pr#> [--watch [minutes]] [--max-cycles N]`:
- Cycle: run `pr-poll.js` → act on each new item → push → record in state file → re-poll.
- **CI failure:** fetch `gh run view <run_id> --log-failed`, classify through the existing `/auto` self-healing classification table (referenced, not duplicated), fix on the PR's head branch, run the mapped local gate before pushing, push, comment on the PR with what changed + evidence.
- **Human review comment:** apply `superpowers:receiving-code-review` — verify the feedback is technically correct first. Valid → implement, push, reply to the thread with the change + test evidence. Wrong or ambiguous → reply with reasoned pushback or a clarifying question; no code change. Comment bodies are fenced as untrusted data (same discipline as symphony's `buildFeaturePrompt`).
- **Bounds:** integrates the existing `budget-state.js` checks each cycle; defaults `--max-cycles 5`; `--watch` polls until the window (default 30 min) elapses or the PR is green with no unhandled comments. On any stop, write a status summary to the state file and print it — clean, resumable.
- **Safety rails:** never force-push; refuse PRs whose head branch the harness did not create (branch-name/state-receipt check); pushes go through the normal pre-commit gates; merge remains human-owned (AUTO_MERGE stays the only merge path).

**Wiring:** standalone on any harness PR; `/build` Phase 11 and `/feature` gain an opt-in `--respond[=minutes]` flag that invokes `/pr-respond --watch` on each opened PR (default **off** this round — flip after the skill is proven). Registered in `HARNESS.md` + `harness-manifest.json` (behaviour axis) and added as the fourth README command card.

**Tests.** `pr-poll.js` pure-core tests (injected runner, no network): new-failure detection across SHA changes, comment dedup, state-file round-trip, gh-missing exit path. Skills-consistency/prompt-wiring tests for the new SKILL + flags.

---

## Delivery & verification (all branches)

Per the established workflow: each fix is its own branch → PR → merge to main; subagent-driven development with fresh-context diff review per task; independent whole-branch review on the strongest model before each PR (CLAUDE.md principle #5). Every new/changed sensor is registered in `harness-manifest.json` and `HARNESS.md` in the same branch (`validate-harness-manifest.js` enforced by `npm test`). All contract/integration tests round-trip real artifacts through the real validators — no hand-built fixture shapes.

## Future work recorded (not in scope)

- Propose-only mode knob for `/pr-respond` review comments.
- symphony_clone PR-watch trigger and/or GitHub Action trigger calling the same skill.
- Sprint-contract hash-lock after negotiation.
- Git-commit-hash / test-run-manifest provenance for the stale-evidence check (mtime is best-effort).
