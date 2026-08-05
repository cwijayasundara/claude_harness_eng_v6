---
name: prd
description: "Author the PRD that starts the pipeline — a collaborative dialogue that produces the id'd requirement spine, the deny-list, and one observable postcondition per requirement. Use before /build, /brd --prd, or any --autonomous run."
argument-hint: "[path/to/prd.md] [--from <notes.md>]"
---

# PRD Skill — Author the Entry Artifact

## Usage

```
/prd                              # author from a conversation, write to prd/<name>.md
/prd prd/checkout.md              # author to a specific path
/prd --from notes/braindump.md    # start from existing notes rather than a blank page
/prd prd/existing.md --review     # validate and improve a PRD that already exists
```

**Runs in the main session — do not add `context: fork`.** This skill is a
dialogue. A forked skill cannot pause for `AskUserQuestion`, so a forked PRD
author would write the requirements *and* confirm them.

---

## Overview

The PRD is the only artifact in the pipeline a human is expected to write, and
until now the harness gave no help writing one — just a template in
`docs/prd-format.md` — while `--autonomous` and `--auto` both refuse to run
without it.

It matters more since `/brd --prd` began **adopting** the spine rather than
re-expressing it: the PRD's FR/NFR text is now carried verbatim into the
grounding baseline. Whatever you write here is what gets built and what the
evaluator checks against. There is no longer a rewriting step to quietly fix it.

Two properties carry almost all the weight:

- **A stable id on every requirement.** The grounding gate proves nothing was
  invented or dropped by matching ids. A requirement with no id can vanish
  between phases and no gate will notice.
- **One observable postcondition per functional requirement.** This is the
  evaluator's oracle. A requirement with no postcondition is one the evaluator
  cannot fail, so it passes by default. On a real PRD, **27 of 38** functional
  requirements had none.

---

## How to ask

**Propose a default with reasoning; never ask an open question you can answer
yourself.** People are far better at editing a proposal than generating one.
"I'd scope v1 to ingestion and ranking and defer the console, because the console
needs the ranking contract to exist first — take it, or move something?" beats
"what should be in v1?".

**Use `AskUserQuestion` for discrete choices**, prose for open ones. Lead with
your recommendation and say what it costs.

**One decision at a time, and lock each before moving on.** Budget roughly
10–15 decisions for a normal product; scale with genuine complexity, not with
document length. If they tire, offer: *"I can take my recommended defaults for
the rest of this section and you review the written result."* Record those as
assumptions rather than pretending they were chosen.

**Stay on the *what*.** No code, no libraries beyond naming the stack, no method
names, no algorithms, no retry strategies, no schema types. Those belong to
`/design` and to the implementer. A PRD that specifies *how* forecloses better
options and dates immediately. Name the stack and the providers; stop there.

---

## Steps

### Step 1 — Understand the shape before asking details

Read `--from` notes if given, and any existing code, `CONTEXT.md`, or PRDs in
the repo. Then assess scope **before** spending questions: if this is several
independent products, say so and help split it. Refining details of something
that needs decomposing first wastes the whole budget.

### Step 2 — Problem, users, and the one-line goal

What breaks today, for whom, and what observable change means success. If the
goal cannot be stated in a sentence, the product is not yet one product.

### Step 3 — Functional requirements, one id each

Each `FR-n` is **one** discrete, observable behaviour. Split any bullet that
bundles two claims — a bundled requirement is one a story can half-satisfy while
every gate stays green.

Aim for the smallest set that delivers the goal. Ask, for each: *would we ship
without this?* If yes, it belongs in a later milestone or in Out of Scope.

### Step 4 — Non-functional requirements, with numbers

`NFR-n` for performance, security, privacy, availability, accessibility. Give a
number or a named standard — "p95 < 200 ms", "WCAG 2.1 AA", "AES-256 at rest".
"Fast" and "secure" cannot be verified, so nothing downstream will try.

Use the ten-slot taxonomy (`/brd` Step 4.45) as a checklist of what to *ask*
about: data lifecycle, integration, performance, security/authz,
privacy/retention, observability, operability/failure, UX/accessibility,
constraints. A slot with nothing in it is a decision to say so, not an oversight.

### Step 5 — Out of Scope, explicitly

Every non-goal becomes a **Forbidden Action** the autonomous gate enforces. This
is the section people skip, and skipping it is what lets an agent build the
mobile client nobody asked for. **Silence is read as permitted.**

Name what a reasonable reader might otherwise assume is included.

### Step 6 — One postcondition per FR

For each `FR-n`, an end-state a machine can observe: an API response, a UI state,
a row in a table, a file on disk. Not "works correctly".

This is the step to spend real time on. It is the evaluator's only oracle, and
it is the one most PRDs skip.

### Step 7 — Milestones

Propose a default sequence of three, plus a fewer-and-bigger and a
more-and-smaller alternative, with the trade-off stated plainly: fewer
milestones mean larger unattended runs and more risk per run; more mean more
checkpoints and more context-switching.

Each milestone must deliver **visible, working functionality** — something you
can exercise in a browser or a CLI — and be small enough for one agent session.
Give each a `Done when:` that is observable.

Milestones feed `/spec`: its `milestone.epics` decides what gets decomposed to
story depth now and what stays at epic granularity, which is the single biggest
control on how much the pipeline generates.

### Step 8 — Write and validate

Write to the given path (default `prd/<product>.md`) following
`docs/prd-format.md`, then:

```bash
node .claude/scripts/validate-prd.js <path>
```

Fix what it blocks. Warnings are judgement calls — a vague NFR or an
unobservable milestone — so either fix them or say why you are accepting them.

### Step 9 — Hand off

Show the human the written PRD and ask them to read it before anything consumes
it. Then:

- `/build <path>` for the full greenfield pipeline
- `/brd --prd <path>` to enter at the requirements phase
- `/sprint <path>` when a prior sprint's design already exists

---

## Output

| File | Purpose |
|------|---------|
| `prd/<product>.md` | The PRD — human-owned, and the immutable grounding baseline once the pipeline starts |

---

## Gate

`validate-prd.js` **blocks** on: a missing Out of Scope / Non-goals section, an
empty deny-list, no functional requirements, duplicate ids, placeholder text
(`TBD`/`TODO`/`XXX`), an acceptance entry naming a requirement that does not
exist, and any FR with no acceptance postcondition.

It **warns** on: an NFR with no number or named standard, and a milestone with a
missing or unobservable `Done when:`.

It accepts the shapes real PRDs use — bullets under a Functional Requirements
section, one heading per requirement, or bold pseudo-headings, with acceptance
either in its own section or as an inline `**AC:**` line. Heading text is not
what matters; ids and postconditions are.

---

## Gotchas

- **Do not write the PRD and then ask "does this look right?"** That is the
  failure this whole lane exists to fix: it moves the entire cost of review onto
  the human and the cheapest correct answer is always yes.
- **Do not invent a number nobody chose.** A retention window or a latency
  target you made up reads as decided the moment it is written down, and the
  grounding gate will then carry it faithfully into the build.
- **Do not specify *how*.** Every implementation detail here is a decision taken
  away from `/design` with less information than it will have.
- **An empty Out of Scope is not "no constraints"** — it is a deny-list the
  autonomous lane will treat as empty.
