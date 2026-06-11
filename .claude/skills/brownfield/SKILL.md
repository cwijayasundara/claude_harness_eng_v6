---
name: brownfield
description: Discover and map an existing codebase before planning or changing it.
argument-hint: "[optional-focus-path-or-goal]"
context: fork
agent: planner
---

# Brownfield Discovery

Use `/brownfield` in existing repositories before substantial planning, improvements, refactors, or bug work. The goal is to build a factual map of the current system so agents respect the codebase instead of inventing a parallel architecture.

This skill does not change production code.

> **Ultracode tip:** Mapping an unknown codebase is the canonical fan-out task, so run `/effort ultracode` *before* this phase — broad parallel coverage plus adversarial verification produces better maps. Drop back to `/effort high` before the execution phases (`/auto`, `/implement`).

---

## Usage

```text
/brownfield
/brownfield backend/src
/brownfield "map auth and billing before adding team invites"
```

---

## Outputs

Write these files:

| File | Purpose |
|---|---|
| `specs/brownfield/codebase-map.md` | Languages, frameworks, package managers, entry points, services, commands. **LLM-written inventory** — distinct from `symbol-map.md`, the script-generated navigation index from `/code-map` |
| `specs/brownfield/code-graph.json` | Deterministic dependency graph produced by `/code-map` |
| `specs/brownfield/code-graph.meta.json` | Producer, language counts, scan warnings, timestamp |
| `specs/brownfield/dependency-graph.md` | Mermaid render of file/module-level edges |
| `specs/brownfield/coupling-report.md` | Fan-in, fan-out, cycles, hubs, unstable modules |
| `specs/brownfield/architecture-map.md` | Modules, layers, data flow, public interfaces, external dependencies — cites graph evidence |
| `specs/brownfield/test-map.md` | Test commands, coverage signals, public interfaces covered/missing, slow/flaky tests |
| `specs/brownfield/risk-map.md` | Sensitive areas, fragile zones, structural risks, auth/security/billing/data risks |
| `specs/brownfield/change-strategy.md` | Recommended lane for future work: `/vibe`, `/change`, `/refactor`, `/spec`, `/auto` |
| `specs/brownfield/seams-<goal>.md` | Optional ranked seam candidates produced by `/seam-finder "<goal>"` |
| `CONTEXT.md` | Optional domain glossary, created only when meaningful domain terms are discovered |

---

## Step 1 — Inventory the Repo

Discover facts, not guesses:

- Languages and frameworks
- Package managers and lockfiles
- App entry points
- Test/build/lint/typecheck commands
- Runtime services and Docker/compose files
- Environment/config files
- CI workflows
- Database migrations or schema files
- Public API route definitions
- Frontend routes/screens

Use `rg`, `find`, package manifests, config files, and existing docs. Prefer primary repo evidence over assumptions.

---

## Step 1.5 — Build the Dependency Graph (delegate to `/code-map`)

Run the `/code-map` skill (`.claude/skills/code-map/SKILL.md`) — its Steps 1–3 are the **single source of truth** for producer detection (AST indexer → Understand-Anything import → regex fallback), the exact commands, and the rendering of `symbol-map.md`, `dependency-graph.md`, and `coupling-report.md`. Do not restate or improvise those commands here; if anything in this skill disagrees with code-map's SKILL.md, code-map wins.

Expected artifacts under `specs/brownfield/` when it completes: `code-graph.json` (+ `.meta.json`), `symbol-map.md`, `skeletons/` (god files only), `dependency-graph.md`, `coupling-report.md`.

If the graph is empty or has only warnings, stop and report. Do not invent architecture from filenames. When the AST producer ran, treat `symbol-map.md` and `skeletons/` as the navigation layer: read a single symbol with `Read(offset=START, limit=END-START+1)` instead of reading god files whole.

---

## Step 2 — Map Architecture

Write `architecture-map.md` with:

- Major modules and their responsibilities — cite specific edges from `code-graph.json`
- Public interfaces for each major module — use the graph symbols list where available
- Data flow through the system — follow `imports` / `calls` chains
- External integrations — cite `ext:*` targets from the graph where available
- Persistence boundaries
- Auth/session boundaries
- Existing layering conventions — confirm with directional fan-in/fan-out from `coupling-report.md`
- Deep modules worth preserving — high fan-in and low instability
- Shallow/pass-through modules that may be refactor candidates — high instability and little domain logic

Every "module X depends on Y" claim must reference graph evidence, preferably an edge with file:line evidence. Do not redesign the system. Capture what exists.

---

## Step 3 — Map Tests

Write `test-map.md` with:

- Test frameworks and commands
- Unit/integration/e2e locations
- Which public interfaces are covered
- Which critical public interfaces lack tests
- Known slow/flaky tests if discoverable
- Whether tests isolate env/config correctly

If commands are obvious and safe, run lightweight discovery commands such as `npm test -- --help`, `pytest --collect-only`, or package script listing. Do not run expensive test suites unless the user asked.

---

