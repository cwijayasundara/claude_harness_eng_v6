---
name: brd-extract
description: "[Internal pipeline stage — dispatched by /brd at Step 0.0 in --prd / --frd mode; invoke directly only to re-extract a spine after the source document changed.] Extract the source document's requirement spine into frd-requirements.json, adopt it deterministically, and return counts only."
argument-hint: "--prd <path> | --frd <path> [--sprint N]"
context: fork
agent: generator
---

# BRD Extract — Requirement Spine (sidekick)

The **extraction** half of `/brd`'s Step 0. `/brd` holds the interview and the
clarification dialogue in the main session; this skill turns the source document
into the machine-readable spine that everything downstream is graded against.
It decides nothing and it asks nothing.

## Why this is a fork

Extraction is transcription, not judgement — every "the system must / shall /
should" statement becomes one entry, verbatim. On a real run the main session
did this itself and wrote a **34 KB** `frd-requirements.json` with the frontier
model, before the interview had even started. That blob was the single largest
thing in the session's context and it then rode along for all 337 remaining
turns. The phase billed $15.58, of which the sidekick produced 8.6%.

Nothing about extraction needs the main session's context, and the main session
needs none of extraction's output beyond the counts. That is exactly the shape a
fork is for.

## Inputs

- `--prd <path>` or `--frd <path>` — the source document. Required. Without one,
  `/brd` runs its interview instead and never dispatches this skill.
- `--sprint N` — optional; writes under `specs/brd/sprint-N/` for delta mode.

## Steps

### Step 1 — Copy the source verbatim

Copy the document to `specs/brd/source-frd.md`. This is the immutable grounding
baseline. **Never edit it**, and never "tidy" it on the way in — the grounding
gate compares against this file, so an edit here silently moves the baseline.

### Step 2 — Extract the spine

Write `specs/brd/frd-requirements.json` — one entry per discrete requirement,
with a stable id, the requirement text **verbatim**, and its source section:

```json
[
  { "id": "FRD-1", "text": "Users can reset their password via an emailed link", "section": "3.2 Authentication" },
  { "id": "FRD-2", "text": "Users can view their order history", "section": "4.1 Orders" }
]
```

Be exhaustive and faithful. Every MUST/SHALL/SHOULD statement, every user-facing
behavior, every business rule, every non-functional threshold, and every named
constraint becomes one `FRD-n`. Also extract, into the same file, the document's
Out of Scope / Non-goals items, its Open Questions, and its Risks — `brd-adopt.js`
routes them to the right artifact by section, and a section you skip is a
safeguard or an unknown that silently ceases to exist.

**Do not paraphrase, summarise, merge or split.** A requirement you soften here
is softened for the whole build, and the grounding gate cannot detect it because
it checks coverage, not meaning. A requirement you fail to extract is a
requirement that can be dropped downstream with nothing to notice.

**Section labels are load-bearing — `brd-adopt.js` routes by them, not by
content.** Get these right or an entry lands in the wrong artifact:

| Source content | `section` must look like | Becomes |
|---|---|---|
| A requirement | `4. Functional Requirements / FR-2` | a requirement, id `FR-2` |
| Its acceptance postcondition | `6. Acceptance / FR-2 AC` | an acceptance criterion linked to `FR-2` |
| Out of Scope / Non-goals | `7. Out of Scope` | a forbidden action |
| Open Questions | `10. Open Questions` | an open question |
| Risks | `9. Risks` | a risk |
| Problem, Goals, Users, Scope, Milestones, Glossary | that heading, verbatim | context |

The acceptance convention is the one that goes wrong quietly: the trailing
` AC` after the requirement id is what links a postcondition to its requirement.
Label it anything else and the postcondition is adopted as a *requirement* —
which both inflates the spine and leaves the real requirement with no oracle.
When a PRD carries its acceptance criteria in one shared section (`## 6.
Acceptance`, bullets of the form `- **FR-2** → Given… when… then…`), still emit
one entry per bullet with section `6. Acceptance / FR-2 AC`.

Nothing is dropped for not fitting the table: an entry whose section matches
none of these is adopted as context, which is recoverable. A *mislabelled* one
is not.

### Step 3 — Adopt deterministically

```bash
node .claude/scripts/brd-adopt.js
```

This derives `brd-requirements.json`, `brd-acceptance.json`, `brd-safeguards.json`,
`brd-open-questions.json`, `brd-milestones.json` and `brd-risks.json` from the
spine — text carried verbatim, each entry tracing to its own source id. **Do not
write those files by hand.** Adoption is what makes grounding an identity: there
is nothing to prove because nothing was transformed.

Adoption deliberately leaves `taxonomy: null` on every requirement. Leave it
null — slot classification is a judgement call and belongs to the main session,
which has the human.

Resolve any warning adoption prints rather than passing it on: an acceptance
criterion naming a requirement outside the spine is an untraceable postcondition.

## Return counts, not content

Your return message is read by the main session, so it is charged to the context
this fork exists to protect. Return **only** this:

```
spine: 172 entries -> 107 requirements, 11 acceptance, 13 forbidden,
       27 context, 5 open questions, 9 risks, 7 milestones
warnings: 0
taxonomy: null on all 107 (main session tags them)
adoption: lossless (grounding is an identity)
```

Do not restate requirements, quote the document, summarise its argument, or
describe what you read. The main session reads `brd-open-questions.json`
directly — five entries it must put to the human — and gets everything else from
`phase-digest.js`. Anything you paste into the return message is a blob the
fork was supposed to keep out.

If extraction could not complete, say which section defeated it and why, and
stop. A partial spine that reports success is worse than a failure: the
grounding gate will happily prove the BRD covers a spine that was already
missing requirements.

## Gotchas

- **Never invoke `/clarify`.** A forked skill cannot reach the human, so
  clarifying means answering your own question. Where the document is genuinely
  ambiguous, extract the text as written and let the main session's Step 0.5
  clarification budget resolve it with the human.
- **Extract the document's own Open Questions.** Its author wrote those down
  *because they did not know the answer*, which makes them the highest-value
  entries in the whole clarification budget — and the ones the main session did
  not have to invent.
- **Section labels matter.** `brd-adopt.js` routes by section, so a Non-goals
  item filed under a functional heading becomes a requirement to build rather
  than a forbidden action.
