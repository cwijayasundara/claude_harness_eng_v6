# `/spec` — review (Steps 7–8) + output + gate

SSDD: the human already set scope in shaping. Review what rendering revealed —
coupled clusters, wave boundaries, heavy estimates — and the Generation
Contract skeleton on each ready story. Fix `spec-decisions.json` first, then
`--render-only`.

## Step 7 — Phase Evaluation Gate [`--eval` only]

Skip unless `--eval`. Auth, tenant, migration, or an external-trust
boundary is not a reason to run it — grounding and cluster gates already
ran in `spec-render`. Stories must be **vertical slices** (see
`plan-review-loop/references/lean-review-surface.md`) — do not split a
capability into a Types / Config / Repository / Service / API / UI ladder.

When `--eval` is on, spawn the `evaluator` agent in artifact mode **with `model: "sonnet"`**, and:

- Phase: `spec`
- Artifacts: `specs/stories/epics.md`, `specs/stories/E*-S*.md`, `specs/stories/stories.json`, `specs/stories/dependency-graph.md`, `features.json`
- Upstream: `specs/brd/brd.md` (+ `brd-requirements.json` when present)
- Grounding verdict: `specs/reviews/spec-grounding.json` when present
- Rubric: read `.claude/templates/phase-eval-rubrics.json`, key `"spec"`
- **Iteration: 1** (increment on retry)
- **Previous score: null** (or the previous iteration's `weighted_average`)
- Write result to `specs/reviews/phase-spec-eval.json`

**Ratchet loop (max 3 iterations):** PASS → Step 8; FAIL → fix and re-run
(re-dispatch `spec-render` when the fix is structural); `weighted_average`
must be >= previous; after 3, carry findings into Step 8.

**Take the verdict from the agent's return message. Do not read
`specs/reviews/phase-spec-eval.json` back into this session.**

Escalate to `model: "opus"` when the decomposition itself carries a security
or data boundary the deterministic gates do not cover. Default is the sidekick
tier because grounding, `trace-check.js`, and cluster gates already passed.

## Step 8 — Human Review Loop [REQUIRED SUB-SKILL: `plan-review-loop`]

Follow `.claude/skills/plan-review-loop/SKILL.md` and `references/ssdd.md`.

Open with: epic summary (flag undefensible story counts); dependency overview;
points by epic/group; **allocation** (cluster id, story count, points, epics,
layers, waves, `coordination_cost`, independently startable); *"N clusters for
a team of K"*; build-first `interface_contracts`; hand-offs; `warnings[]`
verbatim; totals.

**Challenge sources** — read before asking:

- `specs/plan-confidence.json` — band and drivers
- `risk_gap_table` entries carried from the BRD
- `specs/reviews/phase-spec-eval.json` — findings accepted without a fix (only if `--eval`)
- `story-clusters.json#warnings`, any cluster not `independently_startable`
- Any shaping decision that rendering contradicted
- Generation Contract skeletons that list `Operations: pending` (expected)

Record with `plan-approval.js`, naming `specs/stories/epics.md`,
`specs/stories/dependency-graph.md`, `specs/stories/stories.json`,
`features.json`, and `specs/decisions/spec-decisions.json` on the approving
round. In `--auto` / `--autonomous`, waive with `--lane`.

## Output

| File | Purpose |
|------|---------|
| `specs/decisions/spec-decisions.json` | Recorded human calls the renderer expands |
| `specs/decisions/spec-unresolved.json` | Judgements the renderer refused to invent |
| `specs/stories/epics.md` | Epic index — user-visible output |
| `specs/stories/E*-S*.md`, `stories.json` | Stories + Generation Contract skeleton |
| `specs/bundles/{id}.json` | Skeleton story bundles (`bundle-write.js`) |
| `specs/stories/dependency-graph.md` | Dependencies |

## Gate

`validate-spec-decisions.js` fails when no decision is `basis: "human"`, when a
`load_bearing` decision is not, when `milestone.epics` is empty, or when the
file is malformed. `spec-render` re-runs it at Step 0. Headless lanes waive
only the human requirement.

Human review is required before `/design`:

```bash
node .claude/scripts/plan-approval.js check --phase spec
```

## Gotchas

- Empty `specs/stories/` after Step 5.5 is expected — `/clear` then `--render-only`.
- Do not re-shape when `NEXT` is `render` or `review`.
- Do not fork this skill.
- Do not write `basis: "human"` for a decision you did not ask.
- Do not re-ask in Step 8 what was settled in shaping.
- Do not expand deferred epics.
- Unresolved items are a success signal.
