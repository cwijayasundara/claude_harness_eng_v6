yes# Composing an "Expert Generalist" Engineer at Scaffold Time

**Status:** Proposal (disposable architecture narrative — not an SDLC gate, not `specs/design/`)
**Date:** 2026-07-06
**Grounding:** deep-research workflow (5 search angles, 20 sources fetched, 25 claims adversarially verified 3-vote, 17 confirmed / 7 refuted / 1 unverified — full journal at `.superpowers`-adjacent task output, summarized below with citations), plus direct reads of this repo's `scaffold-copy.js`, `scaffold.md`, `install-framework-packs/SKILL.md`, `docs/model-allocation.md`, and `docs/architecture/vertical-glossary-seeding-generalization.md`.

## Context & Problem Statement

Martin Fowler's ["Expert Generalist"](https://martinfowler.com/articles/expert-generalist.html) does not describe a jack-of-all-trades. It describes fluency in broad fundamentals plus **several** deep specialties of varying depth, with the differentiating meta-skill being the ability to "spot the fundamentals that run beneath shifting tools and trends, and apply them wherever they land" — confirmed verbatim from the primary source (3-0 verification vote). One refuted claim worth flagging so it doesn't creep back in: Fowler's article does **not** use "T-shaped" or "comb-shaped" terminology (checked, 0-3) — describe the multiple-specialties idea in the article's own words, not that borrowed metaphor.

