# Expert-Generalist Scaffold Composition — Design

**Date:** 2026-07-06
**Status:** Approved design, ready for implementation planning
**Related (read for full context, not duplicated here):**
- `docs/superpowers/specs/2026-07-05-ubiquitous-language-design.md` — shipped: `CONTEXT.md` + `vocabulary-check.js`, the domain-agnostic glossary mechanism everything below builds on.
- `docs/superpowers/specs/2026-07-06-pe-ubiquitous-language-design.md` — shipped: `pe-glossary-pack.js` + BRD Step 2.7, the private-equity-only prototype this design generalizes.
- `docs/architecture/vertical-glossary-seeding-generalization.md` — prior proposal for generalizing the domain side (registry pattern); this design **implements** it (Part 1 below), rather than superseding it.
- `docs/architecture/expert-generalist-scaffold-composition.md` — prior proposal for the tech-stack side and the overall three-layer framing; this design **implements** it (Parts 2-3 below).

## Context & Motivation

Martin Fowler's ["Expert Generalist"](https://martinfowler.com/articles/expert-generalist.html) — broad fundamentals fluency plus several deep specialties, not a single T-shaped skill — maps onto a three-layer engineering-agent architecture already partially shipped in this harness:

1. **Generalist core** (unchanged by this design): `CORE_AGENTS`/`CORE_SKILLS` in `.claude/scripts/scaffold-copy.js:21-39` — TDD, systematic debugging, code review, clean-code discipline, copied into every scaffolded project regardless of stack or domain.
2. **Domain specialties**: prototyped this session for private equity (`pe-glossary-pack.js` + BRD Step 2.7), proposed for generalization to other verticals (`vertical-glossary-seeding-generalization.md`) but not yet built.
3. **Tech-stack specialties**: exists today only as `project-manifest.json#framework_skill_packs`, a two-pack hardcoded prose registry (`langchain`, `google-adk`) pointing at *external, unaudited* repos.

This build closes both remaining gaps in one coherent pass, so a single `/scaffold` run can produce "Python + FastAPI + LangChain/LangGraph/DeepAgents senior engineer with private-equity domain skills" — the concrete scenario that motivated this whole line of work.

**Decisions locked in during brainstorming (do not re-litigate during implementation):**
- LangGraph/LangChain/DeepAgents skill content will be **authored fresh by this harness**, grounded in real fetched documentation, rather than continuing to depend on the external `agent_cli_langchain` repo's unverifiable content.
- DeepAgents is in scope now, alongside LangGraph and LangChain (not deferred).
- Both Phase 1 (registry + content) and Phase 2 (unified `/scaffold` step) ship together in this build.
- The combined pending-actions report for domain verticals extends `/scaffold`'s own reporting directly — it does **not** get merged into `install-framework-packs`, since `npx skills add` (tech packs) and `claude plugin install` (domain verticals) are genuinely different command families.

## Part 1 — Generalize the Domain-Vertical Registry

Implements `vertical-glossary-seeding-generalization.md`. Recap of what's already shipped: `.claude/scripts/pe-glossary-pack.js` reads `.claude/settings.json#enabledPlugins` for a `private-equity@...` key, extracts `name`/`description` frontmatter from the plugin's installed `skills/*/SKILL.md` files (under `~/.claude/plugins/{marketplaces,cache}/...`), groups them into 3 fixed bounded contexts, and writes `specs/brd/pe-glossary-pack.json`; BRD Step 2.7 distills that into `CONTEXT.md`.

**New:**
- `.claude/config/vertical-glossary-packs.json` — declarative registry, one entry per vertical:
  ```json
  {
    "packs": [
      {
        "plugin": "private-equity",
        "enabled_plugin_prefix": "private-equity@",
        "marketplace": "claude-for-financial-services",
        "install_id": "private-equity@claude-for-financial-services",
        "marketplace_skills_subpath": ".claude/plugins/marketplaces/claude-for-financial-services/plugins/vertical-plugins/private-equity/skills",
        "cache_skills_subpath": ".claude/plugins/cache/claude-for-financial-services/private-equity/skills",
        "bounded_contexts": [
          { "name": "Deal Lifecycle (Sourcing, Screening & Diligence)", "skills": ["deal-sourcing", "deal-screening", "dd-checklist", "dd-meeting-prep"] },
          { "name": "Investment Decision & Returns", "skills": ["ic-memo", "returns-analysis"] },
          { "name": "Portfolio Operations & Value Creation", "skills": ["portfolio-monitoring", "value-creation-plan", "unit-economics", "ai-readiness"] }
        ]
      }
    ]
  }
  ```
  The `marketplace`/`install_id` fields are new relative to the original proposal — needed by Part 3's `/scaffold` reporting step to print the exact `claude plugin install <install_id>` command, the same way `install-framework-packs` already prints exact `npx skills add <repo>` commands.
