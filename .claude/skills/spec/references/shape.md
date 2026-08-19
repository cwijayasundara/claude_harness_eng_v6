# `/spec` — shape (Steps 0–5.5)

SSDD: record the load-bearing calls in `specs/decisions/spec-decisions.json`.
Do not generate the story graph in this session.

```
/spec specs/brd/brd.md
/spec specs/brd/sprint-N/brd.md --sprint N
```

A small number of calls cannot be derived from the BRD: which epics are in the
next milestone, where an epic splits, which dependencies are real rather than
defensive, what gets deferred. Everything after that is transcription.

Deciding first is what stops the harness rendering work nobody chose. A
measured run produced 84 stories from 14 real decision points.

### Step 0 — Context Handoff [HARD BLOCK]

```bash
node .claude/scripts/handoff-check.js --phase spec
```

Exit 1 means this session approved `/brd`. Stop: `/clear`, then `/spec` again.
Add `--in-session` only when `/build` is conducting every phase from one session.

### Step 1 — Digest the BRD, do not read it whole

```bash
node .claude/scripts/phase-digest.js --phase spec
```

Exit 1 means `/brd` has not run. If `specs/brd/analysis-seed.json` exists, treat
its `open_questions` and `risks` as later challenge sources. Do not re-derive
domain terms the seed already classified.

The digest is the whole shaping input: requirement count and id range, taxonomy
spread, **how many requirements have no observable acceptance criterion**, the
PRD's milestone order, the deny-list, open questions, High risks, confidence
band. **Do not read `brd-requirements.json`, `brd-acceptance.json` or `brd.md`
in full here.** Read one requirement only when a decision turns on its wording.

The uncovered-criteria count is this phase's work-list. `spec-render` only
checks criteria that already exist.

### Step 2 — Draft the decision set, do not ask it yet

A call is load-bearing when a different answer changes what gets built or in
what order.

1. **Milestone scope** — always load-bearing. Read `specs/brd/brd-milestones.json`
   first. Propose `milestone.epics` from the next milestone's `requirements[]`.
   Empty `requirements[]` still gives order — propose a mapping and ask. Read
   `specs/milestones/*-log.md` if any exist. Everything you defer is work the
   renderer will not generate.
2. **Epic boundaries** — split or merge, and why.
3. **Real vs defensive dependencies.**
4. **Deferrals** — `needs_breakdown` rather than guess.
5. **Vertical slices** — tracer bullets, not a Types→Config→Repository→Service→API→UI ladder.

Ten well-chosen decisions beat thirty confirmations.

### Step 3 — Put them to the human, one at a time

Follow `.claude/skills/clarify/SKILL.md` (budget 10, cap 15) and
`.claude/skills/plan-review-loop/SKILL.md` at a contested fork.

Propose a default with reasoning; never ask an open question you could answer.
Use `AskUserQuestion` for discrete choices. Record `rationale` for both accepts
and overrides.

### Step 4 — Write `specs/decisions/spec-decisions.json`

```json
{
  "version": 1,
  "phase": "spec",
  "source": "specs/brd/brd.md",
  "confirmed_at": "<ISO 8601>",
  "milestone": {
    "name": "M1 — ingestion",
    "epics": ["E1", "E2", "E3"],
    "deferred_epics": ["E4", "E5"],
    "requirements_in_scope": ["FR-1", "FR-2", "NFR-1"]
  },
  "decisions": [
    {
      "id": "D1",
      "question": "Which epics are in milestone 1?",
      "options": ["E1-E3 (ingestion only)", "E1-E5 (ingestion + ranking)"],
      "proposed_default": "E1-E3 (ingestion only)",
      "chosen": "E1-E3 (ingestion only)",
      "rationale": "E4 onward depend on the ingestion contract E2 publishes.",
      "basis": "human",
      "load_bearing": true
    }
  ]
}
```

| `basis` | meaning |
|---|---|
| `human` | you asked; they answered — including accepting your default |
| `default-accepted` | you did not ask |
| `headless-default` | `--auto` / `--autonomous` |

Do not write `human` for a decision you never put. Mark `load_bearing: true` on
calls that change what gets built; those must be `basis: "human"` outside
headless lanes.

### Step 5 — Verify the gate

```bash
node .claude/scripts/fill-spec-scope.js
node .claude/scripts/validate-spec-decisions.js
```

`fill-spec-scope.js` copies the matching milestone requirement list when you
omitted `requirements_in_scope`. Fix by asking, not by editing `basis`.

### Step 5.5 — Checkpoint: stop here and clear [HARD BLOCK]

Obey the printed checkpoint: stop, `/clear`, then `/spec --render-only`. Do not
continue into render in this session. Same-session render re-billed 40 of 47
turns at 284K; fresh they run at ~110K.

No checkpoint when the gate was waived or run `--in-session` — continue into
`references/render.md`.
