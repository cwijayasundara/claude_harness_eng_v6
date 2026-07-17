## SECTION 5: Ratchet Gate (Step 5)

After the agent team completes, run the ratchet gate. The ratchet is monotonic: progress never regresses. Eight sub-gates, mode-dependent:

| Gate | Full | Lean |
|------|------|------|
| 1. Unit tests (pytest, vitest) | Yes | Yes |
| 2. Lint + types (ruff, mypy, tsc) | Yes | Yes |
| 3. Coverage >= baseline + mutation-smoke (test adequacy) | Yes | Yes |
| 4. Architecture (files exist, schema validation) | Yes | Yes |
| 5. Evaluator (API + Playwright vs running Docker) | Yes | Yes |
| 6. Design critic (vision scoring, GAN loop) | Yes | No |
| 7. Adaptive security review (security-reviewer only on security/data/API boundary, block on critical/high) | Yes | Yes |
| 8. Fresh-context code review (code-reviewer, block on structure/correctness defects) | Yes | Yes |

**Lean** differs from **Full** only at Gate 6: it does **not** run the design-critic vision loop at all. Every other gate — including the Gate 7 adaptive security policy, Gate 8 code review, and the Gate 5 evaluator — runs in both modes. There is no mode that skips the evaluator, and there is no mode that can silently bypass a required security review; that is the whole point of the ratchet.

### Fast Lane (trivial commits)

The Fast Lane is a per-*commit* optimization (not an execution mode): for a commit that introduces no production logic, skip the expensive **gates 4, 5, and 6** (architecture, evaluator, design-critic). It applies to commits that ONLY contain:
- Lint/format fixes (ruff auto-fix, eslint --fix)
- Documentation updates (.md files only)
- Type annotation fixes (no logic changes)
- Learned-rules updates

**Gates 1, 2, 3, and 7 still run** — tests, lint/types, coverage, **and the adaptive security policy**. On docs/config-only changes the policy records `security_review: skipped_no_boundary`; if a "trivial" commit quietly touches a secret, auth, API, persistence, or env boundary, security review is required and a missing verdict blocks.

Detection: take the Fast Lane only when `git diff --cached --name-only` shows **no** files with a source extension (`.py`/`.ts`/`.tsx`/`.js`/…) — i.e. only `.md`, config, or annotation-only changes — or the commit message starts with `fix: lint`, `style:`, or `docs:`. When in doubt, run the full ratchet.

This prevents the expensive evaluator from blocking trivial housekeeping changes.

For small work requested outside `/auto`, use `/vibe` instead of starting the autonomous loop. `/vibe` applies the same fast-lane idea at interactive scale: micro-contract, narrow edits, targeted checks, and reviewer enforcement without sprint contracts or full SDLC artifacts.

### Gate 1 — Unit Tests

```bash
cd backend && uv run pytest -x -q && cd ..
cd frontend && npm test && cd ..
```

Both must pass with zero failures. The `-x` flag stops at first failure for fast feedback.

### Gate 2 — Lint + Types

```bash
# Backend
uv run ruff check . && uv run mypy src/
# Frontend
npm run lint && npm run typecheck
```

All four commands must exit with code 0.

### Gate 3 — Coverage >= Baseline

```bash
uv run pytest --cov=src --cov-report=term-missing -q | grep "^TOTAL" | awk '{print $NF}'
```

Compare the result with `.claude/state/coverage-baseline.txt`. The new coverage percentage must be **greater than or equal to the baseline AND >= 80% (hard floor)**. If it drops below either threshold, the gate FAILS — even if all tests pass.

**Per-diff coverage (catches dark code the repo-wide average hides).** The repo-wide number can rise while this group ships a large untested surface, as long as other files carry the average. So in addition to the ratchet, measure coverage over **only the files this group changed**. Emit a machine-readable coverage summary (`pytest --cov --cov-report=json:coverage.json`, or Istanbul/vitest `--coverage --coverage-reporter=json-summary`), then:

```bash
node .claude/scripts/coverage-diff.js \
  --coverage coverage.json \
  --diff-base "$(git merge-base HEAD main)" \
  --floor "${HARNESS_DIFF_COVERAGE_FLOOR:-80}" \
  --history .claude/state/coverage-history.jsonl \
  --label "$GROUP_ID"
```

