---
name: writing-acceptance-tests-first
description: Use when a story is about to move from acceptance criteria to implementation — in /test's plan-phase deliverable or /change Step S4, before any production code is written — to write a business-readable acceptance test against a Ports-and-Adapters seam with a test-double adapter, and confirm it fails for the right reason before implementation proceeds. [Internal discipline — applied automatically by pipeline agents mid-task; direct use is a power-user path.]
---

# Writing Acceptance Tests First

Full-stack E2E is the wrong place to ask "did the agent understand the requirement?" — it is slow, flaky, and a failure means log-spelunking through a browser and a server instead of reading one assertion. Matteo Vaccari's fix (*Acceptance Tests for AI-Assisted Development*) is a fast, business-readable Acceptance Test (AT) layer: business rules on the "inside," I/O on the "outside" via a Ports-and-Adapters seam, so the AT calls business logic directly through an in-process port with a test-double adapter standing in for real I/O. E2E does not go away — it stays as the final full-stack confirming layer — but it stops being the *primary* acceptance-criteria verification loop. A human reading the AT and understanding the requirement from it is itself the correctness signal: "if it's hard to understand, we probably better iterate until it becomes easy."

## The Iron Law

```
NO IMPLEMENTATION UNTIL AN ACCEPTANCE TEST EXISTS, FAILS FOR THE RIGHT REASON,
AND A HUMAN COULD READ IT AND UNDERSTAND THE REQUIREMENT
```

## Process

1. **Locate or request the human-provided AT template.** This discipline only works well with a concrete example of what an AT looks like in this codebase. Check `specs/test_artefacts/at-template.md` (narrative Given/When/Then shape) and its paired concrete example file `specs/test_artefacts/at-template.<ext>` (extension matching the project's test stack). If found, treat it as binding house style — match its structure exactly. If neither exists, this is the **first AT for the codebase**: write it using the process below — starting from the shipped `.claude/templates/at-template.py` Ports-and-Adapters house pattern (a port + a fake test-double adapter) rather than from scratch — then **stop and flag it explicitly for human confirmation** before treating it as the template for subsequent stories. An unreviewed first AT is a draft, not a convention — never silently promote it.
2. **Identify the Ports-and-Adapters seam.** Reuse existing seam-finding machinery rather than inventing a new concept: if `specs/brownfield/seams-<goal-slug>.md` already exists for this story's goal, read it and prefer a candidate whose recommended action is `extend` (a port already exists — add behavior there) or `introduce-adapter` (no clean port yet — extract one first, then test against it). If no seam file exists yet for this goal, run `/seam-finder "<story goal>"` before writing the test. For a brand-new greenfield module with nothing to score yet, design the port directly from the story's acceptance criteria — a narrow interface the business logic depends on for I/O — and say explicitly that seam-finder didn't apply rather than forcing a fit. The chosen seam's function/class is the in-process entry point the AT calls directly — never through HTTP, a browser, or a CLI.
3. **Design the port and its test-double adapter.** The real adapter (DB, external API, clock, filesystem) is one implementation of the port; the AT uses a fake/in-memory adapter as the other — fast and deterministic, not flaky. Register the fake at the call site or through small, composable per-adapter registration. Never grow a single monolithic `Create()`/setup function that takes every handler, service, and dependency as a parameter — that argument list only grows and is a named antipattern (see Red Flags).
4. **Write the AT in Given/When/Then form**, in language a non-technical stakeholder could follow: concrete example data (a real-looking order, a named user), no framework or transport jargon in the narrative. The test calls the business logic directly through the port, with the fake adapter standing in for I/O.
5. **Run it. Confirm it fails for the right reason.** A red AT that fails because the target function doesn't exist yet, or because the assigned behavior is simply missing, is a legitimate first red — the AT is allowed to define the port's shape before the implementation exists. A red AT that fails on a typo, a bad import, or a setup mistake proves nothing; fix the test, not the assertion, and re-run until it fails for the *behavior* reason. Once it fails for the right reason, run it through `node .claude/scripts/record-at-red.js --story <story-id> --at-file specs/test_artefacts/acceptance/{story-id}.<ext> --test-cmd "<AT test command>"` — this is the mechanical proof-of-process gate (`at-first-gate.js`, gap G23): a red run appends a receipt that pre-commit later requires before a story's new production files can be committed, while a green run records nothing and exits loudly instead.
6. **Only now, proceed to implementation.** The AT is the acceptance oracle for this story going forward: green means the business logic satisfies the requirement, independent of the full stack. The Playwright E2E layer (generated separately, e.g. `/test` Step 5) remains the final full-stack confirmation layer — this AT does not replace it, and its existence does not excuse skipping E2E generation.
7. **Surface the AT for human readability review.** At handoff/PR time, point the reviewer at the AT file specifically and ask whether it reads as a plain description of the requirement. If it's hard to follow, iterate on the test — and if necessary the underlying acceptance criteria — until it's easy, rather than shipping a technically-correct but unreadable AT.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "E2E already covers this AC" | E2E-as-AT-implementation: slow, flaky, full-stack, and a failure means log-spelunking. It is the final confirming layer, not the primary acceptance loop — write the AT too. |
| "I'll just add another parameter to the setup function for the fake adapter" | Monolithic API-definition function antipattern — a `Create`/setup call taking every handler and dependency only grows. Register adapters individually and compositionally instead. |
| "The AT passed on the first try, no need to watch it fail" | Green-before-red proves nothing — the same discipline `pinning-down-behavior` applies to characterization tests. An AT that never failed might be testing nothing. |
| "It's clear to me, that's good enough" | Readability is judged by the intended non-technical reader, not the author. If you can't imagine a stakeholder following it, it isn't done. |
| "No template exists yet, I'll just write whatever and move on" | The first AT on a codebase must be explicitly flagged and confirmed by a human before it is treated as the pattern for every AT after it. |
| "This story is trivial, skip the AT and go straight to code" | Trivial stories are exactly where an AT is cheap and where skipping it first normalizes skipping it everywhere else. |

## Red Flags — STOP

- Writing the AT against an HTTP client, browser driver, or full stack when a Ports-and-Adapters seam is available and appropriate (E2E-as-AT-implementation)
- A setup/`Create` function accumulating another parameter for every new handler, service, or adapter (monolithic API-definition function)
- An AT that passes against unmodified/unimplemented code
- An AT a non-technical reader could not follow — internal type names, transport jargon, no concrete example data
- Treating an unreviewed first AT as the permanent template without explicit human confirmation
- Implementation started before the AT is written and observed red for the right reason

## Checklist

- [ ] Human AT template located and matched (or first-AT-becomes-template explicitly flagged for confirmation)
- [ ] Ports-and-Adapters seam identified — reused `/seam-finder` output where it exists, or a minimal new port designed and the mismatch stated explicitly
- [ ] AT calls business logic directly through the port with a fake/test-double adapter, not through UI/HTTP
- [ ] Adapter registration is composable — no monolithic setup-function parameter growth
- [ ] AT is business-readable: Given/When/Then, concrete example data, no jargon
- [ ] AT run and confirmed red for the right reason before any implementation, via `record-at-red.js` (records the commit-time proof receipt)
- [ ] AT flagged for human readability review, not just correctness
- [ ] Implementation now proceeds; Playwright E2E generation remains intact as the final full-stack layer

Write the acceptance test first, watch it fail for the right reason, then implement. No exceptions without your human partner's permission.
