# Close the BRD hole in the plan-review loop

**Date:** 2026-07-25
**Status:** approved (design)

## Problem

The pipeline's four planning phases are meant to be human-in-the-loop dialogues, not
approve/reject prompts. Three of them are: `plan-review-loop` is wired into `/spec`
(Step 7), `/design` (`mode-13-gate.md`), and `/test` (Step 4.8), and each round is
recorded by `plan-approval.js` so the next phase can block on the receipt.

`/brd` is not. Its Step 5 is still:

> Display the BRD and ask: "Does this BRD accurately capture the requirements?
> Approve to proceed to `/spec`, or provide corrections."

That is the exact single-question shape `plan-review-loop` exists to replace — a yes/no
over a wall of artifacts, where the cheapest correct answer is always "yes". And
`plan-approval.js` declares `PHASES = ['spec','design','test']`, so no BRD receipt is
ever written, so nothing downstream can gate on it. `/design` blocks on the spec receipt,
`/test` blocks on spec, `/auto` blocks on `--phase all` — but **nothing blocks on BRD
approval.**

The hole is at the origin of the grounding chain (`BRD → /spec → /design → /test → /auto`),
where a mistake cascades furthest and costs the most to reverse.

## Non-goals

- **Not** enforcing the round cap in code. The cap stays prose-only (see *Known limitation*).
- **Not** adding a divergent brainstorm to the front of `/spec` and `/test`. `/brd` Step 0
  and `/design` Step 0 keep theirs; the asymmetry is accepted for now.
- **Not** changing the loop's dialogue shape. `plan-review-loop` is already right; this
  wires a fourth caller into it.

## Design

### 1. `plan-approval.js` — `brd` becomes a first-class phase

```js
const PHASES = ['brd', 'spec', 'design', 'test'];        // brd first: pipeline order
PHASE_ARTIFACTS.brd = path.join('specs', 'brd');
```

Nothing else in the script changes. Receipt shape, artifact digest-pinning, placeholder
rejection, the accounted-for-prior-feedback rule, `low_engagement`, and waivers all apply
to `brd` unmodified.

One property comes free: `check --phase all` already gates a phase **only when its
artifacts exist** (`phaseRan`), so `/feature`'s epic lane — which reaches `/spec` with no
`/brd` at all — needs no special case.

### 2. `/brd` Step 5 — the prompt becomes the loop

Step 5 invokes `.claude/skills/plan-review-loop/SKILL.md` with `--phase brd`, supplying
the skill's four caller-contract inputs:

| Input | Value |
|---|---|
| `phase` | `brd` |
| Artifacts | `brd.md`, `brd-requirements.json`, `brd-acceptance.json`, `brd-safeguards.json` (sprint-N paths in delta mode) |
| Challenge sources | below |
| Terminal action | proceed to `/spec` |

**Challenge sources.** All already exist on disk; none is new machinery:

- `brd-analysis.json#ambiguity_table` entries whose `resolution` is `assumed` or
  `deferred` — guesses the human has never been shown.
- `brd-analysis.json#risk_gap_table` entries with `owner: deferred`.
- `specs/reviews/brd-taxonomy.json` `na_reason` entries. Step 4.45 already states the
  reason "lands in a committed artifact precisely so a reviewer can disagree with it" —
  today no reviewer is ever shown it. This loop is the only place that disagreement can
  happen.
- `specs/reviews/brd-grounding.json` — what the machine already *proved*, so the human
  does not re-check traceability.
- `specs/reviews/phase-brd-eval.json` findings accepted without a fix, especially when
  the 3-iteration ratchet gave up short of threshold.
- BRD §13 Open Questions and §15 **Forbidden Actions** — the deny-list every downstream
  gate and any auto-merge enforces, which no human currently signs off on.
- Delta mode: `requirements-delta.json#dropped` and the resolution recorded for each.

Rounds are recorded with `plan-approval.js record --phase brd`; `--auto` / `--autonomous`
record a waiver with `--lane` instead. Step Δ3 (delta mode) points at this same loop
rather than restating Step 5.

### 3. `/spec` Step 1 — block on the BRD receipt

Run `node .claude/scripts/plan-approval.js check --phase brd` **when `specs/brd/` is
populated**; a non-zero exit halts. Conditional by design: `/feature`'s epic lane reaches
`/spec` with no BRD, and a gate that blocks a lane for not producing an artifact it was
never supposed to produce is a broken gate, not a strict one.