- `.claude/scripts/vertical-glossary-pack.js` — generic engine replacing `pe-glossary-pack.js`'s hardcoded constants with config-driven lookups (`isPluginEnabled(enabledPlugins, prefix)`, `findSkillsDir(homeDir, entry)`, `readSkillDescriptions`, `buildPack`), one output file per matched entry (`specs/brd/<plugin>-glossary-pack.json`), same fail-loud-on-empty-pack behavior `pe-glossary-pack.js` already has.
- BRD Step 2.7 reworded from "private-equity projects only" to "any enabled vertical plugin with a registered pack config," iterating the registry.
- Migration: the `private-equity` entry's values (regex, both subpaths, bounded-context table) move into the registry **verbatim** — no behavior change for existing private-equity projects. `pe-glossary-pack.js` is deleted only after the migrated tests are green under the generic engine. Output filename changes `pe-glossary-pack.json` → `private-equity-glossary-pack.json` (a deliberate one-time rename, called out in the implementation plan, since there are no external consumers of that filename to break).
- Multiple simultaneously-enabled verticals: process every matched entry independently; if two packs distill to the same normalized term with differing definitions, flag both in the progress log rather than silently overwriting.

## Part 2 — Tech-Stack Specialty Pack (New, Locally Authored)

**New registry**, `.claude/config/framework-skill-packs.json`:
```json
{
  "packs": [
    { "key": "python-ai-agents", "source": "local", "skills": ["langgraph-code", "langchain-code", "deepagents-code"] },
    { "key": "langchain", "source": "github", "repo": "cwijayasundara/agent_cli_langchain", "prefix": "langchain-agents-", "expected_skills": 9 },
    { "key": "google-adk", "source": "github", "repo": "google/agents-cli", "prefix": "google-agents-cli-", "expected_skills": 7 }
  ]
}
```
The two existing external entries migrate verbatim from `install-framework-packs/SKILL.md`'s prose table (no behavior change to that skill's existing flow). `install-framework-packs/SKILL.md` reads this file instead of hardcoding the table.

