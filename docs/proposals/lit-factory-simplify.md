# P4 — Make `--full` small (after P3)

Status: **T1–T5 implemented. T6 ran 2026-08-15** (upgrade + T2 runner on
`shortlink-p3`; did not re-plan or merge). Findings below.
Audience: this harness repo. Parent contract: `docs/proposals/lit-factory-full.md`.
P0–P3 are done. This is **not** a new `--slim` lane.

P3 proved the plan machine (four gates + seal + draft PR) and showed the
coding machine is still bulky, hook-dependent, and silent about wiki/graph.

## Goal

A freshly scaffolded project can plan in one sitting, code in a second
session, and open a draft PR — with a **small, always-on** control set that
actually runs. Everything else is `strict` or off until a graph / security
boundary exists.

## Invariants (do not drop)

Same as lit-factory:

- Four human plan gates on the interactive path.
- Seal required before `/auto --sealed`.
- Independent check vs sealed `features.json` before a non-draft merge
  (evaluator at **PR time**, not every story).
- Computational sensors on the write path: lint, types, secrets,
  coverage floor, test-deletion.
- Security reviewer when the diff hits auth / PII / persistence.
- Human reads the PR. Agent review is a pre-read, never approve/merge.

## What P3 actually showed

| Finding | Evidence |
|---|---|
| Seal file missing from core scaffold | `packs.json` kernel has `plan-approval` / `plan-confidence`, not `plan-seal`. Copied by hand in `shortlink-p3`. |
| Wiki / code-graph stay placeholders | `shortlink-p3/specs/brownfield/code-graph.meta.json` still `producer: none` after the whole app shipped. |
| First-window `/auto` never indexes | Skill only *consumes* a graph (cycle/coupling). It never runs `/code-map` or `graph-refresh` after the first source files exist. |
| Sensors did not run | P3 coding wrote files outside Claude Code hooks. `/auto` Gate 5 is skill prose, not one runner. Pytest/vitest ran; mutation, coverage-diff, secrets, evaluator, critic, security-reviewer, 2-axis reviewer did not. |
| Gate list is a second product | SECTION 5 lists 8+ sub-gates (evaluator, critic, cycle, hub, clone, mutation, matrix executed) that diverge from `sensor_tier` (`cycle`/`coupling`/`duplication` are already `strict` only). |
| Critic / evaluator / living wiki | Promised by `--full`; not required for a reviewable first PR. |

## Target coding loop (this is the product)

After seal, `/auto --sealed` does **only** this:

1. `plan-seal.js check` (hard block).
2. Load the sealed pack only (already P2).
3. Implement the next group at named seams (`quality.test_discipline: outcomes`).
4. Run **one** command: `node .claude/scripts/run-gate-checks.js` (the pre-commit registry, filtered by `sensor_tier`). Do not restate each sensor in the skill.
5. After the **first** production source commit of a greenfield run: index once (`code-map` / `graph-refresh`). Wiki and graph become real. Not a gate on group 1.
6. If the group diff hits auth / PII / persistence: spawn security-reviewer.
7. One 2-axis `code-reviewer` (Standards vs Spec). Pre-read only.
8. When groups are done: evaluator **once** against the running app (API + Playwright if UI), then draft PR + walkthrough. Do not merge.

`--mode lean` = same loop, skip design-critic (already).
`--mode full` = same loop, design-critic **only after** the UI slice is green, **cap 3**.
`sensor_tier=strict` = today’s extra ratchets (mutation, cycle, coupling, duplication, security-baseline).

No third lane.

## Standard sensor set (shrink)

`sensor_tier=standard` (default new web apps) keeps only:

- `secret-scan`
- `test-deletion-guard`
- `type-check`
- `coverage-ratchet-py` / `coverage-ratchet-js`
- `stub-smell-gate`
- `live-externals`

Move to **`strict` only** (already there, or move now):

- `mutation-smoke`
- `cycle-detection`, `coupling-ratchet`, `duplication-ratchet`
- `security-baseline`, `secure-baseline-wiring`
- `sprint-contract` (skip unless a contract file exists)
- `test-integrity` (only if `test_discipline=tdd`)
- `at-first-gate` (only if `test_discipline=at-first`)
- `legacy-discipline-proof`, `sprout-diff` (only if brownfield graph is real)

Unknown new gates stay fail-safe (run) **or** require an explicit tier — pick
“require a tier” so the registry cannot grow silently.

## Tickets (implement in this order, separate small PRs)

### T1 — Seal ships with core scaffold

Add `plan-seal` to `.claude/config/packs.json` kernel `script` list (next to
`plan-approval`). Add a scaffold-copy / apply test: a `core` profile target
must contain `.claude/scripts/plan-seal.js`. Do not document a manual copy.

### T2 — One runner is the sensor layer

`/auto` SECTION 5: delete the duplicated gate cookbook. After tests pass, run
`run-gate-checks.js` and honor its exit. Same command from `/implement` and
from a host that is not Claude Code (so Grok / `claude -p` still get sensors).
If `core.hooksPath` is set, commits still run the same registry — no second list.

Update `auto/references/section-5-5-ratchet-gate-step-5.md` to a short table:
tests → runner → (optional) security reviewer → 2-axis review → (end) evaluator.

### T3 — Index after the first source exists

First-window `/auto`, after the first group that writes production files under
`backend/` or `frontend/` (or any non-`specs/` source):

