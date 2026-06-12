# Lite Lane — Compressed Greenfield (build --lite)

Read by `/build --lite`. Use this compressed lane for small new projects where the full `/brd → /spec → /design → /auto` pipeline would be disproportionate. This is the greenfield equivalent of `/vibe`: a bounded, low-ceremony lane with explicit scope caps that still produces the artifacts `/auto` needs as prerequisites.

`/build --lite` is **not** permission to skip engineering discipline. It enforces a 5-story cap, a single dependency group, and a one-page BRD-lite. If the project grows beyond those limits, escalate to the full pipeline.

> **Ultracode tip:** Leave ultracode **off** here (`/effort high` or lower). Like `/vibe`, this is a deliberately low-ceremony lane — fanning out workflows would be disproportionate to the scope it's built for.

---

## Usage

```text
/lite "Python CLI that searches DuckDuckGo and summarizes results with an LLM"
/lite "Slack bot that posts daily standup reminders"
/lite "Library: pure-functional retry decorator with exponential backoff"
```

If no argument is given, ask the user for a one-paragraph description before starting the interview.

---

## Eligibility

Use `/build --lite` only when **all** are true:

- Single language/runtime (e.g., Python only, or Node only).
- One module/package; no microservices, no separate frontend + backend.
- No persistent database (a flat file, env-var config, or in-memory state is OK).
- No auth, billing, payments, PII, or compliance-sensitive data.
- No real-time/streaming infrastructure (Kafka, websockets, etc.).
- Estimated implementation surface ≤ ~5 source files and ≤ ~5 stories.
- New project (not adding to an existing codebase — for that, use `/change`).

Escalate to `/brd → /spec → /design → /auto` (or `/build`) when **any** are true:

- Multi-service architecture or split frontend+backend.
- A real database with migrations, or persistent business state.
- Auth, payments, multi-tenant access, or any regulated data domain.
- More than ~5 stories or more than one dependency group.
- Public API contract that other teams or external clients depend on.
- UI/UX is a meaningful product surface (use the full design lane).
- Requirements remain ambiguous after the bounded interview below.

If eligibility is uncertain, use the `clarify` gate (`.claude/skills/clarify/SKILL.md`) — ask at most 3 questions, prefer recording assumptions over interrogating. If still uncertain, escalate and stop.

---

## Steps

### Step 1 — Bounded Interview

Ask **at most 5 questions**. One at a time. Skip any answered by the user's `/lite "<description>"` argument.

1. **Project name** (used for `project-manifest.json`, package directory, README).
2. **Language and runtime** (e.g., "Python 3.12", "Node 20").
3. **Core capability in one sentence** — what does it do for the user?
4. **External dependencies** — APIs, SDKs, libraries that are load-bearing (e.g., "OpenAI SDK, DuckDuckGo search").
5. **Interface** — CLI? Library importable from other code? Both? Anything else (web hook, scheduled job) escalates.

Do not ask about: scaling, multi-tenancy, RBAC, observability stacks, deployment topology, future roadmap, or anything else not directly needed to write 5 stories.

### Step 2 — Write BRD-lite

Write `specs/brd/brd.md` as a one-page document, ~30-50 lines:

```markdown
# {Project Name} — BRD (lite)

## 1. What this is
One paragraph (2-4 sentences) describing the capability and the primary user.

## 2. MVP scope
Bulleted list of capabilities included in the first cut. Cap at 5 bullets.

## 3. Out of scope (v1)
Bulleted list of capabilities explicitly deferred. This is the escalation contract.

## 4. Tech stack
- Language: {language version}
- Key dependencies: {libraries}
- Interface: {CLI | library | both}
- Storage: {none | local file | env vars}

## 5. Success criteria
3-5 testable outcomes. Each one becomes one story's primary acceptance criterion.

## 6. Notes
Anything load-bearing that does not fit above.
```

No revisions, no Socratic re-interview. If the user says "needs another section", that is a signal to escalate.

### Step 3 — Generate Stories (≤ 5, Single Group A)

Write 3-5 ready stories to `specs/stories/E1-S{n}.md`, all in `Group: A`, all `Readiness: ready`. Use the project's natural shape, not the standard layer ladder.

Example shapes by project type:

| Project type | Typical story set |
|---|---|
| CLI tool | (1) Tool wrapper for external API, (2) Core logic/orchestrator, (3) CLI entry point + flags, (4) Tests |
| Small library | (1) Public API + types, (2) Core implementation, (3) Tests + example usage |
| Single-script utility | (1) Settings + config loading, (2) Main behavior, (3) Tests |

Do **not** split a single module into `Types`, `Config`, `Repository`, `Service`, `API`, `UI` stories. That layer splitting is for substantial applications. For lite projects, one story owns the whole module.

Each story file follows `.claude/templates/story.template.md` with:
- `Group: A`
- `Depends On: []` (foundation stories) or one earlier ID
- `Readiness: ready`
- 3-6 testable acceptance criteria each
- `Layer:` — pick the closest match but do not let it drive decomposition

