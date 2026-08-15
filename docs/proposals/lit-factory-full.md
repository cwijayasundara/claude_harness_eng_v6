# Efficient `--full` as a lit factory

Status: **P0–P3 done. P4 T1–T6 + follow-ups landed 2026-08-15** —
`docs/proposals/lit-factory-simplify.md` (T2 one runner; features.json
identity digest). This file stays the plan/seal contract.
Audience: this harness repo. Goal: keep `/brd` → `/spec` → `/design` → `/test` as human gates, then let `/auto` code until a **draft PR**. A human reads the code. Merge stays human.

This is **not** a new `--slim` lane. It is `--full` made efficient.

## Invariants (do not drop)

- Four human plan gates on the interactive path.
- Independent evaluator vs sealed `features.json`.
- Computational sensors on the write path (lint, types, secrets, coverage, test-deletion).
- Security reviewer at `/gate` when the diff hits auth/PII/persistence.
- Human reads the PR. Agent review is a pre-read, never approve/merge.

## What `--full` vs `--lean` means after this

| | `--mode full` | `--mode lean` |
|---|---|---|
| Plan | four gates + `/seal` | same |
| Coding | `/auto --sealed` to draft PR | same |
| UI critic | **after** the slice is functionally green, **cap 3** | off |
| Review | 2-axis agent pre-read + human | same |

`--auto` (headless) is the exception: it writes a **waived** seal and continues. That is not the default `--full` path.

## P0 — split the two machines

1. `plan-seal.js write|check` writes `specs/reviews/plan-seal.json` (sha256 of approved artifacts). Void if those files change.
2. Gated `/build` and `--autonomous` **stop after `/seal`**. Print: `/clear` then `/auto --sealed`.
3. `/auto` runs `plan-seal.js check` as a hard block (plus existing `plan-approval.js check --phase all`).
4. Design-critic default `max_iterations` **3**, not 10.
5. Headless `--auto` writes a waived seal and may continue in-session.

## P1 — lean the four outputs (still four gates)

Done. Contract: `.claude/skills/plan-review-loop/references/lean-review-surface.md`.

Each phase: one human doc + one machine file. `specs/design/program-design.md` is required. Specs are vertical slices, not layer ladders. `/test --plan-only` names seams + writes the matrix; Playwright and AT source wait until implement. Inferential phase-eval is `--eval` only.

## P2 — coding harness + lit review

**Do this after `/clear`.** Do not implement P2 in a 350K+ planning transcript.

`/auto --sealed` loads only the sealed pack. Outcome tests at named seams (`quality.test_discipline: outcomes` default). One 2-axis reviewer (Standards vs Spec). Draft PR. `/review` groups the diff by slice next to program-design. `/pr-respond` patches comments. Human merges.

### P2 tickets (implement in this order)

1. **Sealed context pack.** After `plan-seal.js check` passes, `/auto` SECTION 2 may read only: `specs/reviews/plan-seal.json` artifact list, `features.json`, `specs/design/program-design.md`, `specs/design/component-map.md`, `specs/test_artefacts/test-plan.md` (seams), `specs/test_artefacts/verification-matrix.json`. Do not reload `/brd` or `code-gen/SKILL.md` in full. Wire in `auto/references/section-2-2-context-recovery-step-1-of-every-iteration.md` + a test that the corpus names this pack.

2. **`quality.test_discipline`.** Add `outcomes` (default) | `tdd` | `at-first` to `project-manifest.json` schema / scaffold-render. `outcomes` = tests + code together at the named seams; coverage + mutation-smoke + test-deletion stay. `tdd` keeps the current write-lock / red-phase / test-integrity stack. `at-first` = AT + red receipt for behavior stories only. Default new scaffolds to `outcomes`. Wire `code-gen` Testing Rules and `/implement` to read the knob.

3. **2-axis reviewer in the loop.** `/auto` Gate 8 / `/implement` Step 7: one `code-reviewer` with Matt's two axes (Standards vs Spec), parallel sub-agents, no merge of scores. Dual adversarial only when `review-tier.js` says so (size or `--security-boundary`). Spec axis reads sealed stories + program-design, not the builder transcript.

4. **`/review` (or extend `/gate` Step review).** Group the diff by story/slice (use `component-map.md`), print the matching `program-design.md` section beside each slice. Agent pre-read posts comments; never approve or merge. Human reads. `/pr-respond` already patches comments — do not rebuild it.

5. **Draft PR is the stop.** `/auto --sealed` ends at an open draft PR + quality card + walkthrough. Do not merge. Do not auto-merge unless `AUTO_MERGE` is set (existing).

6. **Tests.** `test/lean-review-surface.test.js` sibling or `test/sealed-auto-pack.test.js`: auto corpus lists the sealed pack; manifest default `test_discipline` is `outcomes`; review skill forbids approve/merge.

### Resume prompt (paste after `/clear`)

```
Implement P2 from docs/proposals/lit-factory-full.md (lit factory --full).
P0 and P1 are done. Do not re-research Devin/Dex. Read the P2 tickets in that file, then implement tickets 1–6. Keep /brd /spec /design /test as human gates. Do not start P3.
```

## P3 — prove it (done 2026-08-15)

Ran on sibling repo `shortlink-p3`, not this monorepo. Gated `--full` sealed;
`/auto --sealed` opened draft PR https://github.com/cwijayasundara/shortlink-p3/pull/1
(do not merge). Findings (seal missing from core copy, placeholder graph/wiki,
sensors not actually run, Gate 5 still bulky) are the input to P4.

## P3 — original brief

**Do this after `/clear`.** Do not run the prove-it in the P2 implementation transcript, and do **not** run `/build` inside this harness monorepo (it would write product `specs/` over the plugin).

Fresh shortlink from `docs/shortlink-prd.md` through `/build --mode full` → seal → `/clear` → `/auto --sealed` → draft PR. Pass if each plan doc is approvable in one sitting and the PR is reviewable in one sitting.

Keep `/brd` `/spec` `/design` `/test` as human gates. Gated `/build` stops after `plan-seal.js write`. Do not merge the draft PR.

### Resume prompt (paste after `/clear`, in a fresh target project that loads this plugin)

```
Prove P3 from docs/proposals/lit-factory-full.md (lit factory --full).
P0–P2 are done. Do not re-research Devin/Dex. Do not implement more harness tickets.
Scaffold or open a fresh product repo (not the harness monorepo). Load this plugin.
Run /build docs/shortlink-prd.md --mode full (copy the PRD into the target if needed).
Keep /brd /spec /design /test as human gates. Stop at the plan seal. Then /clear and /auto --sealed to a draft PR.
Pass if each plan doc is approvable in one sitting and the PR is reviewable in one sitting. Do not merge.
```

## Done when

- Interactive `--full` cannot start coding in the planning session.
- `/auto` without a valid seal exits non-zero.
- Critic cannot run more than 3 rounds in `--mode full`.
- P1–P3 land in later PRs; this file stays the contract.
