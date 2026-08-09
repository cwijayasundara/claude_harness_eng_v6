---
name: plan-review-loop
description: "[Internal discipline — invoked by /brd, /spec, /design, and /test at their human gates; direct use is a power-user path.] Run the human review of a planning artifact as a brainstorming dialogue rather than an approve/reject prompt, and record the rounds so downstream phases can gate on the result."
---

# Plan Review Loop

The pipeline's planning gates exist so a human shapes the plan *before* `/auto` turns it into code, where review is far more expensive. A gate that asks "approve, or provide corrections?" does not achieve that — it offers a yes/no on a wall of artifacts, and the cheapest correct answer is always "yes."

This skill replaces that single question with a bounded dialogue, then records what happened. `/brd`, `/spec`, `/design`, and `/test` each invoke it at their gate; `plan-approval.js` writes the receipt the next phase checks, and prints the `/clear` handoff to the next phase on the approving round.

**Carrying the header is not running the loop.** `/brd` cited this skill at its gate while its body still said "display the BRD and ask: approve, or provide corrections" — and a real run behaved the way the body said, closing in one round on a one-word reply while four PRD overrides and 79 requirements with no observable criterion went unasked. If a phase's gate can be satisfied by one question, the loop is not wired there yet.

<caller_contract>

The calling skill supplies four things:

| Input | Example (`/spec`) | Example (`/brd`) |
|---|---|---|
| `phase` | `spec` | `brd` |
| Artifacts under review | `specs/stories/epics.md`, `dependency-graph.md`, `E*-S*.md`, `features.json` | `specs/brd/brd.md`, `brd-requirements.json`, `clarification-log.json` |
| Challenge sources — where this phase's uncertainty already lives | `specs/plan-confidence.json` band + drivers, `risk_gap_table` entries, `phase-spec-eval.json` findings accepted without a fix, `story-clusters.json` warnings | unresolved `brd-open-questions.json` entries, clarifications whose `basis` is an assumption, clarifications that *override* the source document, requirements with no observable criterion, `phase-brd-eval.json` findings accepted without a fix |
| Terminal action on approval | `/clear`, then `/design` | `/clear`, then `/spec` |

</caller_contract>

## The round

<opening_brief>

Open with a **review brief**, not the artifacts. Dumping four files and asking for approval moves the whole cost of review onto the human; the brief moves the part only you can do — knowing where you guessed — back onto you.

The brief covers, in a few hundred words:

- **What was built** — the shape and size, not a file listing.
- **The load-bearing decisions** — the handful of choices that would be expensive to reverse after `/auto` runs, each with the alternative you rejected and why.
- **Confidence** — the band and its drivers from the challenge sources, stated plainly. A LOW band leads the brief.
- **What the machine gates already proved**, so the human does not re-check it: grounding verdicts, cluster gates, trace coverage. Their job is product intent, not structural validity.
- **Where you would push back if you were reviewing this** — your own weakest points, named. This is the part that makes the loop worth running.

</opening_brief>

<dialogue>

Then work through the artifact in sections, scaled to complexity — a sentence for the straightforward parts, more where it is genuinely contested. After each section, ask whether it holds.

- One question at a time. Multiple choice where the options are genuinely discrete.
- Use `/clarify`'s question format — the decision, your recommendation, why it matters — and its budget: 10 questions per round, hard cap 15.
- At a contested fork, propose 2–3 alternatives with trade-offs and a recommendation, not a yes/no.
- Ask only load-bearing questions: ones whose answer changes stories, contracts, data shape, security posture, or sequencing. Anything already settled by project convention is an assumption to record, not a question to ask.
- Approval accrues per section. A section the human has signed off does not get re-litigated in a later round unless they reopen it.

</dialogue>

<revise_and_represent>

Between rounds, revise, then re-present as a **changelog against their feedback** — every item they raised, and what you did about it:

```
You said: E2-S3 and E2-S4 both write the session cookie.
  → Merged E2-S4 into E2-S3; the cluster count drops 4 → 3.

You said: the retention story should block the export story.
  → Not changed. The export path reads a projection that the retention
    job never writes, so the edge would serialise two clusters that can
    run in parallel. Flagging rather than silently keeping it — say the
    word and I will add it.
```

Disagreement gets surfaced. Absorbing feedback you think is wrong produces a plan neither of you chose, and the human loses the chance to overrule you.

</revise_and_represent>

<recording>

Record every round as it closes:

```bash
# a round that sent you back
node .claude/scripts/plan-approval.js record --phase spec --verdict changes-requested \
  --feedback "E2-S3 and E2-S4 both own the session cookie; merge them." \
  --questions 6 --answered 4

# the round that closes the loop
node .claude/scripts/plan-approval.js record --phase spec --verdict approved \
  --changes "Merged E2-S4 into E2-S3; clusters 4 -> 3." \
  --declined "Kept export independent of retention: no shared write path." \
  --questions 3 --answered 3 \
  --artifact specs/stories/epics.md --artifact specs/stories/dependency-graph.md
```

Feedback is recorded verbatim — it is the reviewer's words, not your summary of them. The gate rejects a changes-requested round with no substantive feedback, and rejects an approval that leaves earlier feedback unaccounted for.

`--artifact` fixes what was approved. The receipt stores a digest of each file, so an approval dies the moment those files change — a later phase cannot inherit approval for a plan the human never saw. Re-run the loop after any post-approval edit.

</recording>

<bounds>

- **Round cap: 5.** At the cap, stop looping and state the open disagreement plainly: what you propose, what they propose, and that it needs a decision or a stop. An unbounded loop is a hang.
- **Zero-feedback approvals pass.** A plan can be right the first time. The receipt flags `low_engagement` so `/retro` can see whether these gates are decaying into a formality across many runs; it is a trend signal, never a block.
- **Headless lanes waive, they do not skip silently.** `--auto` and `--autonomous` record why no human loop ran:

  ```bash
  node .claude/scripts/plan-approval.js waive --phase spec --lane --auto
  ```

  `/auto` accepts a waiver; a gated-lane caller passes `--require-human` so a waiver cannot be used to slip past a gate that was supposed to stop.

</bounds>

## Gotchas

- **The brief is the deliverable, not the artifacts.** A round that opens by listing files has already failed — the human is back to reading the plan cold, which is the cost this loop exists to remove.
- **Do not ask questions the artifacts already answer.** Read the challenge sources first; a question whose answer is in `plan-confidence.json` spends review budget on something you could have looked up.
- **Approval is of a specific plan.** Editing an approved artifact — even to fix something the reviewer asked for — voids the receipt by design. Record a new approving round after the edit.
- **`needs_breakdown` stories and open clarifications are not review material.** Resolve them before opening the loop; asking a human to approve a plan with known holes wastes the round.