Exit 1 (per-diff coverage below the floor) **FAILS the gate** even when the repo-wide ratchet passes; a group with no measurable changed files passes (nothing to measure). The per-diff floor defaults to 80% and is overridable via `project-manifest.json#execution.diff_coverage_floor` (or the `HARNESS_DIFF_COVERAGE_FLOOR` env). Each run appends a record to `coverage-history.jsonl` for trend visibility.

**Coverage policy (ref: "AI is forcing us to write good code" by Steve Krenzel):**
- **Floor: 80%.** No commit may drop below this — repo-wide AND on the group's diff. The ratchet gate BLOCKS.
- **Target: 100%.** Every line the agent wrote must be verified by a test. At 100%, any uncovered line is an unambiguous signal of missing verification.
- **TDD enforced:** Tests are written BEFORE implementation. The generator and teammates must follow the red-green-refactor cycle: write failing test → implement → verify pass → commit.

**Mutation smoke — does the suite actually *bite*? (gap G7).** Coverage proves a line ran; it does not prove a test would fail if that line broke. AI-generated suites routinely hit 100% coverage while asserting nothing at the boundary. So the test-adequacy gate also runs a bounded, **diff-scoped** mutation smoke over the group's changed production files:

```bash
node .claude/scripts/mutation-gate.js --staged   # or pass explicit changed files
```

It applies one high-signal operator mutation at a time (`>`↔`>=`, `==`↔`!=`, `&&`↔`||`, boolean literals) to the changed code and re-runs the project test command; a **survivor** is a mutation no test killed — behavior the suite does not verify. Below the threshold (default 0.8 of mutants killed) the gate **BLOCKS**, naming each survivor's file:line and the exact flip so the generator adds the missing boundary/false-branch assertion. The gate is enforced deterministically by the pre-commit hook during `/auto` builds (scoped to an active sprint group; bounded by `--max-mutants`), and is disabled with `HARNESS_MUTATION_GATE=off`. A language whose test command can't be discovered is skipped loudly, never silently passed.

After coverage and mutation gates pass, run:

```bash
node .claude/scripts/verification-matrix-gate.js --phase implementation --group "$GROUP_ID"
```

This blocks if required unit, integration, or E2E trace sidecars are missing for the group's matrix obligations.

### Gate 4 — Architecture Checks

Spawn evaluator to verify `architecture_checks` from the sprint contract:
- All files in `files_must_exist` must be present on disk.
- Schema validation against `specs/design/api-contracts.schema.json` if specified.

Also run the **import-cycle ratchet** (gap G8) when a code-graph exists (it does in brownfield builds; `/code-map` or the graph-refresh hook keeps it fresh):

```bash
node .claude/scripts/cycle-gate.js   # exit 1 if the group ADDED an import cycle
```

Cycles are a monotonic ratchet like coverage — the count may only stay equal or drop. A new cycle **BLOCKS** with the offending cycle named; removing cycles ratchets the baseline (`.claude/state/cycle-baseline.txt`) down. No graph → skipped loudly, never silently passed.

Also run the **unstable-hub ratchet** (gap G18) alongside it, same code-graph, same cadence:

```bash
node .claude/scripts/coupling-gate.js   # exit 1 if the group ADDED an unstable hub
```

Unstable hubs (fan_in >= 5 and instability >= 0.8 — the same thresholds `coupling-report.md` and the drift monitor already use) are a monotonic ratchet like cycles: the count may only stay equal or drop. A new unstable hub **BLOCKS**, naming the specific new hub(s) with fan-in/instability numbers and remediation guidance (extract a narrower interface or split responsibilities to lower fan-in); removing unstable hubs ratchets the baseline (`.claude/state/coupling-baseline.txt`) down. No graph → skipped loudly, never silently passed. This closes the gap where coupling/instability data existed only on the drift cadence (`npm run drift`) or in the on-demand `coupling-report.md`, never fed back to the agent at commit time.

Also run the **duplication ratchet**, independent of the code-graph (it wraps `jscpd` directly over the changed source):

```bash
node .claude/scripts/duplication-gate.js   # exit 1 if the group ADDED a new code-clone occurrence
```