## Step 4 — Map Risks

Write `risk-map.md` with:

### Domain risks

- Auth, permissions, privacy, billing, payment, and security-sensitive paths
- Database migrations and irreversible data operations
- External APIs and side-effecting integrations
- Generated code or vendored code that should not be edited manually
- Areas where tests are weak or missing

### Structural risks

Read these from `coupling-report.md` and `code-graph.json`:

- **Cycles** — files inside strongly connected components; refactors across cycle boundaries need explicit approval.
- **Hub modules without tests** — high fan-in files without corresponding test coverage in `test-map.md`.
- **Unstable hubs** — fan_in >= 5 and instability >= 0.8.
- **Orphan files** — fan_in == 0 and not an entry point.

For each risk, include the evidence path or graph node id.

---

## Step 5 — Recommend Change Strategy

Write `change-strategy.md` with:

- What qualifies for `/vibe`
- What should use `/change` (behavior change; `--issue N` for a tracked bug)
- What should use `/refactor`
- What requires `/spec` → `/design` → `/auto`
- What should require explicit human approval before touching

Include a short "first safe next steps" list.

When recommending `/spec → /design → /auto` for any cluster of work, note in the strategy that `/auto` parallelizes on two axes:
- **Within a group:** multi-story groups (≥ 2 stories) fan out into parallel teammates — see `.claude/agents/generator.md` Rule 2.
- **Across groups:** independent dependency groups run concurrently as group-orchestrators (up to 3 by default) — see Section 4B of `.claude/skills/auto/SKILL.md`.

This shapes how you cluster stories AND how you shape the dependency graph: clusters with truly independent stories get within-group parallelism, and independent dependency groups (backend vs frontend vs ingest, for example) get cross-group parallelism. Prefer designs that surface independence at both levels — group by integration boundary internally, and minimize cross-group `Consumes:` edges in the dependency graph.

If the requested work has a concrete goal, recommend running `/seam-finder "<goal>"` after `/brownfield`. Use `seams-<goal>.md` to choose whether the next lane should extend an existing seam, wrap a boundary, introduce an adapter, split a read/write path, or avoid a poor seam.

---

## Step 6 — Domain Glossary

If recurring domain terms are discovered, create or update `CONTEXT.md`.

Keep it domain-level:

```markdown
# Context

## Terms

### Account
Definition meaningful to users/domain experts.

### User
Definition and how it differs from Account.
```

Do not fill `CONTEXT.md` with implementation details.

---

## Gate

Before recommending implementation, present:

- What the system appears to be
- Highest-risk areas
- Existing test confidence
- Recommended lane for the requested work
- Any uncertainty that needs human confirmation

Do not proceed to code changes from `/brownfield` unless the user explicitly asks.

---

## Phase Evaluation Gate

After all discovery artifacts are written, spawn the `evaluator` agent (artifact mode) to validate the brownfield analysis.

**Agent invocation:**

Spawn Agent with subagent_type="evaluator" and prompt:
- Phase: brownfield
- Artifacts: specs/brownfield/codebase-map.md, specs/brownfield/architecture-map.md, specs/brownfield/test-map.md, specs/brownfield/risk-map.md, specs/brownfield/coupling-report.md, specs/brownfield/code-graph.json (if exists)
- Upstream: null (verify against actual codebase instead)
- Rubric: Read .claude/templates/phase-eval-rubrics.json, key "brownfield"
- Iteration: 1 (increment on retry)
- Previous score: null (or previous iteration's weighted_average)
- Verification: Spot-check 3-5 modules claimed in architecture-map.md actually exist as directories/files. Verify test commands in test-map.md reference real test files.
- Write result to specs/reviews/phase-brownfield-eval.json

**Ratchet loop (max 2 iterations):**

1. If verdict is **PASS** — proceed to Human Gate with eval summary.
2. If verdict is **FAIL** — re-scan the areas with findings. Update the maps. Re-run evaluator.
3. **Ratchet rule:** weighted_average must be >= previous iteration. Revert on regression.
4. After 2 iterations — present best version with findings to human.

---

## Human Gate

**Human approval is required before proceeding to implementation.**

Present the discovery maps with the evaluator's quality summary:
- Weighted average score (e.g., "Discovery quality: 8.2/10")
- Any remaining warnings from the evaluator
- Recommended change strategy

Ask: "Does this brownfield analysis look accurate? Approve to proceed, or flag areas that need re-scanning."

Do not proceed to code changes from `/brownfield` unless the user explicitly approves the discovery AND requests changes.

---

## Gotchas

- **Do not invent architecture.** If evidence is missing, say unknown.
- **Do not create parallel implementations.** Brownfield work modifies existing paths unless a story/design explicitly approves a replacement.
- **Do not trust names alone.** Confirm responsibilities from imports, tests, route wiring, and callers.
- **Do not over-map the universe.** Focus enough to guide safe future changes.
- **Do not run destructive commands.** Discovery is read-only except for writing brownfield docs and optional `CONTEXT.md`.
