# Superpowers for Brownfield — Behavior-Preserving Change Skills

**Status:** Implemented (2026-06-10) — M1–M3 landed with tests (coverage_map.py, four skills, lane + hook wiring); M4 pressure-testing remains open as follow-up
**Date:** 2026-06-10
**Goal:** refactor/change existing code with a *guarantee structure* that working functionality does not silently break.
**Inspiration:** [obra/superpowers](https://github.com/obra/superpowers) — rigid process skills with Iron Laws, rationalization tables, and Red Flags. Audited: its 14 skills contain **no legacy/brownfield/characterization coverage at all** — this proposal is complementary, not duplicative.

---

## 1. Why the current pipeline is not enough

Our brownfield v2 layer answers *"what is here and where do I cut?"* (code-graph, symbol-map, skeletons, seam-finder). Our lanes answer *"how do I build?"* (TDD gates, lint/typecheck hooks, evaluator ratchet). The unanswered question is the one Michael Feathers calls the **legacy code dilemma**: to refactor safely you need tests, but brownfield code often has none — and nothing in our pipeline today detects that the code about to be edited is *uncovered*, or pins its current behavior before the edit.

The evidence that this is the binding constraint for agents:

- **SWE-CI benchmark**: most models introduced regressions on **75%+ of maintenance tasks**; only the strongest exceeded a 50% zero-regression rate. ([engineerscodex.com/swe-ci](https://www.engineerscodex.com/swe-ci-coding-agent-benchmark))
- **"Refactoring Runaway"** (arXiv 2605.22526): agents tangle refactorings into behavior fixes; tangled commits correlate strongly with broken builds and failed tests.
- **SWE Atlas refactoring rubric**: dominant agent failure modes are *missed call sites* and stale dead code after renames — exactly what our code-graph caller query can prevent, but nothing instructs agents to use it that way.
- **LLM-generated tests often don't bite** (arXiv 2603.23443): generated tests frequently encode shallow patterns rather than behavior — so generated pin-downs need a "watch it fail" checkpoint, like TDD's RED.

## 2. The design: four rigid skills + two scripts

Four superpowers-style skills (Iron Law, rationalization table, Red Flags, closing checklist, <500 words each, scripts in supporting files), composed via `REQUIRED SUB-SKILL:` markers and wired into `/refactor` and `/change`. Together: **skill 1 routes, skill 2 pins, skill 3 escapes, skill 4 keeps the diff honest.**

### Skill 1 — `checking-coverage-before-change` (the router)

> **Iron Law:** `NO EDIT TO A SYMBOL UNTIL YOU KNOW WHICH TESTS COVER IT`

Deterministic preflight that joins **coverage contexts** with the code-graph's symbol line ranges:

- Python: `coverage.py` with `dynamic_context = test_function` (or `pytest-cov --cov-context=test`) writes a SQLite `.coverage` DB mapping *test → executed lines*. One SQL query against a symbol's `start–end` range answers "which tests cover `UserService.create_user`?"
- JS/TS: `nyc/istanbul --reporter=json` per-file statement maps intersected with symbol ranges (coarser: file/statement level, no per-test contexts — documented limitation).

New script `coverage_map.py` (vendored next to `code_index/`): reads `.coverage` / `coverage/coverage-final.json` + `code-graph.json`, emits per-symbol verdicts:

```json
{ "symbol": "py:api/users.py#UserService.create_user",
  "verdict": "COVERED", "tests": ["tests/test_users.py::test_create"] }
{ "symbol": "py:api/users.py#save", "verdict": "UNCOVERED" }
```

- **COVERED** → the listed tests are the *fast regression oracle*: run exactly them before and after the change.
- **UNCOVERED** → mandatory handoff to Skill 2 (or Skill 3 if unpinnable).

Red Flags: "it's a small change" · "the evaluator will catch it later" · "coverage data is stale, skip it" (reality: regenerating it is one test run).

### Skill 2 — `pinning-down-behavior` (the centerpiece)

> **Iron Law:** `NO CHANGE TO UNCOVERED CODE WITHOUT A PIN-DOWN TEST YOU HAVE WATCHED BITE`

Characterization tests at the nearest observable seam — asserting what the code **does**, not what it should do:

1. Take the top seam from `seams-<goal>.md` (seam-finder; already wired into `/change`).
2. Generate snapshot/approval tests there: **syrupy** (pytest snapshots, masking matchers for timestamps/IDs) or **pytest-regressions** for Python; **Jest/Vitest `toMatchSnapshot()`** for JS; **ApprovalTests `verify_all_combinations`** when one seam takes a grid of inputs; **VCR.py / Polly.js** cassettes when the seam crosses HTTP.
3. Run green against *current* code.
4. **Mutation-smoke checkpoint** (the characterization analog of TDD's "verify RED", and the answer to tests-that-don't-bite): deliberately flip one behavior in the target symbol, confirm the pin-down suite FAILS, revert. One test run; no mutation-testing framework needed.

Rationalization table must include the two killers:
- *"Current behavior looks like a bug — I'll fix it while pinning."* Reality: pin the bug too. Characterization asserts what IS; file the bug as a separate `/change`.
- *"Snapshot failed after my refactor — I'll just `--snapshot-update`."* Reality: that diff **is** the regression alarm. Updating a snapshot inside a refactor is a Red Flag, full stop.

Optional escalation path (documented inside this skill, not a separate one): Scientist/laboratory-style old-vs-new side-by-side execution for critical-path service refactors. Default lane: pin-down suite against old, then unchanged against new — ~80% of the value, ~5% of the cost.

### Skill 3 — `sprouting-instead-of-editing` (the escape hatch)

> **Iron Law:** `IF YOU CANNOT PIN IT, DO NOT EDIT IT — SPROUT BESIDE IT`

For the worst cases — unpinnable god functions, seams scored below threshold — use Feathers' moves instead of in-place edits:

- **Sprout method/class**: new behavior goes in a new, fully-TDD'd unit (the existing pre-write TDD gate applies naturally); the legacy file is touched at **exactly one call line** — verified mechanically via the code-graph (the diff to the legacy file must intersect one symbol, one line).
- **Wrap method**: rename old, add same-signature new that calls old + the addition.

Decision table: seam-finder `total_score ≥ 0.5` and pinnable → Skill 2; below → sprout/wrap. God files flagged in `skeletons/` default to sprout. Red Flags: "I'll just quickly inline it" · "the function is only 30 lines, editing is fine".

### Skill 4 — `keeping-refactors-pure` (the anti-tangling discipline)

> **Iron Law:** `A REFACTOR COMMIT CHANGES NO BEHAVIOR; A BEHAVIOR COMMIT REFACTORS NOTHING`

Directly motivated by Refactoring Runaway + SWE Atlas. Checkpoints:

1. Before commit, classify every hunk **structural** or **behavioral**; mixed → split the commit.
2. In a refactor commit: existing tests and pin-down snapshots pass **byte-identical** — no snapshot updates, no test edits.
3. Renamed/moved symbols: enumerate all callers via `code-graph.json` edges and verify each updated — counters the missed-call-site failure mode; no orphaned dead code or imports left behind.
4. API surface: if an OpenAPI spec exists, gate on **oasdiff** (machine-readable breaking-change report) in the pre-commit hook.
5. Ratchet: test count and changed-line coverage (**diff-cover** `--fail-under`) may not decrease.
6. Failing test decision procedure (agents are bad at this — arXiv 2605.06125): a test may be *updated* only in a behavior commit, citing the story/issue that authorizes the behavior change.

## 3. Wiring into the existing pipeline

| Hook point | Change |
|---|---|
| `/refactor` Step 2.5 (new) | `REQUIRED SUB-SKILL: checking-coverage-before-change` for every target symbol; uncovered → Skill 2/3 before any edit. Step 6 commit → Skill 4. |
| `/change` Step S2 | Same preflight after the existing seam-plan read; behavior commits follow Skill 4's split discipline. |
| `/vibe` | Preflight only as a cheap check: an UNCOVERED verdict on the touched symbol escalates out of `/vibe` (consistent with its existing escalation rules). |
| `/auto` generator teammates | Spawn prompts gain one line: invoke the preflight before editing existing (non-sprint-new) files. |
| `pre-commit` git hook | Add Skill 4's mechanical checks: snapshot-file edits forbidden when the commit message says `refactor:`; diff-cover ratchet. |
| `coverage map freshness` | `graph-refresh.js` already drains dirty files at Stop; the coverage DB refreshes on each full test run (it is a *cacheable artifact* — stale is detectable by mtime vs last test run, and the skill regenerates with one suite run). |

New pip/npm deps (all optional, fail-open like the tree-sitter wheels): `pytest-cov` (usually present), `syrupy`, `diff-cover` on Python; none required on JS (Jest snapshots are built in, nyc JSON likewise). `oasdiff` only where an OpenAPI spec exists.

## 4. What we deliberately skip

- **Full mutation testing** (mutmut/Stryker) — too slow for agent loops; the single-mutant smoke gives the "does it bite?" guarantee for one test run. Stryker incremental mode noted as future option.
- **Always-on side-by-side execution** (Scientist/diferencia) — high setup, needs traffic; documented as Skill 2's escalation path only.
- **A new agent** — these are process skills + two small scripts; no new agent roles, no MCP servers, no daemons.

## 5. Implementation plan

1. **M1 — `coverage_map.py`** + golden-file tests (reuse the code-index fixture repo; add a tiny test suite to it so coverage contexts exist). CLI: `--graph code-graph.json --coverage .coverage --symbols <ids…>` → JSON verdicts.
2. **M2 — the four skills** authored to the superpowers template (Iron Law / rationalizations / Red Flags / checklist), each <500 words, scripts referenced not inlined.
3. **M3 — lane wiring**: the table in §3 (SKILL.md edits + pre-commit additions + teammate spawn-prompt line), plus `init-sh.template` optional deps.
4. **M4 — pressure-testing** (the obra method): adversarial scenarios with time pressure and sunk-cost framing ("the refactor is already written, snapshots are red, $5k/min"), mine the agent's actual rationalizations back into the Red Flags tables.

## 6. Open questions

1. Coverage tooling assumption OK? (Python: pytest-cov contexts; JS: nyc JSON without per-test granularity — coarser but workable.)
2. Seam-score threshold for pin-vs-sprout: 0.5 to start, tune later?
3. Should the `/vibe` UNCOVERED escalation be a hard block or a warning? (Proposal: hard block — `/vibe` is exactly where silent breakage hides.)

## 7. Key sources

- obra/superpowers skill anatomy: https://github.com/obra/superpowers · https://blog.fsck.com/2025/10/09/superpowers/
- Feathers' moves & characterization testing: https://understandlegacycode.com/blog/key-points-of-working-effectively-with-legacy-code/ · https://understandlegacycode.com/blog/characterization-tests-or-approval-tests/
- Agent regression evidence: https://www.engineerscodex.com/swe-ci-coding-agent-benchmark · https://arxiv.org/html/2605.22526v1 (Refactoring Runaway) · https://scale.com/blog/swe-atlas-complete · https://arxiv.org/html/2603.23443v1 (LLM tests under evolution) · https://arxiv.org/html/2605.06125v1 (test evolution)
- Tooling: https://github.com/syrupy-project/syrupy · https://approvaltests.com/ · https://coverage.readthedocs.io/en/latest/contexts.html · https://github.com/Bachmann1234/diff_cover · https://github.com/oasdiff/oasdiff · https://github.com/github/scientist
