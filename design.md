# Claude Harness Engine v1 — Architecture Reference

Comprehensive design document for the Claude Harness Engine: a GAN-inspired orchestration system for autonomous, long-running application development with Claude Code.

Copied into target projects by `/scaffold`.

Based on:
- [Anthropic: Harness Design for Long-Running Apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [OpenAI: Harness Engineering](https://openai.com/index/harness-engineering/)
- [Steve Krenzel: AI is Forcing Us to Write Good Code](https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code)
- [Andrej Karpathy: Autoresearch Loop](https://x.com/karpathy) — monotonic ratchet pattern

---

## 1. Design Philosophy

### The Problem with Autonomous Code Generation

When an AI agent generates code autonomously, three failure modes dominate:

1. **Self-evaluation bias** — The agent that wrote the code cannot objectively judge it. It rationalizes failures ("the test is probably wrong"), skips edge cases, and declares victory prematurely.

2. **Quality regression** — Without enforcement, coverage drops, functions grow, architecture drifts, and the codebase degrades over multiple iterations. Each fix introduces new problems.

3. **Context exhaustion** — Complex projects exceed a single context window. Without recovery, work restarts from scratch every session, knowledge is lost, and the same mistakes repeat.

### The Solution: GAN + Ratchet

The harness combines two complementary patterns to address all three failure modes:

**GAN (Generative Adversarial Network) pattern** — Separate the generator (writes code) from the evaluator (verifies code). Neither can do the other's job. The generator cannot evaluate; the evaluator cannot write. This structural separation eliminates self-evaluation bias.

**Karpathy Ratchet** — Every metric (test coverage, lint cleanliness, architecture alignment) can only move forward, never backward. Once coverage reaches 85%, it never drops below 85%. Once a learned rule is extracted, it's never deleted. Progress is monotonic, and quality accumulates across sessions.

Together: the GAN ensures honest verification at each step, and the ratchet ensures that verified quality is never lost.

---

## 2. System Architecture

```
+---------------------------------------------------------------------+
|                        HUMAN INTERFACE                                |
|                                                                      |
|  program.md           CLAUDE.md            project-manifest.json     |
|  (Karpathy bridge)    (table of contents)  (stack + eval config)     |
+--------+------------------+--------------------+--------------------+
         |                  |                    |
         v                  v                    v
+---------------------------------------------------------------------+
|                      ORCHESTRATION LAYER                             |
|                                                                      |
|  /build --> /brd -> /spec -> /design -> /implement -> /evaluate      |
|                                              |              |        |
|                                              v              v        |
|                                         /auto (Karpathy ratchet)     |
|                                              |                       |
|                                  +-----------+-----------+           |
|                                  v           v           v           |
|                             Generator   Evaluator   Design-Critic    |
|                                  |           |           |           |
|                             Agent Teams  Playwright   Vision Score   |
|                             (parallel     MCP + API    (GAN loop,   |
|                              stories)    + Docker logs  weighted)    |
|                                                                      |
|  Support: /fix-issue  /refactor  /improve  /lint-drift  /deploy      |
+--------+------------------+--------------------+--------------------+
         |                  |                    |
         v                  v                    v
+---------------------------------------------------------------------+
|                     AGENT LAYER (7 agents)                           |
|  planner / generator / evaluator / design-critic /                   |
|  security-reviewer / ui-designer / test-engineer                     |
|                                                                      |
|  Model tiering: Opus for judgment (orchestrator, evaluator, critic)  |
|                 Sonnet for execution (generator teammates)           |
+--------+------------------+--------------------+--------------------+
         |                  |                    |
         v                  v                    v
+---------------------------------------------------------------------+
|                   ENFORCEMENT LAYER (12 hooks)                       |
|  All hooks include remediation instructions ("Fix: ...")             |
|                                                                      |
|  Security: scope-directory | protect-env | detect-secrets            |
|  Quality:  lint-on-save | typecheck | check-architecture             |
|            check-function-length | check-file-length                 |
|  Gates:    pre-commit-gate | sprint-contract-gate                    |
|  Teams:    teammate-idle-check                                       |
|  Info:     task-completed                                            |
+--------+------------------+--------------------+--------------------+
         |                  |                    |
         v                  v                    v
+---------------------------------------------------------------------+
|                       STATE LAYER                                    |
|  program.md | iteration-log.md | learned-rules.md | failures.md     |
|  coverage-baseline | features.json | claude-progress.txt             |
|  sprint-contracts/ | specs/reviews/eval-scores.json                 |
+---------------------------------------------------------------------+
```

### Layer Responsibilities

| Layer | What It Does | Who Controls It |
|-------|-------------|----------------|
| **Human Interface** | Constraints, steering, configuration | Human edits `program.md` mid-run |
| **Orchestration** | Pipeline sequencing, iteration control, mode selection | `/auto` skill (reads `program.md` every iteration) |
| **Agent** | Code generation, evaluation, design scoring, security scanning | 7 specialized agents with model tiering |
| **Enforcement** | Real-time quality gates on every edit and commit | 12 hooks (block, warn, or auto-fix) |
| **State** | Session chaining, learned rules, feature tracking | Append-only files (never lose progress) |

---

## 3. The GAN Architecture

### Why Separation Matters

In traditional AI code generation, the same agent writes code and decides if it works. This creates three cognitive biases:

- **Confirmation bias** — "I wrote it, so it probably works." The agent skips checks that might reveal issues.
- **Rationalization** — "It fails this test, but the test is probably wrong." The agent explains away failures instead of fixing them.
- **Scope creep** — "While I'm here, let me also improve this." The agent gold-plates instead of delivering what was specified.

The GAN architecture eliminates these biases structurally:

```
Generator                              Evaluator
(writes code — cannot evaluate)        (runs app — cannot write code)
     |                                      |
     |-- 1. Propose sprint contract ------->|
     |<-- 2. Evaluator finalizes -----------|  (negotiation: exactly 2 calls)
     |                                      |
     |-- 3. Implement code + tests -------->|
     |      (TDD: red -> green -> refactor) |
     |                                      |-- 4. Start app (Docker/local/stub)
     |                                      |-- 5. Layer 1: curl API endpoints
     |                                      |-- 6. Layer 2: Playwright browser flows
     |                                      |-- 7. Layer 3: Design-critic scoring
     |                                      |-- 8. Read Docker logs on failure
     |                                      |
     |<-- 9. VERDICT: PASS or FAIL --------|  (binary — no partial credit)
     |      + structured failure JSON       |
     |                                      |
     |-- 10. Self-heal (if FAIL) ---------->|
     |       (targeted fix from failure JSON)|
     |<-- 11. Re-evaluate -----------------|
     |                                      |
     (max 3 attempts, then revert + learn)
```

### Sprint Contracts: The Agreement Protocol

Before any code is written, the generator and evaluator negotiate a **sprint contract** — a machine-readable JSON document that defines exactly what "done" means:

```json
{
  "group": "C",
  "stories": ["E3-S1", "E3-S2"],
  "features": ["F005", "F006"],
  "contract": {
    "api_checks": [
      {
        "id": "api-001",
        "method": "POST",
        "path": "/documents/upload",
        "headers": { "Content-Type": "multipart/form-data" },
        "expected_status": 201,
        "expected_body": { "document_id": "string" },
        "description": "Upload document returns 201 with document_id"
      }
    ],
    "playwright_checks": [
      {
        "id": "pw-001",
        "description": "Upload document end-to-end",
        "url": "/upload",
        "steps": [
          { "action": "navigate", "value": "/upload" },
          { "action": "fill", "selector": "getByLabel('File')", "value": "test.pdf" },
          { "action": "click", "selector": "getByRole('button', { name: 'Submit' })" },
          { "action": "assert_visible", "selector": "getByText('Upload successful')" }
        ]
      }
    ],
    "design_checks": {
      "visual_hierarchy": { "required": true, "min_score": 7 },
      "accessibility": { "required": true, "min_score": 5 },
      "responsiveness": { "required": true, "min_score": 7 },
      "interaction_feedback": { "required": true, "min_score": 5 }
    },
    "performance_checks": [
      { "endpoint": "/documents/upload", "max_response_time_ms": 2000, "method": "POST" }
    ],
    "architecture_checks": {
      "layering": { "required": true, "description": "No upward imports" },
      "typing": { "required": true, "description": "All functions annotated" },
      "folder_structure": { "required": true, "description": "Files match component-map" }
    }
  }
}
```

The negotiation protocol is exactly 2 calls:
1. **Generator proposes** — based on story acceptance criteria + architecture
2. **Evaluator finalizes** — can add checks, remove invalid ones. This version is immutable.

No back-and-forth. No ambiguity. Both sides agree on what PASS means before coding starts.

### Three-Layer Verification

The evaluator never reads source code. It only runs the application and checks observable behavior:

| Layer | What | How | Catches |
|-------|------|-----|---------|
| **1. API** | Endpoints return correct status + schema | `curl` against running app + `jsonschema` validation | Backend logic bugs, schema mismatches, missing error handling |
| **2. Playwright** | UI works as user expects | Playwright MCP: navigate, click, fill, assert with semantic selectors | Frontend bugs, broken forms, missing feedback, dead buttons |
| **3. Vision** | UI has distinctive, quality design | Screenshots scored by design-critic on 4 weighted criteria | Generic templates, poor spacing, inconsistent styling |

On any Layer 1 or 2 failure, the evaluator reads Docker logs (or process stderr in local mode) to extract the actual stack trace. The generator receives the exact error, not just "got 500 instead of 201."

### The Design-Critic GAN Loop

For frontend groups, after the main ratchet passes (tests, lint, coverage, API, Playwright), the design-critic runs a secondary GAN loop:

```
Generator produces UI --> Design-Critic scores (4 criteria, weighted)
     ^                          |
     |                     Score >= threshold? --> PASS
     |                          |
     |                     No --> Send specific critique
     |                          |
     +---- Iterate on UI <------+
                                |
                         Plateau detected? --> Force pivot
                         (score stuck for 3 iterations)
                                |
                         Max iterations? --> Log, escalate, continue
```

Scoring uses configurable weights from `calibration-profile.json`:

| Criterion | Default Weight | What It Measures |
|-----------|---------------|-----------------|
| Design Quality | 1.5x | Coherent visual identity, color palette, layout |
| Originality | 1.5x | Distinctive vs template defaults |
| Craft | 0.75x | Typography hierarchy, spacing, alignment |
| Functionality | 0.75x | User can understand and complete tasks |

Formula: `(DQ * 1.5 + O * 1.5 + C * 0.75 + F * 0.75) / 4.5`

Two pass conditions must BOTH be met:
1. Weighted average >= threshold (default 7)
2. Every individual criterion >= per-criterion minimum (default 5)

Calibration anchors at score 5, 7, 9 in `evaluation/references/scoring-examples.md`.

---

## 4. The Karpathy Ratchet

### Concept: Monotonic Progress

Named after Andrej Karpathy's autoresearch pattern: every quality metric can only move forward, never backward. This transforms autonomous code generation from "hope it works" to "guaranteed cumulative improvement."

The ratchet has 6 sub-gates, run in sequence:

```
Gate 1: Unit tests pass          [all modes]     -- cheap, catches logic errors
Gate 2: Lint + types clean       [all modes]     -- cheap, catches style drift
Gate 3: Coverage >= baseline     [all modes]     -- cheap, catches missing tests
Gate 4: Architecture alignment   [full/lean]     -- moderate, catches structure drift
Gate 5: Evaluator verdict        [full/lean]     -- expensive, catches real bugs
Gate 6: Design critic score      [full only]     -- expensive, catches UI mediocrity
```

### How the Ratchet Works

**Coverage as verification, not just testing:**

Steve Krenzel's insight: "100% coverage isn't a goal — it's verification that the agent double-checked every line it wrote." The harness enforces:
- **Floor: 80%** — No commit may drop below this. Ever.
- **Baseline: current coverage** — If the project is at 87%, the next commit must be >= 87%.
- **Target: 100%** — Every line needs a test, not for bug prevention, but to prove the agent thought about it.

If coverage drops below baseline after a commit, the commit is rejected. Coverage ratchets upward only.

**Architecture enforcement:**

The harness enforces one-way layer dependencies:
```
Types (Layer 1) -> Config (Layer 2) -> Repository (Layer 3) -> Service (Layer 4) -> API (Layer 5) -> UI (Layer 6)
```

A layer may import from layers below, never above. The `check-architecture.js` hook scans every file edit. Violations are blocked immediately.

**Learned rules:**

When the same error appears 2+ times in `failures.md`, the harness extracts a **learned rule** — a permanent directive injected into every future agent prompt:

```markdown
## Rule 3: API error responses must include error_code field

- **Source:** Group B, Story S2-S1, Iteration 2
- **Pattern:** Playwright test fails: cannot parse error message.
  API returns {"error": "invalid file"} but code expects {"error_code": "..."}
- **Rule:** Every error response must include: error_code (string enum),
  message (human-readable), details (object, optional)
```

Rules are **monotonic** — never deleted, only added. They represent institutional knowledge that compounds across sessions.

### Self-Healing Loop

On FAIL, the ratchet doesn't immediately revert. It attempts targeted self-healing:

```
Attempt 1:
  Read structured failure JSON (layer, error_type, stack_trace, files_involved)
  Classify: lint? type? API? Playwright? coverage? Docker?
  Apply targeted fix (only the failing code, nothing else)
  Re-run ONLY the failed gate

Attempt 2:
  Same process, but with prior_attempts[1] showing what Attempt 1 tried
  Generator sees: "Attempt 1 added a null check, but the real issue is FormData vs dict"

Attempt 3:
  Same, with prior_attempts[1,2]
  If still failing: STOP

3rd failure:
  git checkout -- .  (revert)
  Log to failures.md
  Extract learned rule
  Mark group BLOCKED
  Continue to next unblocked group
```

The `prior_attempts` accumulation is critical — it prevents the generator from trying the same fix three times.

### Session Chaining

Complex projects span multiple context windows. The ratchet maintains continuity through 4 recovery files:

| File | What It Stores | Read Cost |
|------|---------------|-----------|
| `claude-progress.txt` | Append-only session log (groups done, current group, last commit, features passing, coverage, next action) | ~500 tokens |
| `features.json` | Granular pass/fail per feature with failure_layer and timestamps | Varies |
| `learned-rules.md` | Monotonic knowledge base (never deleted) | Grows over time |
| `git log` | Commit history showing what was done in prior sessions | ~200 tokens |

At the start of every iteration, `/auto` reads (in order):
1. `program.md` — constraints may have changed
2. `learned-rules.md` — inject into all agent prompts
3. `claude-progress.txt` — last session block only
4. `features.json` — what's passing, what's failing
5. `dependency-graph.md` — what's the next group

This costs ~700-1000 tokens per recovery — negligible compared to the context window.

---

## 5. Agent Teams and Phased Execution

### Why Parallel Execution

Sequential implementation: Story 1 (4 hrs) -> Story 2 (3 hrs) -> Story 3 (2 hrs) = 9 hours.
Parallel with agent teams: all three in parallel = 4 hours.

### Dependency Handshake

Before spawning teammates, the generator analyzes the component map for cross-dependencies:

1. **Shared files** — files appearing in 2+ stories get a designated integrator
2. **Interface boundaries** — `Produces:` / `Consumes:` annotations define data flow
3. **Micro-DAG** — teammates grouped into execution phases

```
Phase 1: teammate-upload (no upstream deps)
    produces: UploadResult {document_id, status}
Phase 2: teammate-process (consumes UploadResult)
    produces: ProcessedDocument {document_id, fields}
Phase 3: teammate-upload integrates shared types.py
```

Within each phase, teammates run in parallel (max 5). Only cross-phase dependencies are sequential.

### Teammate Isolation

Each teammate receives:
- Story acceptance criteria
- File ownership (strict — no overlapping edits)
- Learned rules (verbatim)
- Quality principles from `code-gen/SKILL.md`
- Interface contracts from upstream teammates (Phase 2+ only)
- API integration patterns (if story involves external APIs)

No teammate reads the full codebase. They work within their file boundaries and communicate through typed interface contracts.

---

## 6. Verification Modes

The evaluator supports 3 modes for reaching the running application:

| Mode | When to Use | How It Works |
|------|------------|-------------|
| **docker** (default) | Full-stack containerized apps | `docker compose up`, health-check retry, `docker compose logs` for error context |
| **local** | Dev servers, serverless emulators | Start processes via configured commands, health-check against URLs, process stderr for errors |
| **stub** | No runnable backend (serverless, external-only) | Auto-generate mock server from `api-contracts.schema.json`, validate request/response shapes |

Configured in `project-manifest.json` field `verification.mode`. All modes use the same health-check retry loop (5 attempts, exponential backoff) before running any checks.

---

## 7. Execution Modes

| Mode | Cost | Gates | Agent Teams | Evaluator | Design Critic | When to Use |
|------|------|-------|-------------|-----------|---------------|-------------|
| **Full** | $100-300 | All 6 | Yes (phased) | Per group | Per group (configurable iterations) | Production apps, complex requirements |
| **Lean** | $30-80 | 1-5 | Yes | Per group | Skipped | Backend-heavy, internal tools |
| **Solo** | $5-15 | 1-3 | No | Skipped | Skipped | Bug fixes, small features, prototyping |
| **Turbo** | $30-50 | 1-3 per commit, 4-6 at end | No | Once at end | Once at end | Well-specified + capable model |

**Fast lane optimization:** For trivial changes (lint fixes, docs, type annotations), gates 4-6 are skipped. Detection: `git diff --name-only` shows only non-code files, or commit message matches lint/doc patterns.

---

## 8. Production Standards for Generated Code

All code generated by the harness follows these standards (enforced via `code-gen/SKILL.md`):

### Structured Logging
- `logging.getLogger(__name__)` at module level
- Structured `extra` dicts (not f-string interpolation)
- INFO for business events, WARNING for recoverable issues, ERROR for failures, DEBUG for troubleshooting
- Never log secrets, tokens, or PII

### Exception Handling
- Typed exception classes per domain with context (document_id, stage, cause)
- No bare `except Exception` — catch specific types
- No silent fallbacks — failed operations raise, caller decides how to handle
- API routes map domain exceptions to structured error responses

### External API Integration
- One wrapper class per external API (only file that imports SDK)
- Typed inputs/outputs using project-internal models, not SDK types
- Error taxonomy: `ApiTransientError` (retryable), `ApiPermanentError` (not retryable), `ApiRateLimitError`
- Retry config in `config.yml`, not hardcoded
- Record-replay test fixtures for integration testing

### LLM Integration
- Always use structured output (tool_use / JSON mode) — never parse free-text with regex
- Define typed response schemas (Pydantic / TypeScript interfaces)
- Validate before using; retry once on validation failure; raise typed error on second failure
- Log raw responses at DEBUG before parsing

Full templates in `code-gen/references/api-integration-patterns.md`.

---

## 9. Hook Enforcement

All 12 hooks include **remediation instructions** ("Fix: ...") to guide agents toward corrections rather than just blocking.

| Hook | Trigger | Behavior |
|------|---------|----------|
| `scope-directory.js` | Edit/Write | Block — writes outside project |
| `protect-env.js` | Edit/Write | Block — .env modifications (allows .env.example) |
| `detect-secrets.js` | Edit/Write | Block — API keys, tokens, PII |
| `lint-on-save.js` | Edit/Write | Auto-fix — reads manifest for tool (ruff/eslint) |
| `typecheck.js` | Edit/Write | Warn — reads manifest (mypy/tsc) |
| `check-architecture.js` | Edit/Write | Block — upward layer imports |
| `check-function-length.js` | Edit/Write | Warn >50, Block >100 lines |
| `check-file-length.js` | Edit/Write | Warn 200, Block 300 lines |
| `pre-commit-gate.js` | Bash (git commit) | Block — full architecture scan |
| `sprint-contract-gate.js` | Bash (git commit) | Block — evaluator verdict required |
| `teammate-idle-check.js` | TeammateIdle | Block — no tests = no idle |
| `task-completed.js` | TaskCompleted | Info — architecture scan + /review reminder |

Complemented by official `security-guidance` plugin for real-time XSS/eval/unsafe-code pattern detection on edits.

---

## 10. State Files

| File | Growth | Purpose |
|------|--------|---------|
| `program.md` | Edited by human | Karpathy bridge — edit to steer `/auto` mid-run |
| `iteration-log.md` | Append-only | Full history: stories, verdicts, coverage, commits |
| `learned-rules.md` | Monotonic (never deleted) | Defensive rules extracted from repeated failures |
| `failures.md` | Append-only | Raw failure data for pattern extraction |
| `.claude/state/pending-reviews.jsonl` | Recreated/cleared by hooks | Files changed this turn that require reviewer agents |
| `coverage-baseline.txt` | Ratcheted upward | Never drops; floor is 80% |
| `features.json` | Updated per evaluation | Granular pass/fail with failure_layer and timestamps |
| `claude-progress.txt` | Appended per session | Session chaining recovery context |
| `sprint-contracts/` | One file per group | Negotiated done-criteria; immutable after negotiation |
| `specs/reviews/eval-scores.json` | Appended per critique | User-visible design scores over time |
| `calibration-profile.json` | Edited by human/scaffold | Scoring weights, threshold, plateau detection config |

---

## 11. Superpowers Integration

The harness integrates with the [Superpowers](https://github.com/obra/superpowers) plugin (by Jesse Vincent) to augment key pipeline stages with proven developer workflow patterns.

### What Superpowers Adds

Superpowers provides 14 skills focused on developer discipline — brainstorming, planning, TDD, debugging, verification, and code review workflows. These complement the harness's SDLC pipeline by adding structured thinking at critical decision points.

### Integration Points

| Pipeline Stage | Superpowers Skill | Purpose |
|---|---|---|
| `/brd` (Step 0) | `superpowers:brainstorming` | Explore user intent and hidden assumptions before the Socratic interview |
| `/design` (Step 0) | `superpowers:brainstorming` | Evaluate architectural trade-offs before committing to a design |
| `/implement` (Step 0) | `superpowers:writing-plans` | Produce structured implementation plan before spawning agent teams |
| `/implement` (teammates) | `superpowers:test-driven-development` | Red-green-refactor cycle enforced in every teammate prompt |
| `/fix-issue` (Step 1.5) | `superpowers:systematic-debugging` | Root cause analysis before writing failing test |
| `/refactor` (Step 4) | `superpowers:writing-plans` | Structured refactoring plan before execution |
| `/auto` (self-healing) | `superpowers:systematic-debugging` | Diagnose failure root cause before each fix attempt |
| `/auto` (completion) | `superpowers:verification-before-completion` | Evidence-based verification before claiming build complete |
| evaluator agent | `superpowers:verification-before-completion` | Run all checks and confirm output before emitting PASS verdict |
| generator agent | `superpowers:test-driven-development` | TDD workflow invoked before writing implementation code |

### How It Works

Superpowers is enabled as a plugin in `.claude/settings.json`:

```json
"enabledPlugins": {
  "superpowers@claude-plugins-official": true
}
```

Each integration point invokes the superpowers skill by name (e.g., `superpowers:brainstorming`). The skill's output feeds into the next pipeline step — it augments the workflow, not replaces it. For example, brainstorming output feeds into the BRD interview, not bypasses it.

### Design Rationale

The harness handles **what** to build (SDLC pipeline, sprint contracts, ratchet gates). Superpowers handles **how** to think about building it (structured exploration, disciplined debugging, verification discipline). The two systems are complementary:

- **Without superpowers:** The harness still works. Agents follow skill instructions directly.
- **With superpowers:** Agents explore alternatives before committing, debug systematically before fixing, and verify evidence before claiming success. This reduces wasted self-healing iterations and improves first-pass quality.

---

## 12. Pipeline Commands

| Command | Purpose | Human Gate? | Superpowers |
|---------|---------|-------------|-------------|
| `/brd` | Socratic interview -> BRD | Yes | brainstorming |
| `/spec` | BRD -> stories + dependency graph + features.json | Yes | — |
| `/design` | Architecture + schemas + mockups | Yes | brainstorming |
| `/implement` | Code generation with agent teams | No | writing-plans, TDD |
| `/evaluate` | Run app, verify sprint contract | No | verification |
| `/review` | Evaluator + security review | No | — |
| `/test` | Test plan + Playwright E2E generation | No | — |
| `/deploy` | Docker Compose + init.sh | No | — |
| `/build` | Full 8-phase pipeline | Phases 1-3 | verification |
| `/auto` | Autonomous ratcheting loop | No (reads program.md) | debugging, verification |
| `/fix-issue` | GitHub issue workflow | No | systematic-debugging |
| `/refactor` | Quality-driven refactoring | No | writing-plans |
| `/improve` | Feature enhancement | No | — |
| `/lint-drift` | Entropy scanner for pattern drift | No | — |

Phases 1-3 (`/brd`, `/spec`, `/design`) require human approval. Phases 4-8 run autonomously via `/auto`.

---

## 13. Quality Principles

Detailed rules in `.claude/skills/code-gen/SKILL.md`. Summary:

1. **TDD mandatory** — Write failing tests FIRST, then implement. Red-green-refactor.
2. **100% meaningful coverage** — Every line verified by a test. 80% hard floor.
3. **Small modules** — One file = one responsibility. Warn 200, block 300 lines.
4. **Static typing** — Zero `any` in TypeScript. Full annotations in Python.
5. **Functions under 50 lines** — Decompose into named, testable subfunctions.
6. **Explicit error handling** — Typed error classes, no bare exceptions.
7. **No dead code** — Every line traces to a story.
8. **Self-documenting** — Good names over comments, types as documentation.
9. **Structured logging** — `extra` dicts, not f-strings. Log at service boundaries.
10. **No silent fallbacks** — Failed operations raise typed errors. Callers decide.
