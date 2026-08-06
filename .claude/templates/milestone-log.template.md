# Milestone {{MILESTONE_ID}} — {{MILESTONE_NAME}}

<!--
Written at the END of a milestone, by the session that built it.

Dual-audience on purpose. The first section is for a human deciding whether to
keep going; everything after it is for the NEXT milestone's agent session, which
starts with no memory of this one. Without it, each session re-derives the state
of the system from the PRD — a document that describes what was intended, not
what exists.

Copied from .claude/templates/milestone-log.template.md to
specs/milestones/{{MILESTONE_ID}}-log.md.
-->

## What's new in the app

<!-- Capabilities, in the language of someone using the product. Not files, not
     modules, not "implemented the FooService". If you cannot say what a user
     can now do that they could not before, that is worth noticing. -->

- …

## Done when — met or not

<!-- The milestone's own exit criteria from the PRD, each marked met / not met /
     partially met, with the evidence. Not a self-assessment: name the check. -->

| Criterion | Verdict | Evidence |
|---|---|---|
| … | met / not met | test id, endpoint, screenshot path |

---

## For the next session

### What was built

<!-- Files, modules, routes, tables added or changed. Enough that the next
     session can navigate without re-reading the whole tree. -->

- …

### Decisions taken that the PRD did not specify

<!-- The load-bearing ones only. Each becomes a constraint the next milestone
     inherits, and an implementer who does not know about it will contradict it.
     Say what it rules out, the same way a design decision does. -->

| Decision | What it rules out | Why |
|---|---|---|
| … | … | … |

### Deviations from the PRD, and why

<!-- The section people skip, and the one that matters most. A deviation nobody
     recorded becomes a silent divergence between the document the pipeline
     grounds against and the system that actually exists — after which every
     downstream traceability gate is proving something about the wrong thing.
     If there were none, write "none" explicitly rather than deleting the
     section. -->

- …

### Known gaps carried forward

<!-- Anything deferred, stubbed, or left failing — with its story/requirement id
     so the next milestone's scope decision can see it. -->

- …