Clone occurrences are a monotonic ratchet like cycles and unstable hubs: the count may only stay equal or drop. A new clone **BLOCKS**, naming the offending file(s); removing duplication ratchets the baseline (`.claude/state/duplication-baseline.txt`) down. `jscpd` not installed → skipped loudly, never silently passed.

### Gate 5 — Evaluator (API + Playwright)

Spawn evaluator with the full sprint contract. The evaluator runs:
- All `api_checks` against the live Docker stack.
- All `playwright_checks` against the running UI.

The evaluator writes its report to `specs/reviews/evaluator-report.md`.

### Gate 6 — Design Critic (Full Mode Only)

Spawn design-critic on every page listed in the sprint contract's `design_checks`. The critic screenshots each page, scores visual fidelity, and returns PASS/FAIL per check. See SECTION 9 for the full GAN loop if scores are below threshold.

### Gate 7 — Adaptive Security (Full + Lean)

First write `specs/reviews/review-context-pack.md` with the changed files, acceptance criteria, relevant DeepWiki/code-map links, and deterministic test output. Then inspect the changed files for security triggers: auth/authz, secrets, user input handling, uploads/downloads, network fetch/redirect/proxy code, payments/billing, persistence/schema/migrations, API routes/controllers/middleware, or configured security patterns.

If a trigger fires, spawn the `security-reviewer` agent against the group's changed files. It writes `specs/reviews/security-verdict.json`. The gate **FAILs** if `security-verdict.json#pass === false` — i.e. any finding whose `severity` is in the contract's `contract.security_checks.block_severities` (default `["critical", "high"]`). Medium/low findings are WARN/INFO and do not fail the gate. A missing selected verdict file is a FAIL (`failure_layer: "security"`). This gate does not need the Docker stack and can run concurrently with Gate 5.

If no trigger fires, do not spawn `security-reviewer`; record `security_review: skipped_no_boundary` in `review-context-pack.md`. This is an explicit policy decision, not a silent skip.

### Gate 8 — Fresh-Context Code Review (Full + Lean)

Resolve review mode first:

```bash
node .claude/scripts/review-tier.js --files <n> --lines <n> [--security-boundary]
```

**Standard mode:** spawn one `code-reviewer` on the group's diff (commit range or branch, acceptance criteria, and `specs/reviews/review-context-pack.md` — **nothing else from this session**). It reads the diff cold, hunting structure and correctness defects, and writes `specs/reviews/code-review-verdict.json`.

**Adversarial mode** (auto when `sensor_tier=strict`, security-boundary, or file/line thresholds from `project-manifest.json#review`; or `review.adversarial=always`): spawn **two independent** `code-reviewer` instances (fresh context per instance; no shared conversation). Each writes `code-review-verdict-a.json` / `code-review-verdict-b.json`. Merge with default **union** policy (any BLOCK fails):

```bash
node .claude/scripts/merge-review-verdicts.js \
  --a specs/reviews/code-review-verdict-a.json \
  --b specs/reviews/code-review-verdict-b.json \
  --policy union
```

Canonical outputs remain `code-review-verdict.json` + `code-review.md`; audit trail at `specs/reviews/adversarial-review-audit.json`. If an instance errors/times out, fail safe to the stricter outcome.

The gate **FAILs** on any BLOCK finding or a missing verdict file. Route BLOCK findings to the generator (max 3 fix cycles). Runs concurrently with Gates 5 and any selected Gate 7 security review — it needs only the repo, not the running app. Do not paste progress logs or builder reasoning into reviewer spawn prompts.

### Gate 9 — Executed Matrix Gate

Before entering PASS handling for the group, run:

```bash
node .claude/scripts/verification-matrix-gate.js --phase executed --group "$GROUP_ID"
```

This blocks if the group's evaluator report or trace sidecars failed to execute required matrix rows.

### Phase 9.5 — Pre-PR Executed Matrix Gate

Before a Phase 9.5 pre-PR proof or draft PR for one group/cluster, run the
executed matrix gate scoped to that group:

```bash
node .claude/scripts/verification-matrix-gate.js --phase executed --group "$GROUP_ID"
```

Before an integrated PR or final completion claim for the whole wave/product,
run the full executed matrix gate:

```bash
node .claude/scripts/verification-matrix-gate.js --phase executed
```

This blocks if evaluator execution failed to cover required matrix rows.

---
