## SECTION 5: Ratchet Gate (Step 5)

One coding-loop gate. Do not restate the sensor catalog here — `sensor_tier` already selects membership.

| Step | When | What |
|------|------|------|
| Tests | Every group | Project test command (`pytest` / `vitest` / `npm test`) must pass |
| Runner | Every group | `node .claude/scripts/run-gate-checks.js` (default **sensors** lane = `GATE_CATALOG`, filtered by `sensor_tier`). Honor its exit. Same command from `/implement` and from a host that is not Claude Code. Writes `specs/reviews/sensor-checks.json`. The git hook runs this same catalog on staged files. `/gate` uses `--lane gate` for the pack list — do not use that lane here. |
| First-source index | Once, after the first group that writes production files under `backend/`, `frontend/`, or any non-`specs/` source | `node .claude/scripts/navigation-refresh.js --root . --mode first-source`. Fail open on missing Python/wheels/indexer, but log loudly and record `.claude/state/navigation-status.json`. Do not block group 1 on wiki quality. A placeholder graph (`code-graph.meta.json#status` `empty` or `producer` `none`) is **not** brownfield-ready — do not run cycle/hub/clone against it. |
| Security reviewer | Group diff hits auth / PII / persistence / secrets / API boundary | Spawn `security-reviewer`. Missing selected verdict is a fail. No trigger → record `security_review: skipped_no_boundary`. |
| 2-axis review | Every group | One `code-reviewer` (Standards vs Spec). Pre-read only — never approve or merge. Dual independent reviewers only when `review-tier.js` says so. |
| Evaluator | **End of run**, not per group | Once against the running app (API + Playwright if UI), then draft PR. |
| Design-critic | `--mode full` only, **after** the UI slice is green, cap 3 | Skip in lean. See SECTION 9. |

`sensor_tier=standard` (default new web apps) keeps the runner's small always-on set (secrets, test-deletion, types, coverage, stub-smell, live-externals). Cycle, hub, clone, mutation, and security-baseline are **`strict` only**. Sprint-contract pre-commit already no-ops when `sprint-contracts/{group}.json` is absent.

### Tests

```bash
# backend and/or frontend — use the project's commands
cd backend && uv run pytest -x -q && cd ..
cd frontend && npm test && cd ..
```

Zero failures. Honor `quality.test_discipline` (`outcomes` default: tests and code together at the named seam; `tdd` keeps write-lock / red-phase / test-integrity; `at-first` is AT + red receipt for behavior stories).

### Runner

```bash
node .claude/scripts/run-gate-checks.js
```

Non-zero exit **fails the gate**. Do not invoke `mutation-gate.js`, `cycle-gate.js`, `coupling-gate.js`, or `duplication-gate.js` from this skill — they stay in the registry and run only when `sensor_tier=strict` (or `--only`). Fast-lane / docs-only commits still go through the same runner; the registry filters `runsWithoutSource`.

### First-source index

After the first production source exists on a greenfield run:

```bash
node .claude/scripts/navigation-refresh.js --root . --mode first-source
```

Expect `code-graph.meta.json#status` no longer `empty` and `specs/brownfield/wiki/WIKI.md` not the scaffold stub — or a structured skip in `navigation-status.json` (`status: failed` with `error`).

### Security reviewer

Write `specs/reviews/review-context-pack.md` with the changed files, acceptance criteria, and deterministic test output. Inspect for auth/authz, secrets, user input, uploads, network fetch/redirect/proxy, payments, persistence/schema/migrations, API routes, or configured security patterns.

If a trigger fires, spawn `security-reviewer`. Fail when `security-verdict.json#pass === false` (block severities default `critical`/`high`) or the verdict file is missing. Medium/low are WARN/INFO.

### 2-axis code review

```bash
node .claude/scripts/review-tier.js --files <n> --lines <n> [--security-boundary]
```

**Standard:** one `code-reviewer` with two parallel axes. Do not merge their scores.

- **Standards** — code-gen excerpt, learned rules, `REVIEW.md`. Axis: `standards`.
- **Spec** — sealed stories for this group + `specs/design/program-design.md`. Axis: `spec`.

Canonical `specs/reviews/code-review-verdict.json` concatenates both lists; `pass` is false if either axis has a BLOCK.

**Adversarial** only when `review-tier.js` says so (size, `--security-boundary`, `sensor_tier=strict`, or `review.adversarial=always`): two independent instances, merge with `merge-review-verdicts.js --policy union`.

BLOCK findings go to the generator (max 3 fix cycles). Missing verdict is a fail.

### Evaluator (end of run)

When groups are done, spawn the evaluator **once** against the running app: `api_checks` and `playwright_checks` (if UI). Writes `specs/reviews/evaluator-report.md`. Then open a **draft** PR (SECTION 11). Do not merge.

### Design-critic (`--mode full` only)

Run SECTION 9 only after the UI slice's tests + runner are green. Cap 3. Lean skips this entirely.

### Verification matrix

If `specs/test_artefacts/verification-matrix.json` exists, the runner / sprint-contract gate already covers implementation and executed phases. Do not add a third list here. Before a draft PR, `node .claude/scripts/finalize-task-evidence.js` when a task envelope requires it.
