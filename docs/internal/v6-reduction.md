# v6 reduction — evidence and partition

Baseline: tag `v5-preserve` (`f81b7ef`). Work proceeds on branch `v6-reduction`, to be
published as `main` of a separate `claude_harness_eng_v6` repo. This repo and that tag
stay as they are.

## Why

v5 reached 132 registered controls (44 guides + 88 sensors) across 51 skills, 10 agents,
11 hooks + 65 hook libs, 144 scripts and 359 test files — ~173k tracked lines — in ~90 days.
The problem is not the size. It is that **nothing measures whether any of it works.**

| Signal | Expected | Actual (2026-07-22) |
|---|---|---|
| `.claude/state/sensor-outcomes.jsonl` — the value meter's input | thousands of records | **file does not exist** |
| `npm run sensor-value` | ranked cut list | `INSUFFICIENT DATA — 0 recorded outcomes, need >= 20` |
| `.claude/state/learned-rules.md` | rules accrued over 3 months | **4 lines — header only** |
| `failures.md`, `iteration-log.md` | run history | **unfilled templates** |
| `npm run loop-health` | failure patterns | `5587 events, 0 failures` |

`sensor-value-report.js` was built specifically to identify controls that never bite. It has
never received a single data point, because `recordOutcome` is essentially never called.

**The centrepiece has no usage record.** Across 23 days of `.claude/runs/` telemetry there are
148 attributed subagent spawns:

```
60  code-reviewer      0  generator
33  implementer        0  evaluator
14  security-reviewer  0  planner
14  codebase-explorer  0  design-critic
```

Corroborating: `specs/` contains `brownfield/ retro/ reviews/ stories/` and no `brd/`,
`spec/` or `design/`. The `/brd -> /spec -> /design -> /auto` pipeline has never produced an
artifact set in this repo.

**Caveat, stated honestly.** `record-run.js` began writing on 2026-06-27. Usage before that
date, or in other repos scaffolded from this harness, is not visible here. The `planning` pack
is therefore *retired to a pack*, not deleted — if the GAN loop has real usage elsewhere it
becomes a first-class pack with no further argument needed.

## Diagnosis

The harness is a **feedforward-only control system**. `HARNESS.md` states the principle itself:
*"feedback-only repeats mistakes; feedforward-only encodes untested rules."* Every control was
added from an article, an audit, or an anticipated failure — never an observed one, because
nothing observes. Two consequences compound:

1. **No subtractive force.** No control can be deleted, because no evidence exists that any
   control is worthless. The `control-budget` gate ratchets a *count*, and a count is defeated
   by writing a `net_add_justification` (free) or moving the baseline (done, to 132).
2. **Every problem looks like a missing control.** The previous simplification attempt
   (2026-06-10) produced the control-budget gate, the sensor-value meter and the biting-meta
   sensor — three more controls to solve too-many-controls.

A clean-sheet rewrite does not address either. `claude_code_harness_x_v1` (started 2026-07-19)
reached 282 files / 1.19 MB in 3 days, already containing `control-manifest.js`,
`control-subtract.js`, `sensor-quarantine.js`, `sensor-waivers.js` and `improvement-ratchet.js`
— an accretion rate of ~400 KB/day against v5's ~67 KB/day. The generative process travels with
the author; only the process change stops it.

## The partition

`v6-partition.json` assigns all 283 units to the kernel or exactly one pack. Zero unassigned,
zero double-assigned, zero ghosts.

| Home | Units | Rationale |
|---|---:|---|
| **kernel** | 44 | Everything with usage evidence: `/vibe`, `/change`, `/gate`, `/refactor`, `code-gen`, `/status`; agents `implementer`, `code-reviewer`, `security-reviewer`; the 5 session hooks; the commit gate and its support libs. |
| planning | 63 | GAN/SDLC pipeline. Zero telemetry usage; no artifacts ever produced. |
| telemetry | 42 | Harness self-observability. Report-only; none of it gates. |
| brownfield | 41 | Existing-codebase work, incl. the 10-control nav/token-governor stack. |
| verification | 28 | Runtime/regression verification beyond the commit gate. |
| legacy-discipline | 23 | Coverage/pinning/sprouting/AT-first discipline. |
| compliance | 20 | Client CISO mandate — real external commitment, separate lifecycle. |
| scaffold | 14 | Project init and harness distribution. |
| domain | 8 | Vertical/framework content. Zero coupling to the machinery. |

**The kernel is 16% of the harness.**

## The one structural rule

> A kernel unit may not hard-reference a pack unit.

Enforced by `tools/check-partition.js --strict` (exit 1 on violation). "Hard" means executable
coupling — `require()`, `node .claude/scripts/x.js`, `npm run x`, `subagent_type`. Prose routing
("escalate to `/design`") is a **soft** edge: breaking it degrades to "that lane isn't installed",
which is exactly what an uninstalled pack should do.

This is deliberately the *only* structural gate added by the reduction. One rule that holds beats
a taxonomy that doesn't.

## Current state — the Phase 3 work-list

```
partition: 283 units — planning 63, kernel 44, telemetry 42, brownfield 41,
                       verification 28, legacy-discipline 23, compliance 20,
                       scaffold 14, domain 8
cross-pack edges: 85
KERNEL -> PACK violations: 44
```

44 edges to cut, not 283 files to reason about. Each resolves one of three ways
(`resolution_policy` in the partition file): move the callee to the kernel, move the caller to
the pack, or make the call optional and degrade loudly when the pack is absent.

Two edges are structurally load-bearing and should be cut first, because each one alone drags a
whole pack tail into the kernel:

- **`lib:gate-registry` statically `require`s all five gate tiers** (`gates-early`, `gates-legacy`,
  `gates-quality`, `gates-live-externals`, `gates-strict`). Load the configured tier dynamically
  and the legacy-discipline / live-externals / compliance tails detach at once.
- **`context-pack.js` hard-requires the nav stack** (`nav-index`, `nav-cochange`, `nav-telemetry`,
  `impact-scope`) and is pulled by `vibe`, `change`, `refactor` and `implementer`. This is the
  token-governor machinery; it false-blocked legitimate work four times during the session that
  produced this document, including a `find` used to inventory the repo and a write to a scratchpad
  *outside* the repo.

The checker already caught two mis-homings in the first draft of this partition. Most importantly
`lib:sensor-outcomes` — **the bite ledger** — was assigned to `telemetry`; it is the mechanism the
whole reduction depends on and is now kernel.

## What has not been decided

Whether the `compliance` pack is live client commitment. It is partitioned as a first-class pack
(the safe assumption) rather than a quarantine candidate. If no client depends on it, it is the
next 20 units to retire.
