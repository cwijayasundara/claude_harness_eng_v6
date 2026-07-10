## Doc-Only Mode (`--doc-only`)

> A **disposable artifact** lane (see CLAUDE.md → *Disposable Artifacts*). It does **not** spawn the planner, generator, or evaluator; it produces **no** machine-readable schemas, mockups, trace spines, or grounding gates; it runs **no** ratchet loop and **no** security review. There is no story prerequisite. Skip every numbered step below — they belong to full mode only.

When `--doc-only` is present, do exactly this and stop:

1. **Gather context, don't generate it.** Read whatever already exists that is relevant — `CONTEXT.md`, ADRs, `specs/brownfield/` maps, existing source, `README.md`. If the request is ambiguous about scope or audience (ARB? internal proposal? RFC?), ask one or two clarifying questions before writing. Skip `superpowers:brainstorming` and the clarify skill's full budget — this is a write-up, not a design gate.

2. **Author one document.** Write a single self-contained Markdown file containing the sections an architecture/ARB review actually needs:
   - Context & problem statement (what, why, who it's for)
   - Proposed architecture: components, responsibilities, data flows, key interfaces
   - Design decisions & trade-offs considered (the part an ARB cares about most — alternatives weighed, not just the choice)
   - Risks, dependencies, and open questions
   - Diagrams as inline Mermaid where they clarify (sequence/component/deployment)

3. **Write it where the human wants it.** If a path argument was given, use it. Otherwise default to `docs/architecture/<slug>.md` (create the directory if needed) — **not** `specs/design/`, which is reserved for the SDLC pipeline's machine-readable artifact set.

4. **Stop.** Do not write schema files, do not produce mockups, do not spawn agents, do not run `trace-check.js`, do not run the evaluator. Present the document path and a one-paragraph summary. If the work later needs to become shipped code, that is a separate decision to enter the full pipeline (`/spec` → `/design` → `/auto`).

---
