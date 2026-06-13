# harness-lite

The artifact-only loadout. Load this **instead of** `claude_harness_eng_v5` when the work is producing **disposable artifacts** — UI mockups, architecture / ARB (Architecture Review Board) narrative documents, and research or analysis reports.

## What this loadout deliberately does NOT have

No SDLC pipeline, no generator/evaluator (GAN) loop, no ratchet gates, no security review, no TDD enforcement, and **no quality-gate hooks**. That absence is the point: in this loadout it is structurally impossible to trigger the heavyweight machinery. Disposable artifacts explain, explore, or persuade — they do not ship, so they do not need contracts, reviewers, or verification gates.

There are no `/build`, `/auto`, `/implement`, `/change`, `/refactor`, or `/scaffold` commands here. If a task genuinely needs to produce shipped product code, that is a signal to switch to the full `claude_harness_eng_v5` loadout — not something to work around here.

## Lanes

| Artifact | Lane |
|----------|------|
| Architecture / ARB / design narrative | `/arch-doc` skill |
| UI mockup / component / page | `/mockup` skill (uses `frontend-design` if installed) |
| Research / deep dive / analysis | `/research` skill (uses `deep-research` if installed) |

## Working style here

Bias toward producing the artifact directly. Gather existing context (READMEs, ADRs, source, prior docs) before writing, and ask a clarifying question when scope or audience is genuinely ambiguous — but do not run a full design gate, a brainstorming ceremony, or a TDD loop for a document or a mockup. Keep it surgical and readable; match the conventions of any existing artifacts in the workspace.
