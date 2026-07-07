# Python (FastAPI) & React Specialty Pack — Design

**Date:** 2026-07-07
**Status:** Approved design, ready for implementation planning
**Related (read for full context, not duplicated here):**
- `docs/superpowers/specs/2026-07-06-expert-generalist-scaffold-composition-design.md` — the three-layer architecture (generalist core + tech-stack specialties + domain specialties) this design extends.
- `docs/superpowers/plans/2026-07-06-tech-stack-specialty-pack-implementation.md` — the `python-ai-agents` pack (`langgraph-code`/`langchain-code`/`deepagents-code`) this design mirrors in shape, but diverges from in attach mechanism (see below).
- `.claude/config/framework-skill-packs.json` — the existing registry this design adds two entries to.

## Context & Motivation

`python-ai-agents` proved the "author a local, harness-owned skill pack grounded in real fetched docs" pattern for a fast-moving, thin-training-data domain (LangGraph/LangChain/DeepAgents). Python (FastAPI) and React are the opposite kind of domain: mature, stable, heavily represented in training data — the generalist core likely already handles basics well. The case for a dedicated pack here is narrower and specific: not teaching Python or React from scratch, but capturing the *current, easy-to-get-wrong, opinionated* details a generic model answer tends to miss (Pydantic v2 migration gotchas, async/sync route pitfalls, stale-closure bugs, Vite-specific config traps) — the same "editorial layer, not tutorial" discipline the `langchain-agents-*` pack (audited 2026-07-07, see `docs/architecture/expert-generalist-scaffold-composition.md`'s related session notes) demonstrated works well for this kind of content.

**The bigger architectural difference from `python-ai-agents`:** that pack is an *opt-in* framework choice, orthogonal to the base stack — a user asks for it explicitly. FastAPI and React are not add-ons here; they're already captured by `/scaffold`'s existing Step 1 stack question (Q2), and are in fact this harness's own default preset (`backend: fastapi`, `frontend: react` — Preset A). Treating them as a second, separate opt-in choice would be redundant and easy to forget. This design instead **auto-attaches** the specialty content based on the stack answer the user already gave.

## Scope

- Two new `"source":"local"` registry entries in `.claude/config/framework-skill-packs.json`: `fastapi-code` (one skill) and `react-code` (one skill) — mirroring `python-ai-agents`' shape (bundled, no install step, copied by the existing `copyFrameworkPackSkills`), but each independently attachable rather than bundled together.
- Auto-attach logic added to `.claude/commands/scaffold.md` Step 2: no new interactive question. `fastapi-code` attaches whenever `stack.backend.framework === "fastapi"`; `react-code` attaches whenever `stack.frontend.framework === "react"` (the Vite variant — confirmed via `scaffold.md`'s Preset A/C: `frontend: typescript/react/vite/...`) and explicitly **not** `"nextjs"` (Preset B). This is additive to whatever the user explicitly chose in the existing AI-agent tech-stack-pack question — a project can end up with `frameworkPacks: ["python-ai-agents", "fastapi-code", "react-code"]` all at once.
- Content authored fresh from live official docs during implementation (not reused from any external pack), same discipline as `python-ai-agents`.

Out of scope (deferred, same pattern as other FSI verticals being demand-gated): Next.js-specific content (App Router, Server Components, Server Actions — a different enough rendering model to need its own pack), database/ORM patterns (SQLAlchemy — attach only when `database.primary` is actually set, a separate future pack), Preset C's `express` backend (Node, not Python — no backend pack attaches there, only `react-code` would via the frontend match).

## Attach Mechanism

No new copy code. `scaffold-copy.js`'s existing `copyFrameworkPackSkills(pluginSource, target, frameworkSkillPacks)` (built for `python-ai-agents`) already copies whatever `"source":"local"` entries are named in `profile.frameworkPacks` — it has no opinion on how that array was populated.

The only new logic is prose, in `.claude/commands/scaffold.md`'s existing `## Step 2: Generate project-manifest.json` section. Add an explicit sub-step:

> **Auto-attach stack-matched specialty packs.** After the interview, before assembling `frameworkPacks` for the profile: if `stack.backend.framework` is `"fastapi"`, include `"fastapi-code"`. If `stack.frontend.framework` is `"react"` (not `"nextjs"`), include `"react-code"`. These are additive to any AI-agent packs the user explicitly selected in the tech-stack-pack question (Step 1.E Q7) — a project can have any combination of `python-ai-agents`, `fastapi-code`, `react-code`, plus the external `langchain`/`google-adk` entries.

This mirrors the existing prose-driven inference rules already in Step 1.B ("Tech-stack pack — keyword match in Q1", "Domain vertical — keyword match in Q1") — an instruction the `/scaffold`-executing agent follows, not code. Same testability profile as those rules: verified by a wiring test asserting the instruction text exists, not by simulating the interactive flow.

## Content Plan

Both skills follow the existing `SKILL.md` + `references/*.md` progressive-disclosure shape, each reference file citing its real source URL (fetched fresh during implementation, not reused from training-data memory or from the audited external `langchain-agents-*` pack, whose license/attribution doesn't cover copying into this harness's own pack).

**`fastapi-code`** — sourced from `fastapi.tiangolo.com` (dependency injection, background tasks, testing) and `docs.pydantic.dev` (v2 validation model, migration notes from v1):
- `SKILL.md`: when to reach for this vs. plain-Python request handling; quick reference to the two reference files.
- `references/dependency-injection-and-validation.md` — `Depends()` patterns, Pydantic v2 model validation, common v1→v2 migration gotchas (e.g. `@validator` → `@field_validator`, `.dict()` → `.model_dump()`).
- `references/async-and-testing.md` — async vs. sync route pitfalls (blocking calls in async routes silently stall the event loop), background tasks (`BackgroundTasks` vs. a real task queue — when each is appropriate), testing with `TestClient` and `pytest-asyncio` gotchas (fixture scope, event loop reuse across tests).

**`react-code`** — sourced from `react.dev` (hooks reference, common pitfalls) and `vitejs.dev` (config, dev-server behavior):
- `SKILL.md`: when this applies (Vite+React client-side apps — explicitly not Next.js), quick reference to the reference file(s).
- `references/hooks-and-state.md` — stale-closure bugs in `useEffect`/`useCallback`, cleanup-function gotchas, when to reach for Context vs. a server-state library (e.g. TanStack Query) for API data vs. local UI state.
- `references/vite-and-testing.md` — Vite-specific config traps (env var prefixing, dev-vs-build behavior differences), testing with Vitest (jsdom setup, common React Testing Library pitfalls).

Exact reference-file boundaries may shift slightly once real source material is fetched (same caveat the `python-ai-agents` plan carried) — the file *shape* is fixed by this design, not the precise topic split.

## Testing Plan

- Registry-shape test: `framework-skill-packs.json` has `fastapi-code` and `react-code` entries, `"source":"local"`, each with the correct single-skill `skills` array — same pattern as the existing `python-ai-agents` registry test.
- Wiring test: `scaffold.md`'s Step 2 section contains the auto-attach instruction naming both `fastapi-code` (tied to `stack.backend.framework === "fastapi"`) and `react-code` (tied to `stack.frontend.framework === "react"`, explicitly excluding `"nextjs"`).
- Skill-content wiring tests: frontmatter + reference-file existence + source-URL citations, per skill — same pattern as `langgraph-code`/`langchain-code`/`deepagents-code`.
- Integration test (proves the mechanism, not the inference): a profile with `stack.backend.framework: "fastapi"` and `frameworkPacks: ["fastapi-code"]` passed to `copyFrameworkPackSkills` results in the skill landing in the target `.claude/skills/`. This is the same test Plan B already wrote for `python-ai-agents` — no new mechanism code means no new mechanism test category, just new fixture data.
- Full-suite smoke check: run `/scaffold` (or `scaffold-apply.js` directly, as done for Plan B) against a Preset-A-shaped profile and confirm both `fastapi-code` and `react-code` land in the target project without the user having answered any new question.

## Risks

- **Content that ages faster than expected.** FastAPI/Pydantic/React/Vite are mature, but not frozen — Pydantic v2's own migration notes are themselves a moving target as v1 usage fades. Same mitigation as `python-ai-agents`: cite sources, treat as a snapshot to re-verify, not a permanent fact.
- **Attach-mechanism drift if Step 1's stack question ever changes its answer shape.** The auto-attach instruction hardcodes the exact strings `"fastapi"` / `"react"` / `"nextjs"` from the current three presets (`scaffold.md` lines documenting Presets A/B/C). If a future preset introduces a new backend/frontend framework value, the auto-attach rule needs a matching update — same category of risk the existing Step 1.B keyword-inference rules already carry, not a new one this design introduces.
- **Redundancy with `python-ai-agents` in a project that picks both.** A FastAPI backend building AI agents would get `fastapi-code` (web-framework idioms) and `python-ai-agents` (agent-framework idioms) simultaneously — this is intentional layering (different concerns), not overlap; confirmed no content collision since `python-ai-agents`' skills never touch FastAPI/Pydantic web-layer topics.

## Out of Scope

- Next.js-specific content — a real future pack once there's demand, not a gap in this one (deliberately excluded, not deferred by oversight).
- Database/ORM (SQLAlchemy) content — same treatment; attach condition would be `database.primary` being set, independent of backend framework.
- Preset C's Node/Express backend — no backend specialty pack attaches; `react-code` still attaches via the frontend match, which is correct (React content is backend-agnostic).
- Any change to `CORE_AGENTS`, model tiers, or the AI-agent tech-stack-pack question (Step 1.E Q7) — unaffected by this design.
