---
name: reuse-or-justify
description: Use when reuse-scout fires at intake (band ≥ medium, a touched constitution invariant, or a same-release clone cluster) — run the confidence-gated reuse-vs-new dialogue and record the decision + performance budget before code. [Internal discipline — invoked by /change, /feature, and /sprint intake; direct use is a power-user path.]
---

# Reuse-or-Justify Intake Dialogue

Resolve one question before a change is built: **does this increment extend an existing seam, or justify a new structure?** This is the forcing function that keeps sprint-by-sprint work from accreting parallel clones. It runs at intake, before the failing test.

## Step 1 — Ground (deterministic)

Run reuse-scout for the change's goal:

```bash
node .claude/scripts/reuse-scout.js --graph specs/brownfield/code-graph.json --goal "<the change's one-line goal>" [--constitution specs/design/constitution.md] [--batch <stories.json>]
```

Read its JSON: `fire`, `band`, `target_seam`, `target_action`, `candidates[]` (each with `path`, `total_score`, `recommended_action`, `matched_terms`), `touched_invariants[]`, `intra_batch[]`.

## Step 2 — Decide whether to interrogate

- **`fire: false`** → do not interrogate. Record the net-new assumption and proceed:
  `node .claude/scripts/record-reuse-decision.js --story <id> --decision net-new --justification "reuse-scout found no goal-relevant seam, invariant, or same-release clone"`. Continue the caller's flow.
- **`fire: true`** → interrogate at the genuine fork points only (below). One question at a time.

## Step 3 — The dialogue (only the questions the grounding raises)

Ask each question with the decision, your recommendation, and why it matters (mirrors the clarify format). Ask one at a time.

<question type="reuse-vs-new">
Fires when `target_seam` is set. Present the ranked reuse candidate(s) and its `target_action`:
- If `target_action` is `extend`/`wrap`/`introduce-adapter`: recommend extending `target_seam`.
- If `target_action` is `split`/`avoid`: surface it honestly — the closest existing code is `target_seam` but it is classified `<action>`; ask whether to extend anyway, refactor first, or justify a new structure.
Options: (a) extend the named seam, (b) add a pluggable strategy to it, (c) justify a new structure. A new structure requires a one-line justification naming why no existing seam fits.
</question>

<question type="invariant-impact">
Fires when `touched_invariants` is non-empty. For each, ask the human to confirm the change stays within the invariant, or to explicitly propose amending it (itself a reviewed decision).
</question>

<question type="intra-batch">
Fires when `intra_batch` clusters exist (feature/release scope). Present each cluster of stories that share a seam and ask whether to consolidate them onto one seam before building, rather than implementing each separately.
</question>

<question type="budget">
When the decision creates or extends a seam, ask for its performance budget (latency/memory/throughput/tokens/cost as applicable), recommending the inherited budget when extending an existing seam.
</question>

## Step 4 — Record (deterministic)

Once resolved, record each fork:

```bash
node .claude/scripts/record-reuse-decision.js --story <id> --decision <extend|new-seam|net-new> \
  [--seam <path-or-name>] [--action <extend|wrap|introduce-adapter|split|new>] \
  --justification "<one line>" [--invariant-impact "<txt>"] [--budget '<json>'] [--options "<considered>"]
```

Then reflect the outcome in the design artifacts (per the /design authoring instructions): set the extended component's `seam`/`extension_mechanism`/`instances`/`budget` in `component-map.md`, and `extends_seam`/`budget_inherited_from` in `design-traces.json`. These are optional fields the ownership/trace sensors already tolerate — do not backtick non-path values.

## Gotchas

- Do not interrogate on `fire: false` — that trains the team to dismiss the dialogue. The gate is deliberately confidence-gated.
- A `split`/`avoid` `target_action` is information, not a blocker — surface it so the human isn't told to extend something that should be split.
- The decision is a constraint the stage-4 enforcement (duplication ratchet, and P2's seam-conformance) verifies later; record the seam you actually committed to.