```text
node .claude/scripts/nav-query.js refresh
# or the existing graph-refresh / code-map incremental path
```

Hard requirement: `code-graph.meta.json#status` is no longer `empty` and
`wiki/WIKI.md` is not the scaffold stub. Fail open on missing Python/wheels
(same as today’s hook), but **log loudly** and record `navigation-status.json`.
Do not block group 1 on wiki quality.

`/auto` must not treat an empty placeholder graph as “brownfield is ready.”

### T4 — Shrink default `/auto` and `standard`

Align SECTION 5 and `sensor-tier.js` with the set above. Evaluator and
design-critic move to **end of run / UI-green**, not per group. Cycle, hub,
clone, mutation: `strict` only. Sprint-contract pre-commit: skip when no
`sprint-contracts/{group}.json` exists.

Do **not** delete the strict scripts. Demote them.

### T5 — Tests

- Core scaffold includes `plan-seal.js`.
- `/auto` corpus: SECTION 5 names `run-gate-checks.js` and does not require
  critic / mutation / cycle on `standard`.
- A fixture with one `.py` file + refresh leaves `code-graph.meta.json` not
  `empty` (or skips loudly with a structured reason).
- `isGateEnabled('standard', 'mutation-smoke') === false` after T4.
- Existing `sealed-auto-pack` / `lean-review-surface` tests stay green.

### T6 — Prove it (after `/clear`, not in the implementation transcript)

Re-scaffold or `scaffold-upgrade` `shortlink-p3` (or a new sibling). Confirm
`plan-seal.js` is present without a hand copy. Run `/auto --sealed` **inside
Claude Code** (so hooks fire) or via the T2 runner. Expect: real graph/wiki
after group 1, `run-gate-checks` in the log, draft PR, no merge.

Do not re-research Devin/Dex. Do not add features.

### T6 result (2026-08-15)

Ran against sibling `shortlink-p3` (P3 product + draft PR already existed).
Discarded the ad-hoc P4 overlay, then:

```text
node .claude/scripts/scaffold-upgrade.js --target <shortlink-p3> \
  --plugin-source <this-harness>/.claude --profile full --include-skills --apply
```

A separate `copyScaffoldTree(..., 'core')` into a temp dir also produced
`.claude/scripts/plan-seal.js` (no hand copy). After upgrade, that file
byte-matches this harness.

| Expectation | Result |
|---|---|
| `plan-seal.js` from core / upgrade | **Pass.** Present; matches harness. |
| `plan-seal.js check` | **Fail.** `features.json` sha changed in the P3 implement commit (`6decb1…` → `92c87b…`). Seal not rewritten. `/auto --sealed` would hard-block until re-approval + `plan-seal.js write`. |
| First-source graph / wiki | **Pass.** `navigation-refresh.js --mode first-source` → `producer: vendored-ast`, 32 files, wiki is not the stub, `navigation-status.json` `status: fresh`. |
| T2 runner actually runs | **Pass (ran).** `pytest` 12/12, vitest 1/1, then `run-gate-checks.js` wrote `specs/reviews/gate-checks.json`. |
| `standard` does not start critic / mutation / cycle | **Pass.** `isGateEnabled('standard', 'mutation-smoke'\|'cycle-detection'\|'coupling-ratchet'\|'duplication-ratchet') === false`. Runner results do not include those ids. |
| Draft PR, no merge | **Pass.** https://github.com/cwijayasundara/shortlink-p3/pull/1 still draft, not merged. Product not re-planned. |

T2 residue (fixed after T6): default `run-gate-checks.js` now runs
`GATE_CATALOG` (writes `specs/reviews/sensor-checks.json`). `/gate` uses
`--lane gate` for the pack list. `--only` still selects the pack lane.

Seal follow-up (2026-08-15): `features.json` live fields (`passes`,
`last_evaluated`, `failure_reason`, `failure_layer`) are excluded from the
plan-approval and plan-seal digest (`plan-artifact-digest.js`). Identity
edits still void both. Existing receipts that stored a raw-file hash of
`features.json` need that one sha rewritten to the identity digest (or a
spec re-approval) after upgrade — then `/auto --sealed` stays open.

Did **not** re-run `/auto --sealed` from an empty product tree (out of
scope: do not re-plan; app already shipped in P3). The T2-runner path is
what this ticket allowed.

## Explicitly out of scope

- A new `--slim` / `--lite` planning dialect.
- Rewriting OpenWiki, DeepWiki, or the AST indexer.
- Deleting `/gate`, critic, mutation, or cycle scripts.
- Merging the shortlink PR.
- Re-planning shortlink.

## Done when

- A `core` scaffold can seal without copying files by hand.
- `/auto --sealed` on `standard` cannot start critic / mutation / cycle unless
  the tier or a UI-green critic step says so.
- Sensors run via one script even when git hooks did not fire.
- First source commit produces a non-placeholder graph/wiki (or a loud skip).
- The human-facing `/auto` skill for Gate 5 fits in one screen.

## Resume prompt (paste after `/clear`)

```
Implement P4 from docs/proposals/lit-factory-simplify.md.
P0–P3 are done. Do not re-research Devin/Dex. Do not start another prove-it until T1–T5 land.
Implement T1 then T2 then T3 then T4 then T5, small PRs or one PR if it stays tight.
Keep /brd /spec /design /test as human gates. Do not add a --slim lane.
```
