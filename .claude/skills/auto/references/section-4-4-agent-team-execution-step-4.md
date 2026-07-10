## SECTION 4: Agent Team Execution (Step 4)

Spawn the generator agent to create and manage a Claude Code agent team for the current group.

### Orchestrator Spawn Prompt (Mandatory Template)

When invoking the generator from `/auto`, you (the orchestrator) **MUST** use a prompt that carries the team mandate inline — a terse one-liner like `"Implement group A"` leaves too much latitude and the generator will sometimes implement solo. Use this template verbatim, substituting `{GROUP_ID}` and the story count:

```
Implement group {GROUP_ID} ({N_STORIES} stories) using the mandatory parallel-team protocol from generator.md Rule 2.

You are dispatching, not implementing. Concretely:
1. Read specs/stories/ for every story in this group.
2. Read specs/design/component-map.md and build the micro-DAG (Step 2.5).
3. Spawn one Agent(subagent_type=generator) per story — in parallel for Phase 1, then Phase 2 after Phase 1 commits.
4. Do NOT call Write or Edit on production files yourself unless you are the designated integrator for a shared file in Phase 3.
5. Log every teammate spawn to .claude/state/iteration-log.md with the story ID, owned files, and phase.
6. After all teammates complete, run the validation gate (pytest, ruff, mypy/tsc, coverage) and hand off to the evaluator.

This applies for any group with N_STORIES >= 2 regardless of how small the stories look. There is no bypass — every multi-story group spawns a team.
```

If the group has only **1 story**, use the legacy single-generator prompt instead — no team needed.

### Verification After Generator Returns

After the generator subagent returns, verify the team actually executed before trusting the result:

1. Read `.claude/state/iteration-log.md` — there must be one teammate-spawn entry per story in the group (minus integrators for Phase 3-only files).
2. If the log shows zero teammate spawns for a multi-story group, the generator violated Rule 2. Surface this as a ratchet failure, record it in `.claude/state/learned-rules.md` (under "Process rules"), and re-dispatch with an even stricter prompt that names the violation.

This verification is non-optional: the user has explicitly requested parallel agent teams for independent story clusters and silent fallback to solo execution defeats the purpose.

### Dependency Handshake

Before spawning teammates, the generator analyzes the component map:
1. Identifies shared files (files in 2+ stories)
2. Identifies interface boundaries (`Produces:` / `Consumes:` in component map)
3. Builds a micro-DAG grouping teammates into execution phases
4. Designates integrators for shared files

Log the micro-DAG to `iteration-log.md`.

If no cross-dependencies exist, all teammates spawn in parallel (legacy behavior).

### Phased Execution

| Phase | Who | Starts When | Must Do |
|-------|-----|------------|---------|
| 1 | Teammates with no upstream deps | Immediately | Implement + commit typed interface contracts |
| 2 | Teammates consuming Phase 1 outputs | All Phase 1 teammates complete | Code against committed interface contracts |
| 3 | Integrators for shared files | All Phase 2 teammates complete | Collect declared additions, write to shared files |

Max 5 concurrent teammates per phase. Batch in groups of 5 if more.

### Teammate Spawn Prompt

Every teammate receives:
- Story acceptance criteria (from `specs/stories/E{n}-S{n}.md`)
- Story readiness metadata (must be `ready`; otherwise do not spawn)
- File ownership (from `specs/design/component-map.md`)
- Learned rules (from `.claude/state/learned-rules.md` — inject verbatim)
- Quality principles (from `.claude/skills/code-gen/SKILL.md`)
- Interface contracts from upstream teammates (Phase 2+ only)
- If story involves external API: `.claude/skills/code-gen/references/api-integration-patterns.md`
- If the story edits pre-existing (non-sprint-new) symbols and `specs/brownfield/code-graph.json` exists: run `checking-coverage-before-change` on those symbols before the first edit; UNCOVERED routes through `pinning-down-behavior` / `sprouting-instead-of-editing`

### Model Tiering

Roles are assigned by **capability tier**, not a specific model — no prompt in this harness assumes which model it is running on (see `docs/prompting-standards.md` → "Model-agnostic by construction").

| Role | Tier | Rationale |
|------|------|-----------|
| `/auto` orchestrator | top-capability | Judgment, architectural decisions |
| Evaluator | top-capability | Skeptical verification |
| Design critic | top-capability | Subjective visual judgment |
| Generator lead | cost-efficient | Coordination, lower cost |
| Generator teammates | cost-efficient | Mechanical implementation |
| Security reviewer | top-capability | Contextual vuln reasoning + adversarial find-then-refute |

- **top-capability** = Opus 4.8.
- **cost-efficient** = Sonnet 4.6.

The orchestrator runs on the **session model** (whatever `/model` is set to — Opus 4.8). Subagent models are pinned per agent in `.claude/agents/<name>.md` frontmatter (`model:`), stamped from the cost-posture preset in `project-manifest.json` → `execution.model_tier` (default `balanced`):

- **cost** — Sonnet generation, Opus judgment.
- **balanced** (default) — identical pins to `cost` today (top tier is a single model, Opus 4.8); kept as a distinct posture name for per-project re-tuning.
- **max-quality** — generation bumped to Opus 4.8; everything else already Opus, codebase-explorer stays Sonnet.

Re-stamp after editing the manifest: `node .claude/scripts/model-tier.js <preset> --apply .claude/agents`. Full rationale + decision rule: `docs/model-allocation.md`.

---
