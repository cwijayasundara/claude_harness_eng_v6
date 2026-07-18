---
type: Execution State Workflow
title: Continuation, discovery, and reuse decisions
description: "Durable execution state, cross-session recovery, brownfield navigation, and the confidence-gated reuse-or-justify intake discipline."
resource: .claude/skills/auto/SKILL.md
tags: [workflows, state, brownfield, reuse]
---

# Continuation, discovery, and reuse decisions

The harness treats long-running development as resumable work, not a single chat. `/auto` and the [product routes](product-routes.md) persist checkpoints; the [control plane](../architecture/control-plane.md) refreshes graph/navigation artifacts at safe lifecycle boundaries; reuse decisions are recorded before new structure is created.

## Durable execution state

Three artifacts anchor continuation in a scaffolded target:

- `claude-progress.txt` is the append-only session checkpoint log. It records the last completed state and the next action.
- `features.json` is the evaluator-controlled feature/pass-fail record used to track work rather than relying on conversational claims.
- `.claude/state/` holds budgets, learned rules, logs, baselines, and other runtime state. `.claude/runs/` holds local JSONL receipts.

`/status` and `.claude/scripts/pipeline-status.js` read these artifacts. After a stopped session, rerun `/auto`; it recovers the final progress block, rechecks Git/state, and performs a startup smoke check before it continues.

## Cross-process session chaining

For long unattended work, `.claude/scripts/build-chain.js` launches fresh `claude -p` processes for a plan phase, repeated one-wave build phases, and finalization. `--once` checkpoints one wave at a time. This bounds any one context window while retaining progress in the same durable artifacts.

Budgets are deliberately part of the execution contract: wall-clock, agent-spawn, and estimated-cost caps can stop at an iteration boundary with a resumable `BUDGET` next action. Do not “fix” a budget stop by deleting state; increase the configured budget or resume the intended workflow.

Retention/archive scripts trim historical logs and runs, but preserve pending recommendations rather than discarding them merely because they are old.

## Brownfield knowledge flow

`/brownfield` is the no-production-edit discovery route. It produces code graph, symbol map, wiki/navigation, architecture/test/risk/change strategy artifacts under `specs/brownfield/`. `/feature` refreshes this living knowledge before planning existing-code work, and [the control plane](../architecture/control-plane.md) marks graph data dirty on edits then refreshes it at stop boundaries.

Graph-dependent rules and reuse analysis therefore need current source evidence. If graph generation or an optional analysis tool is unavailable, the harness may degrade loudly rather than inventing a result; resolve the missing evidence before relying on a confidence claim.

## Reuse-or-justify intake

Recent development added an intake guard against incrementally creating parallel structures. `/change`, `/feature`, and `/sprint` can run `.claude/scripts/reuse-scout.js` against the brownfield code graph, a one-line goal, optional constitution invariants, and optionally a batch of stories.

When the scout’s confidence gate does not fire, the caller records the net-new assumption and proceeds. When it fires—because of a plausible seam, touched invariant, or same-release clone cluster—the `reuse-or-justify` skill asks only the relevant fork questions:

1. extend/wrap/adapt the named seam, refactor/split first, or justify new structure;
2. remain inside or deliberately amend a touched invariant;
3. consolidate same-release stories that converge on one seam;
4. assign an inherited or new performance budget.

`.claude/scripts/record-reuse-decision.js` appends the resulting decision, justification, invariant impact, options, and optional budget. The decision must then be reflected in the design/component trace artifacts. This is a constraint for later duplication/seam enforcement, not a cosmetic log.

## Change checklist

- For existing-code work, start with `/feature` unless the task is deliberately discovery-only (`/brownfield`) or clearly fits a lower route selected by `/feature`.
- Keep `claude-progress.txt`, `features.json`, and baseline state intact across recovery. Check `/status` rather than guessing the next action.
- When reuse-scout reports a `split` or `avoid` action, surface it as evidence—not as an instruction to extend a bad seam.
- Update the committed wiki/map with the code change; product routes treat the DeepWiki as living delivery evidence.
- Test the reuse decision recorder, scout, route wiring, and relevant graph refresh behavior through the [verification](../quality/verification.md) surface when these mechanisms change.
