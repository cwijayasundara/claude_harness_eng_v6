---
name: research
description: Produce a research / analysis / deep-dive report as a disposable artifact. No SDLC pipeline, no evaluator, no security review.
---

# research — Research / Analysis Report

Produces a cited research or analysis write-up. **Disposable artifact** lane — no pipeline, no agents teams, no ratchet gates, no security review.

## Flow

1. **Prefer `deep-research`.** If the `deep-research` skill is available, invoke it — it fans out web searches, fetches sources, adversarially verifies claims, and synthesizes a cited report. Before invoking, make sure the question is specific enough; if it is underspecified, ask 2–3 clarifying questions to narrow scope, then pass the refined question.

2. **If `deep-research` is not installed,** run a focused research pass yourself: search, read sources, cross-check key claims against more than one source, and synthesize. Cite sources inline.

3. **Write** the report to `research/` (or a path the user names) as Markdown and report the path. This is an artifact for human consumption — it does not need tests or a verification gate.