### 4. `/build`

- **Phase 1** — "Approve BRD to proceed to Phase 2?" becomes the `plan-review-loop`
  dialogue, ending in a recorded round that Phase 2 blocks on.
- **Phase 3.5** — the waiver loop becomes `for phase in brd spec design test`.

### 5. `/build --lite` Step 7

Lite writes both `specs/brd/brd.md` and `specs/stories/`, and records **no** receipt
today — so interactive `/build --lite` → `/auto` is already blocked on the missing `spec`
receipt, before this change. Its single consolidated approval now records both a `brd`
and a `spec` round. Headless lite (`--lite --auto` / `--lite --autonomous`) waives both.

Fixing the pre-existing `spec` gap is in scope because this change would otherwise
knowingly ship the lane one receipt further broken.

### 6. `/sprint` GATE 1

GATE 1 already presents the requirements-delta classification *and* the story
decomposition on one screen — a BRD-phase concern and a spec-phase concern together — so
it records the `brd` round there (`/spec` Step 7 continues to supply the `spec` round).
With `--autonomous`, GATE 1 folds into GATE 2, so it waives instead.

### 7. `/feature`

Its sub-skill gate-collapse section already names `/brd` as a delegated producer; add
`brd` to the waiver set written in `--auto` / `--autonomous`.

## Loop break conditions

All four phases share exactly one set, inherited from `plan-review-loop`. They exist in
that skill today but are scattered across three sections; this change states them as one
explicit block.

1. **An approving round is recorded, naming the artifacts.** The only success exit.
2. **Round cap: 5.** At the cap, stop and state the open disagreement plainly — what you
   propose, what they propose, and that it needs a decision or a stop. An unbounded loop
   is a hang.
3. **A recorded waiver** in `--auto` / `--autonomous` — never a silent skip.
   `--require-human` refuses one.
4. **Staleness re-entry.** An approval dies the moment its named artifacts change; the
   loop re-opens. Approval is of a specific plan, not of the phase in general.

### Known limitation

The cap and the stalemate stay **prose-enforced**. `plan-approval.js` will still accept a
6th round, and there is no terminal `stalemate` status, so a stalled loop remains
invisible to `/retro`. Making the break condition machine-observable was considered and
deliberately deferred.

## Testing

`test/plan-review-loop-wiring-contract.test.js` iterates `PHASES` imported from the script
itself and asserts, for each phase, that its skill corpus invokes the loop, records via
`plan-approval.js`, and records under its own phase name. **Adding `'brd'` to `PHASES`
therefore makes the existing suite demand the `/brd` wiring on its own** — that is the red
step, and it comes free.

New assertions:

- `/brd` names its challenge sources and draws on `brd-analysis.json` (extends the
  existing per-phase `sources` map).
- `/spec` blocks on `check --phase brd`.
- `/build --lite` Step 7 and `/sprint` GATE 1 record a `brd` round; the headless lanes
  waive it.

## Control budget

No change. This is pure wiring of an already-registered sensor (`plan-approval`) and guide
(`plan-review-loop`) — no new script, skill, hook, or agent. Both entries'
`harness-manifest.json` descriptions are corrected to name four phases instead of three,
as is `HARNESS.md`.

While rewriting the `plan-approval` description, fix a pre-existing inaccuracy in it: it
claims *"/design blocks on spec, **/test on design**, /auto on all three"*, but
`plan-review-loop-wiring-contract.test.js:48` asserts the opposite — `/test` must **not**
gate on design, because `/design` and `/test --plan-only` run concurrently in `/build`
Phase 3 and gating there would deadlock the parallel branch. The registry has been
describing a gate that does not exist. Corrected to: `/spec` blocks on brd, `/design` and
`/test` on spec, `/auto` on all four.

## Prior art

Devin is the closest shipping comparison and offers no support for per-phase loops,
because it has no phases: it runs **one** editable plan gate at the front, then continuous
interrupt-driven steering. Its approval is also not pinned to a frozen artifact, so a
Devin plan can drift after approval — the property `plan-approval.js` digest-pinning
gives us and they lack. Devin's shape argues for keeping this change narrow: the value is
in the dialogue quality at each existing stop, not in adding stops. (Consistent with this
repo's Devin audits of 2026-06-20, 07-02, and 07-09; not re-verified live.)