### Step 4 — Write Epic Index and Dependency Graph

`specs/stories/epics.md`:

```markdown
# Epics

## E1 — {Project Capability}

| Story | Title | Layer | Readiness |
|-------|-------|-------|-----------|
| E1-S1 | ... | ... | ready |
| E1-S2 | ... | ... | ready |
| E1-S3 | ... | ... | ready |
```

`specs/stories/dependency-graph.md`:

```markdown
# Dependency Graph

## Group A

| Story | Title | Layer | Depends On |
|-------|-------|-------|------------|
| E1-S1 | ... | ... | — |
| E1-S2 | ... | ... | — |
| E1-S3 | ... | ... | E1-S1 |
```

Single group. If you find yourself wanting Group B, you are not eligible for `/build --lite` — escalate.

### Step 5 — Minimal Design Artifacts

Write **only these** files under `specs/design/`:

1. **`folder-structure.md`** — annotated tree of the package layout and test mirror. 20-40 lines.
2. **`component-map.md`** — map every story to the files it owns (single-owner rule). 1-2 lines per story.
3. **`api-contracts.md`** — internal contracts only. For a CLI, document the invocation shape, flags, and exit codes. For a library, document the public functions and their signatures. No OpenAPI/JSON Schema unless the project actually exposes HTTP.

Do **not** generate:
- `architecture.md` (a folder tree is sufficient at this scale)
- `data-models.md` / `data-models.schema.json` (Pydantic/TypeScript types live in code)
- `api-contracts.schema.json` (no HTTP surface)
- `deployment.md` (covered by `init.sh` and the project README)
- HTML mockups (no UI scoring; `design-critic` stays idle)

### Step 6 — Initialize Root Artifacts

Write `features.json` at project root. One feature per story or per acceptance criterion — pick whichever maps more naturally. For lite projects, story-level features are usually right.

Use the canonical schema (same shape as `/spec` output — required by `/auto` and `/evaluate`):

```json
[
  {
    "id": "F001",
    "category": "functional",
    "story": "E1-S1",
    "group": "A",
    "description": "Observable behavior this feature verifies",
    "steps": ["Step 1 to verify", "Step 2 to verify"],
    "passes": false,
    "last_evaluated": null,
    "failure_reason": null,
    "failure_layer": null
  }
]
```

Update `claude-progress.txt`'s `next_action` line to `Run /auto --group A`.

### Step 7 — Approval Gate

Present a single summary to the user, not three separate approval gates:

```text
Lite plan ready.

Project: {name}
Stories: {N} (all ready, group A)
Files to be created: {count} source + tests
External deps: {list}

Approve to proceed to /auto, or provide corrections.
```

Wait for explicit "approve" / "yes" / "go". Do **not** invoke `/auto` automatically.

---

## Handoff

On approval, the user runs `/auto --group A`. From here, the standard ratchet loop (sprint contract → generator → evaluator → review) runs unchanged.

`/build --lite` does **not** modify the autonomous build loop, gates, or self-healing logic. It only compresses phases 1-3.

**Parallel execution:** if your lite project's group A contains **≥ 2 stories**, the generator is required (by Rule 2 in `.claude/agents/generator.md`) to dispatch one teammate per story rather than implementing serially. Lite-mode projects with linear chain DAGs still benefit — the generator builds phases from the component map and runs each phase's teammates in parallel. If you observe a single generator subagent doing all the work in one long pass, that is a Rule 2 violation — surface it.

---

## Output Checklist

Before declaring the lite pass complete, verify:

- [ ] `specs/brd/brd.md` exists and is ≤ 50 lines
- [ ] `specs/stories/E1-S*.md` files exist (3-5 of them, all `ready`)
- [ ] `specs/stories/epics.md` exists with one epic
- [ ] `specs/stories/dependency-graph.md` exists with one group (A)
- [ ] `specs/design/folder-structure.md` exists
- [ ] `specs/design/component-map.md` exists, maps every story to owned files
- [ ] `specs/design/api-contracts.md` exists (CLI invocation OR public library functions; not OpenAPI unless HTTP)
- [ ] `features.json` exists at project root with one entry per story
- [ ] `claude-progress.txt` `next_action` points at `/auto --group A`
- [ ] No `architecture.md`, `data-models.schema.json`, `api-contracts.schema.json`, `deployment.md`, or mockups created

If any item fails, fix it before handing off. If a missing artifact is one `/auto` actually requires (component-map, dependency-graph, features.json, epics.md), the autonomous loop will refuse to start.

---

## Escalation

If at any point during the lite lane you discover the project is bigger than the eligibility criteria allow — for example, the user reveals a database, a second service, or an auth requirement — stop, delete or mark partial artifacts as draft, and recommend the full path:

```text
This project exceeds the /lite scope ({reason}). Switch to:
  /brd specs/brd/brd.md      # if you want to keep the partial BRD
  /spec specs/brd/brd.md
  /design
  /auto
or restart with /build path/to/full-requirements.md.
```

Do not silently grow `/build --lite` into the full pipeline. The scope cap is the contract.
