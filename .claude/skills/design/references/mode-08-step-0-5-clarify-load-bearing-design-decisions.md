## Step 0.5 — Clarify Load-Bearing Design Decisions

Invoke `.claude/skills/clarify/SKILL.md` only for decisions that materially affect API contracts, data models, security/privacy, external integrations, deployment topology, or file ownership.

Use the clarification budget:
- Ask at most 10 questions by default.
- Continue to 15 only if the user explicitly asks.
- Prefer existing code, `CONTEXT.md`, ADRs, stories, and manifest data over asking.
- Record assumptions in `architecture.md` or `api-contracts.md` when risk is low.

**Required glossary read.** Before the planner names any entity, read `CONTEXT.md` if present. Every entity in `data-models.schema.json`, `api-contracts.schema.json`, and the REASONS Canvas `Entities` section must use `CONTEXT.md`'s term for that concept. A new domain concept goes into `CONTEXT.md` first (add a `### <term>` entry), then into the schema — never invent a name in the schema alone.