**New local skill pack**, bundled in this repo, one directory per skill (mirrors `CORE_SKILLS`' shape, mirrors the progressive-disclosure convention already used by `.claude/skills/design/references/`, `code-map/references/`, etc.):

```
.claude/skills/langgraph-code/SKILL.md
.claude/skills/langgraph-code/references/graph-api.md
.claude/skills/langgraph-code/references/persistence-and-memory.md
.claude/skills/langgraph-code/references/human-in-the-loop.md
.claude/skills/langgraph-code/references/subgraphs-and-streaming.md
.claude/skills/langgraph-code/references/troubleshooting.md

.claude/skills/langchain-code/SKILL.md
.claude/skills/langchain-code/references/ (models-and-chat-models.md, tools.md, agents.md, runnables-and-lcel.md, memory.md)

.claude/skills/deepagents-code/SKILL.md
.claude/skills/deepagents-code/references/ (architecture-and-api.md, middleware-stack.md, skills-and-memory.md, human-in-the-loop-and-permissions.md)
```

**Content sourcing (real URLs, fetched during implementation, not invented):**
- `langgraph-code`: all pages indexed by `https://langchain-ai.github.io/langgraph/llms.txt` (~15 pages — Overview, Core Concepts, How-To, Tutorials, Reference, Platform; small enough to fetch in full).
- `langchain-code`: the `oss/python/*` subset of `https://docs.langchain.com/llms.txt` — that index is ~2000+ links covering mostly-irrelevant product surface (LangSmith observability, Agent Server, Fleet, REST/SDK APIs); scope narrowly to core OSS library concepts (models, tools, `create_agent`, runnables/LCEL, memory, retrieval), do not attempt to cover the whole index.
- `deepagents-code`: `https://docs.langchain.com/oss/python/deepagents/overview` (fetched this session — four pillars: execution environment, context management, delegation, steering; `create_deep_agent`/`HarnessProfile`/`interrupt_on` API; default middleware stack — `TodoListMiddleware`, `FilesystemMiddleware`, `SubAgentMiddleware`, `SummarizationMiddleware`, `PatchToolCallsMiddleware`; gotchas: `excluded_tools` not `excluded_middleware`, subagents return one final report not a dialogue, sandbox backends bypass filesystem permission rules, prompt caching is automatic for Anthropic/Bedrock), supplemented by the deep-research findings already gathered this session (`https://www.langchain.com/deep-agents`, `https://deepwiki.com/langchain-ai/deepagents/1.3-architecture-overview`).

Each reference file cites its source URL(s) inline for future maintainability (these are 2026-era fast-moving products — middleware names, thresholds, and APIs should be treated as a snapshot to re-verify later, not permanent).

**`scaffold-copy.js` gets a new copy path**: when `project-manifest.json#framework_skill_packs` includes an entry whose registry `source` is `"local"`, copy that entry's listed skill directories into the target project's `.claude/skills/` — the same mechanism `CORE_SKILLS` already uses (plain directory copy), just conditional on selection instead of universal. External (`"source":"github"`) packs are unaffected — still recorded in the manifest only, still surfaced via `install-framework-packs` for manual `npx skills add`.

## Part 3 — Unified `/scaffold` Composition Step

Replaces today's disconnected flow (tech-stack pack chosen in Step 4; domain vertical enabled entirely outside `/scaffold`, via a separately-run `claude plugin install`) with one step that asks both questions and reports on both:

1. **Tech-stack pack(s)?** — reads `framework-skill-packs.json`, offers `python-ai-agents` (local, no further action needed) alongside `langchain`/`google-adk` (external, needs manual install after scaffold, same as today).
2. **Domain vertical(s)?** — new question. Reads `vertical-glossary-packs.json`, lists known verticals (currently just `private-equity`) with a short description.
3. Both answers recorded in `project-manifest.json` (`framework_skill_packs` as today; a new `domain_vertical_packs` array for the vertical choice).
4. **Combined pending-actions report**, printed by `/scaffold` itself (not `install-framework-packs`) at the end of the flow:
   - For each selected `"source":"github"` tech pack not yet installed (checked the same way `install-framework-packs` already does — prefix-directory count under `.claude/skills/`): print the existing manual `npx skills add <repo>` box.
   - For each selected vertical not yet enabled (checked against `.claude/settings.json#enabledPlugins` for the registry's `enabled_plugin_prefix`): print a manual-install box with `claude plugin marketplace add <marketplace>` + `claude plugin install <install_id>`, mirroring the existing box format/tone.
   - Local tech packs (`python-ai-agents`) need no box — already copied by Step 2 above.

No changes to `CORE_AGENTS`, model tiers (`docs/model-allocation.md`), or `generator.md`'s base prompt — stack-specific guidance flows in via the pack's own `SKILL.md` through progressive disclosure, consistent with the earlier proposal's finding that no stack needs a structurally different reviewer agent.

## Testing Plan

- `vertical-glossary-pack.js`: port every existing `pe-glossary-pack.test.js` assertion (bounded-context grouping, exit codes, no-op path, fail-loud-on-empty-pack) to run against the generic engine parameterized with the migrated `private-equity` registry entry — no test intent lost in the generalization.
- `framework-skill-packs.json` / `install-framework-packs`: a config-shape assertion test (registry parses, both existing entries present with correct field names) plus a regression test that `install-framework-packs`' existing INSTALLED/PARTIAL/MISSING behavior is unchanged for the two external packs.
- New local skill pack: a wiring test per skill (frontmatter present, references directory has the expected files) — content-quality is a human/reviewer judgment call, not something a test can grade, same as every other `SKILL.md` in this repo.
- `scaffold-copy.js`'s new local-pack copy path: a test scaffolding a temp project with `python-ai-agents` selected, asserting the three skill directories land under the temp project's `.claude/skills/`.
- `/scaffold`'s combined reporting step: test both report branches (tech-pack-missing box, vertical-missing box) independently, plus the case where everything's already installed (no boxes printed) and the case where a local-only selection needs no box at all.

## Out of Scope (this build)

- Publishing the new local pack as a separate external repo (mirroring `agent_cli_langchain`'s distribution model) — stays bundled in this harness for now; revisit only if there's a real reason to share it outside this repo.
- Additional FSI verticals beyond private-equity (`financial-analysis`, `investment-banking`, etc.) — the registry supports them, but adding entries is separate, demand-gated work per the original proposal's Phase 2.
- Any change to `CORE_AGENTS`/model-tier assignment.

## Open Questions Carried Into Implementation Planning

- Exact wording/UX of `/scaffold`'s new combined question (single multi-select prompt vs. two sequential prompts) — a planning-level detail, not a design blocker.
- Whether `langchain-code`'s reference-file split (models/tools/agents/runnables/memory) needs adjustment once the actual `oss/python/*` llms.txt subset is fetched and its real page count is known — content structure may shift slightly once real source material is in hand; the skill/reference-file *shape* (this design) is fixed, the exact reference-file boundaries are not.