That maps directly onto a three-layer engineering-agent architecture: a thin, tool-agnostic **generalist core** (TDD, systematic debugging, code review, clean-code discipline) plus swappable **tech-stack specialties** (Python/FastAPI/LangChain/LangGraph/DeepAgents, or any other stack) plus swappable **domain specialties** (private equity, other FSI verticals, insurance once it exists). This is not a novel idea to justify from scratch — it is the industry's converged pattern. Anthropic's own Claude Code Skills design explicitly rejected building narrow domain-specific agents in favor of "one general-purpose agent... equipped with Skills," using the same math-genius-vs-tax-professional framing (competence via loaded skill content, not via a different base agent) — confirmed 3-0 against two independent Anthropic sources ([building-agents-with-skills](https://claude.com/blog/building-agents-with-skills-equipping-agents-for-specialized-work), [skills](https://claude.com/blog/skills)). The mechanism that makes this tractable without context bloat is Skills' three-tier progressive disclosure (metadata catalog ~50 tokens → full `SKILL.md` ~500 tokens on trigger → bundled reference files loaded only as needed) — also 3-0 confirmed, cross-checked against Anthropic's engineering blog.

**The good news: this repo already has all three layers, just unevenly matured.** This proposal's job is to name the architecture explicitly, generalize the layer that's still hardcoded, and flag what must be verified (not assumed) before calling the tech-stack side "done."

## What Already Exists (verified by direct file read, not assumed)

1. **Generalist core.** `.claude/scripts/scaffold-copy.js:21-39` enumerates it explicitly: 8 `CORE_AGENTS` (clean-code-reviewer, design-critic, diff-reviewer, evaluator, generator, planner, security-reviewer, codebase-explorer) and 29 `CORE_SKILLS` (the full SDLC pipeline — `brd`, `spec`, `design`, `implement`, `code-gen`, `refactor`, `vibe`, `checking-coverage-before-change`, etc.). `BROWNFIELD_SKILLS` at line 37-39 is literally `= CORE_SKILLS` — brownfield mode reuses the identical generalist core rather than adding a separate skill set. `selectedCopySet()` (lines 113-119) confirms every scaffold profile copies this same fixed set regardless of chosen stack or domain. **This is Fowler's generalist core, already shipped.**

2. **Tech-stack specialty layer (partially generalized).** `project-manifest.json#framework_skill_packs` + the `install-framework-packs` skill is exactly the composition mechanism this research asked whether the harness needed to invent — it doesn't. Today it registers two packs in prose inside `install-framework-packs/SKILL.md`: `langchain` → `github.com/cwijayasundara/agent_cli_langchain` (9 skills) and `google-adk` → `github.com/google/agents-cli` (7 skills). Critically, the `langchain` pack's own declared skill list (`.claude/commands/scaffold.md:590-619`) already includes `langgraph-code` and `deepagents-code` as named, scoped sub-skills alongside `langchain-code` — **LangGraph and DeepAgents are not an unaddressed gap in kind.** They already exist as distinct skills inside an installable pack.

3. **Domain specialty layer (already being generalized, separately).** `docs/architecture/vertical-glossary-seeding-generalization.md` (this repo, same session) proposes exactly the registry pattern the tech-stack side is still missing: a declarative `.claude/config/vertical-glossary-packs.json` instead of a hardcoded per-vertical script, so a new FSI vertical (or, eventually, insurance) is a config entry, not new code.

## What's Genuinely Missing

**1. The tech-stack side lacks the registry generalization the domain side already has.** `install-framework-packs/SKILL.md:23` states: *"If `framework_skill_packs` contains a key not in this registry, report it as unknown and skip — do not invent install commands."* That "registry" is a two-row table written in prose inside a skill file, not data. Every new pack today requires editing `SKILL.md` prose. This is the direct tech-stack-side analog of the domain-side gap the vertical-glossary proposal already closed — it should be closed the same way, for consistency and so `/scaffold` can validate/list packs programmatically instead of a human reading a markdown table.

**2. No single scaffold-time step composes stack + domain together.** Today, `framework_skill_packs` is chosen in `/scaffold` Step 4 (tech stack), while a vertical plugin like `private-equity` is enabled through an entirely separate mechanism (`enabledPlugins` in `.claude/settings.json`, set up outside the scaffold flow, e.g. via `claude plugin install`). A user wanting "Python + FastAPI + LangChain/LangGraph/DeepAgents senior engineer with private-equity domain skills" has to know to do both, through two different systems, at two different times. Fowler's model treats stack and domain specialties as peers (both are "a few deep specialties atop the generalist core") — the scaffold UX should treat them as peers too: one composition step, two independent choices.

**3. Unverified: does the existing `langgraph-code`/`deepagents-code` skill *content* actually teach the right things?** This is the load-bearing caveat from the research, not a minor footnote. The pack's real file contents (`github.com/cwijayasundara/agent_cli_langchain`) were not fetchable this session — everything known about it comes from this repo's own `scaffold.md` prose describing the pack, not the pack's own source. Research independently confirmed (3-0 each) what a *good* LangGraph/DeepAgents skill needs to teach:
   - LangGraph: agents as explicit state machines/graphs (nodes + conditional edges, not linear chains), checkpointer configuration for crash/interrupt recovery, `interrupt()`-based human-in-the-loop placement ([langchain.com/langgraph](https://www.langchain.com/langgraph), [LangGraph persistence docs](https://docs.langchain.com/oss/python/langgraph/persistence)).
   - DeepAgents: not a separate engine — an opinionated middleware layer on top of LangGraph (`create_deep_agent` returns a `CompiledStateGraph`), with a specific default middleware stack: `TodoListMiddleware` (planning), `FilesystemMiddleware`, `SubAgentMiddleware` (sub-agent spawning, on by default and deliberately hard to remove), `SummarizationMiddleware` (context compression at ~85% capacity), `PatchToolCallsMiddleware` ([DeepWiki architecture overview](https://deepwiki.com/langchain-ai/deepagents/1.3-architecture-overview), [LangChain's own deep-agents page](https://www.langchain.com/deep-agents)).
   - Refuted, do not assume: DeepAgents does **not** have a separate native `SkillsMiddleware` distinct from Claude-Code-style `SKILL.md` packs (checked 1-2, treat as refuted) — don't conflate DeepAgents' internal concepts with this harness's skill-pack mechanism when auditing or authoring content.

   Until someone reads the actual pack source and confirms it covers this, "LangGraph/DeepAgents support" in this harness is a claim about skill *names*, not skill *depth*.

**4. No agent/model-tier change needed (medium-confidence inference, not a sourced fact).** `docs/model-allocation.md:7-43`'s fixed role-based tiers (planner=Opus, generator=Sonnet, evaluator/design-critic/security-reviewer=Opus, codebase-explorer=Sonnet) are assigned by *judgment-vs-volume role*, not by tech stack. No external source found suggests LangGraph-heavy projects need a structurally different reviewer agent. The correct lever is injecting stack-specific content into the existing generator/reviewer prompts via the framework pack's `SKILL.md` (progressive disclosure already does this), not spawning a new agent or changing model tiers.

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Generalist Core (unchanged) — CORE_AGENTS + CORE_SKILLS     │
│  TDD · systematic debugging · code review · clean code       │
└─────────────────────────────────────────────────────────────┘
                    ▲                           ▲
                    │                           │
   ┌────────────────────────────┐   ┌────────────────────────────┐
   │ Tech-Stack Specialty Packs │   │ Domain Specialty Packs      │
   │ .claude/config/            │   │ .claude/config/              │
   │  framework-skill-packs.json│   │  vertical-glossary-packs.json│
   │  (NEW — mirrors domain side)│  │  (already proposed, this repo)│
   │ e.g. langchain (→langgraph- │  │ e.g. private-equity (→CONTEXT│
   │  code, deepagents-code)     │  │  .md seeding, this session)  │
   └────────────────────────────┘   └────────────────────────────┘
```

**Registry entry shape** (`.claude/config/framework-skill-packs.json`, new — mirrors `vertical-glossary-packs.json`'s already-proposed shape):

```json
{
  "packs": [
    {
      "key": "langchain",
      "repo": "cwijayasundara/agent_cli_langchain",
      "prefix": "langchain-agents-",
      "expected_skills": 9,
      "skills": ["scaffold", "workflow", "langchain-code", "langgraph-code",
                 "deepagents-code", "middleware", "langsmith-evals", "deploy", "observability"],
      "risk_flags": { "deepagents-code": "Med Risk (Snyk)", "deploy": "Med Risk (Snyk)" }
    },
    {
      "key": "google-adk",
      "repo": "google/agents-cli",
      "prefix": "google-agents-cli-",
      "expected_skills": 7,
      "skills": []
    }
  ]
}
```

`install-framework-packs/SKILL.md` reads this file instead of its hardcoded table; `/scaffold` Step 4 reads it to render the pack-selection prompt instead of prose-listing two options.

**Unified composition step.** `/scaffold` gains one combined prompt (after stack detection, alongside today's Step 4 framework-pack question): "Which tech-stack specialty packs? Which domain vertical(s)?" — both answers recorded side by side in `project-manifest.json` (`framework_skill_packs` as today, plus whatever the vertical-glossary-seeding proposal's own manifest field turns out to be), so a single `/scaffold` run can produce "Python + FastAPI + LangChain/LangGraph/DeepAgents senior engineer with private-equity domain skills" in one pass — matching the concrete request that motivated this proposal.

## Design Decisions & Trade-offs

1. **Registry-driven, not a new agent per stack.** Confirmed by research: no evidence anywhere (Anthropic's own material, LangChain's docs, or the one cross-ecosystem precedent found) supports building a different base agent per tech stack. The generalist core stays singular; specialization is entirely skill-content-driven. This also matches Anthropic's explicit rejection of "different agent per domain" as an anti-pattern.

2. **Tech-stack registry mirrors the domain registry pattern already proposed, for consistency — not because it's the only possible design.** An alternative (a single unified `specialty-packs.json` covering both stack and domain) was considered and rejected for this proposal: stack packs and domain packs have different install mechanisms today (stack packs are external git repos installed via `npx skills add`; domain packs are Claude Code marketplace plugins toggled via `enabledPlugins`) — collapsing them into one schema would hide that real mechanical difference. Keep them as two registries with a shared *shape* (key, repo/plugin id, expected skill list), not one merged file.

3. **Content audit before content trust.** Given the unverified-content caveat above, this proposal explicitly does **not** claim the LangGraph/DeepAgents specialty is "done" once the registry ships. Phase 1 below includes reading the actual `agent_cli_langchain` pack source as a gating step — a registry entry pointing at thin or generic skill content would violate Fowler's "deep specialty" bar while looking complete.

4. **Prior art exists but is single-sourced.** [`dotnet/skills`](https://github.com/dotnet/skills) independently validates a plugin-per-tech-subdomain marketplace structure (`dotnet-data`, `dotnet-test`, `dotnet-upgrade`, etc., each an installable plugin with its own `skills/` folder) — the same shape this proposal wants for `framework-skill-packs.json`. Confidence held at **medium**, not high: this is one ecosystem example: no second cross-vendor precedent was independently verified. Treat as supportive, not as proof the pattern is broadly battle-tested.

## Rollout Path

**Phase 1 — Generalize the tech-stack registry (mirrors the already-proposed domain-side work); gate on a real content audit.**
- Add `.claude/config/framework-skill-packs.json` with the `langchain` and `google-adk` entries migrated verbatim from today's `install-framework-packs/SKILL.md` prose table.
- Update `install-framework-packs/SKILL.md` to read the registry file instead of hardcoding it; keep the "unknown key → report, don't invent" behavior.
- **Before marking LangGraph/DeepAgents coverage adequate:** have a human (or a dedicated research pass with repo access) actually read `agent_cli_langchain`'s `langgraph-code` and `deepagents-code` `SKILL.md` bodies and confirm they teach checkpointer configuration, `interrupt()` placement, and the specific default middleware stack — not just that the skill files exist. If thin, either file an upstream PR to that pack or add a harness-side supplemental reference file.

**Phase 2 — Unify the `/scaffold` composition step.**
- Add the combined stack+domain prompt described above to `/scaffold` Step 4/5.
- No changes to `CORE_AGENTS`, model tiers, or `generator.md`'s base prompt — stack-specific guidance flows in via the pack's own `SKILL.md`, consistent with progressive disclosure and the "no stack-specific reviewer agent" finding above.

**Phase 3 — Documentation hygiene.**
- Cross-link this document from `docs/architecture/vertical-glossary-seeding-generalization.md` and vice versa, since they're now two halves of one named architecture.
- Name the architecture explicitly in `design.md` or `README.md` (e.g. "Expert Generalist Composition") so future contributors don't rediscover the pattern from scratch.

**Phase 4 — Future, unscheduled.** Additional tech-stack packs (e.g. a `.NET` pack, following `dotnet/skills`' own structure) or domain packs (insurance, once a real vertical plugin exists) become single-registry-entry additions under the same two registries — no mechanism change required.

## Risks, Dependencies, Open Questions

**Risks**
- Registry entries are only as good as the packs they point to — a stale or thin external pack degrades silently unless someone actually reads its content (see Phase 1 gate).
- `dotnet/skills`' adoption/maturity as a pattern precedent is not independently confirmed beyond the repo itself — don't over-cite it as "industry standard," cite it as "one validated example."

**Dependencies**
- Requires `.claude/settings.json#enabledPlugins` to remain authoritative for plugin/domain state (existing CLAUDE.md Prompt-Caching rule).
- Depends on the vertical-glossary-seeding-generalization.md proposal shipping its own registry first, so both registries can be cross-linked and follow the same JSON shape convention.

**Open questions for the human before this becomes an implementation plan**
- Should Phase 1's content audit of `agent_cli_langchain` happen as part of this work, or as a separate, explicitly-scoped task first (since it requires fetching/reading an external repo this session couldn't reach)? Recommend: separate task first, since this proposal's Phase 1 gate depends on its outcome.
- Is a combined stack+domain `/scaffold` prompt (Phase 2) worth the UX complexity now, or should the two registries ship first and the unified prompt wait until there's a second real domain-vertical customer (mirroring how the vertical-glossary proposal deferred multi-context glossaries)?
- Time-sensitivity flag from the research: LangGraph/DeepAgents are fast-moving 2026-era products — specific middleware names, thresholds (e.g. the 85% summarization trigger), and pack skill counts should be re-verified at implementation time, not treated as permanent.
