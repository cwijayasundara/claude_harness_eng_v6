---
name: arch-doc
description: Author a standalone architecture / ARB (Architecture Review Board) narrative document. Disposable artifact — no SDLC pipeline, no planner/generator/evaluator, no schemas or mockups.
---

# arch-doc — Architecture / ARB Narrative

Produces a single self-contained Markdown document for design discussion: ARB write-ups, design proposals, RFCs. This is a **disposable artifact** lane — it spawns no agents, generates no machine-readable schemas, runs no ratchet loop and no security review.

> Equivalent to `/design --doc-only` in the full `claude_harness_eng_v5` loadout. Use this when running the slim `harness-lite` loadout, where the full `/design` skill is intentionally absent.

## Usage

```
/arch-doc                 # write to docs/architecture/<slug>.md
/arch-doc [path]          # write to [path] instead
```

## Flow

1. **Gather context, don't generate it.** Read what already exists and is relevant — `CONTEXT.md`, ADRs, existing source, `README.md`, prior design docs. If scope or audience is genuinely ambiguous (ARB review? internal proposal? RFC?), ask one or two clarifying questions before writing. Do not run a brainstorming ceremony or a clarification budget — this is a write-up.

2. **Author one document** with the sections an architecture review actually needs:
   - **Context & problem statement** — what, why, who it's for.
   - **Proposed architecture** — components, responsibilities, data flows, key interfaces.
   - **Design decisions & trade-offs** — the alternatives weighed and why, not just the chosen option. This is what an ARB scrutinizes most.
   - **Risks, dependencies, open questions.**
   - **Diagrams** — inline Mermaid (sequence / component / deployment) where they clarify.

3. **Write it** to the given path, or default to `docs/architecture/<slug>.md` (create the directory if needed).

4. **Stop.** No schemas, no mockups, no agents, no evaluator. Present the document path and a one-paragraph summary. If the design later needs to become shipped code, that is a deliberate decision to switch to the full loadout and enter the pipeline (`/spec` → `/design` → `/auto`).
