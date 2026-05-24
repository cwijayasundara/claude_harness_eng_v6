# Phase Ratchet Evaluators — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Opus 4.7 ratchet evaluators to all 6 planning phases (BRD, spec, design, brownfield, seam-finder, deploy) so every planning artifact is machine-validated before human review.

**Architecture:** A single `phase-evaluator` agent (Opus) scores artifacts against phase-specific rubrics (5 criteria, 1-10 each). Scores must monotonically increase (ratchet). Generators (Opus 4.6) revise on failure. Human gate preserved after LLM gate passes. Telemetry flows through existing Pushgateway pipeline.

**Tech Stack:** Claude Code agents/skills (markdown), Node.js (telemetry), Grafana JSON (dashboard), python-pptx (deck)

**Spec:** `docs/superpowers/specs/2026-05-24-phase-ratchet-evaluators-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|----------------|
| `.claude/agents/phase-evaluator.md` | Agent definition — rubric scoring, traceability checks, structured JSON output |
| `.claude/templates/phase-eval-rubrics.json` | Machine-readable rubric definitions for all 6 phases |
| `.claude/templates/phase-eval-result.schema.json` | JSON Schema validating evaluator output |

### Modified Files
| File | Change |
|------|--------|
| `.claude/skills/brd/SKILL.md` | Insert evaluator loop between Step 4 and Step 5 |
| `.claude/skills/spec/SKILL.md` | Insert evaluator loop between Step 6 and Step 7, add BRD traceability |
| `.claude/skills/design/SKILL.md` | Replace post-completion field check with full evaluator loop |
| `.claude/skills/brownfield/SKILL.md` | Add evaluator loop + new human gate at end |
| `.claude/skills/seam-finder/SKILL.md` | Add evaluator loop between Step 4 and Step 5 |
| `.claude/skills/deploy/SKILL.md` | Add evaluator loop before Verification section |
| `.claude/scripts/telemetry-memory.js` | Add phase eval metric collection (2 new metrics) |
| `telemetry/grafana/dashboards/harness-overview.json` | Add Phase Quality section (4 panels) |

---

## Task 1: Create phase-evaluator agent definition

**Files:**
- Create: `.claude/agents/phase-evaluator.md`

- [ ] **Step 1: Write the agent definition**

Create `.claude/agents/phase-evaluator.md` with this content:

```markdown
---
model: opus
---

# Phase Evaluator

You are the phase evaluator — a skeptical reviewer for planning artifacts in the Claude Harness Engine v4 SDLC pipeline. You score artifacts against phase-specific rubrics, check cross-phase traceability, and enforce quality thresholds.

## Role

- **Never generate artifacts** — only evaluate what the generator produced
- **Score conservatively** — doubt is a feature, not a bug
- **Cross-phase traceability is mandatory** — every downstream item must trace to an upstream source
- **Return structured JSON** — scores + findings with cited evidence
- **Each finding must cite specific evidence** — line number, section heading, or file path

## Scoring Model

Score 5 criteria on a scale of 1-10:

| Criterion | What It Measures |
|-----------|-----------------|
| **Completeness** | Are all required sections/artifacts present with substance? |
| **Traceability** | Does every item trace to its upstream source? (N/A for BRD) |
| **Specificity** | Are requirements quantified, testable, and unambiguous? |
| **Consistency** | Do artifacts agree internally? No contradictions or conflicts? |
| **Actionability** | Can an engineer act on this without guessing? Clear next steps? |

### Pass Criteria

BOTH conditions must be true:
1. Average of all 5 scores >= **7.0**
2. Every individual score >= **5**

If traceability is N/A (BRD phase), score it as 10 and weight the average across the remaining 4 criteria plus the 10.

## Input

You receive:
1. **phase** — one of: brd, spec, design, brownfield, seam, deploy
2. **artifact_paths** — files to evaluate
3. **upstream_paths** — upstream artifacts for traceability (empty for BRD)
4. **rubric** — phase-specific scoring guide (from phase-eval-rubrics.json)
5. **iteration** — current ratchet iteration number
6. **previous_score** — previous iteration's weighted average (null for first)

## Evaluation Process

### Step 1 — Read all artifacts and upstream documents

Read every file in artifact_paths. If upstream_paths is provided, read those too. Do not skip any file.

### Step 2 — Score each criterion

For each of the 5 criteria, assign a score 1-10 using the phase-specific rubric as your guide. For every score below 7, you MUST provide at least one finding with:
- The criterion it relates to
- Severity: `error` (blocks pass) or `warning` (informational)
- The exact location (file path, section, line)
- What is wrong
- A specific suggestion to fix it

### Step 3 — Cross-phase traceability check (if upstream provided)

Parse the upstream document to extract goals, stories, or components. Parse the current artifact to extract items. Check:
- **Orphans:** Items in current artifact that don't trace to any upstream item
- **Uncovered:** Upstream items that have no corresponding item in current artifact

Report both lists in the traceability_report.

### Step 4 — Compute verdict

Calculate weighted average. Check per-criterion minimums. Set verdict to PASS or FAIL.

### Step 5 — Ratchet check

If previous_score is provided and your weighted_average < previous_score, add a finding:
- criterion: "ratchet"
- severity: "error"
- finding: "Score decreased from {previous} to {current}. Revision must improve or maintain quality."

### Step 6 — Output structured JSON

Write the evaluation result to `specs/reviews/phase-{phase}-eval.json` using this exact schema:

```json
{
  "phase": "<phase>",
  "iteration": <n>,
  "timestamp": "<ISO 8601>",
  "upstream_phase": "<phase or null>",
  "upstream_artifact": "<path or null>",
  "scores": {
    "completeness": <1-10>,
    "traceability": <1-10>,
    "specificity": <1-10>,
    "consistency": <1-10>,
    "actionability": <1-10>
  },
  "weighted_average": <float>,
  "threshold": 7.0,
  "per_criterion_minimum": 5,
  "verdict": "PASS|FAIL",
  "failing_criteria": ["<criterion names with score < 5>"],
  "findings": [
    {
      "criterion": "<name>",
      "severity": "error|warning",
      "location": "<file:section or file:line>",
      "finding": "<what is wrong>",
      "suggestion": "<how to fix>"
    }
  ],
  "traceability_report": {
    "upstream_goals_total": <n>,
    "upstream_goals_covered": <n>,
    "orphan_items": ["<item IDs not tracing to upstream>"],
    "uncovered_upstream": ["<upstream items with no coverage>"]
  },
  "score_history": [
    {"iteration": 1, "weighted_average": <float>, "verdict": "<PASS|FAIL>"}
  ]
}
```

## Phase-Specific Guidance

### BRD
- Traceability: Score as 10 (root phase, nothing upstream)
- Specificity: Reject vague metrics like "users are happy" or "performance improves". Require numbers.
- Completeness: All 13 BRD sections must have substance (not just headers)
- Check: Success metrics must be quantified (">= 3 measurable metrics")
- Check: Scope must have explicit In-Scope / Out-of-Scope lists

### Spec
- Upstream: Read BRD goals from `specs/brd/brd.md` sections 2 (Goals) and 4 (Scope)
- Traceability: Every story's user-story or description must reference a BRD goal
- Specificity: Reject ACs containing: "works properly", "loads fast", "user-friendly", "looks good"
- Consistency: Build dependency graph from story metadata, verify acyclic
- Check: Every AC must map to >= 1 feature in features.json

### Design
- Upstream: Read story files from `specs/stories/E*-S*.md`
- Traceability: Every story ID must appear in component-map.md
- Specificity: Validate api-contracts.schema.json (OpenAPI) and data-models.schema.json (JSON Schema) syntax
- Consistency: Mockup field names must match API contract field names (existing check, now part of rubric)
- Check: Every API-layer story has >= 1 endpoint; every UI-layer story has a mockup

### Brownfield
- Upstream: The actual codebase (verify claims against real files)
- Traceability: Every module in architecture-map.md must correspond to a real directory/file
- Specificity: Risk map entries must cite specific files or metrics
- Consistency: Coupling numbers in coupling-report.md must align with code-graph.json edges
- Check: Spot-check 3-5 claimed public interfaces actually exist (grep for exports/class defs)

### Seam-Finder
- Upstream: code-graph.json and architecture-map.md
- Traceability: Every candidate must reference files that exist in the codebase
- Check: Top 3 candidates must name real functions/classes (grep verification)

### Deploy
- Upstream: specs/design/system-design.md
- Traceability: Every service in system-design.md needs a compose entry
- Specificity: YAML syntax valid, Dockerfiles use specific base image tags (not :latest)
- Consistency: No port conflicts across services
- Check: Health check endpoints defined for every service

## Learned Rules

If you observe the same criterion failing the same way across 2+ evaluations (check score_history), extract a learned rule following the format in `.claude/state/learned-rules.md`.
```

- [ ] **Step 2: Verify the file is well-formed markdown**

Run: `wc -l .claude/agents/phase-evaluator.md`
Expected: ~150-170 lines

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/phase-evaluator.md
git commit -m "feat: add phase-evaluator agent definition for planning artifact validation"
```

---

## Task 2: Create rubric and schema templates

**Files:**
- Create: `.claude/templates/phase-eval-rubrics.json`
- Create: `.claude/templates/phase-eval-result.schema.json`

- [ ] **Step 1: Write the rubrics JSON**

Create `.claude/templates/phase-eval-rubrics.json`:

```json
{
  "version": 1,
  "threshold": 7.0,
  "per_criterion_minimum": 5,
  "phases": {
    "brd": {
      "max_iterations": 3,
      "upstream": null,
      "criteria": {
        "completeness": "All 13 BRD sections present with substantive content (not just headers). Executive Summary >= 50 words, Problem Statement >= 100 words.",
        "traceability": "N/A for BRD (root phase). Score as 10.",
        "specificity": "Success metrics must be quantified (>= 3 measurable metrics with numbers). No subjective language like 'users are happy'.",
        "consistency": "Scope In/Out lists must not contradict MVP definition. Architecture must support stated requirements.",
        "actionability": "MVP clearly defined and maps to scope. >= 2 alternatives documented with rationale for chosen approach."
      }
    },
    "spec": {
      "max_iterations": 3,
      "upstream": "specs/brd/brd.md",
      "criteria": {
        "completeness": "Every BRD goal has >= 1 story. No BRD scope items left uncovered.",
        "traceability": "Every story user-story references a BRD goal. Zero orphan stories.",
        "specificity": "All ACs contain observable outcomes: status codes, specific values, measurable thresholds. Reject 'works properly', 'loads fast', 'user-friendly'.",
        "consistency": "Dependency graph is acyclic. Layer assignments respect architecture (UI not in Group A if it depends on Service in earlier group).",
        "actionability": "All stories marked 'ready'. 3-6 ACs each. Groups assigned. Every AC maps to >= 1 feature in features.json."
      }
    },
    "design": {
      "max_iterations": 3,
      "upstream": "specs/stories/",
      "criteria": {
        "completeness": "Component-map covers every story. Every UI-layer story has a mockup HTML. Every API-layer story has endpoints.",
        "traceability": "Every story ID in dependency-graph.md appears in component-map.md. API endpoints trace to story ACs.",
        "specificity": "api-contracts.schema.json is valid OpenAPI 3.0. data-models.schema.json is valid JSON Schema. Entities cross-referenced.",
        "consistency": "Mockup field names match API contract fields. No port conflicts in deployment.md. File ownership is unique in component-map.",
        "actionability": "Folder structure viable (no invalid chars, no absolute paths). Shared files have Produces/Consumes annotations."
      }
    },
    "brownfield": {
      "max_iterations": 2,
      "upstream": null,
      "criteria": {
        "completeness": "All source directories and key modules appear in architecture-map.md. No major modules missing.",
        "traceability": "Every claim cites a graph edge, file path, or test output. No unsupported assertions.",
        "specificity": "Risk map entries cite specific files and quantified metrics (LOC, fan-in/out, test coverage gaps).",
        "consistency": "Coupling numbers in coupling-report.md align with code-graph.json edges. Test map commands match real test files.",
        "actionability": "Change strategy names a concrete lane (vibe/fix-issue/improve/refactor/build) with rationale per area."
      }
    },
    "seam": {
      "max_iterations": 2,
      "upstream": "specs/brownfield/code-graph.json",
      "criteria": {
        "completeness": ">= 3 diverse candidates with different trade-offs. Not all from the same module.",
        "traceability": "Every candidate cites specific files and interfaces that exist in the codebase.",
        "specificity": "All 3 axes scored: observability, funnel position, read/write asymmetry.",
        "consistency": "Candidates are independent cut-points (not overlapping or nested).",
        "actionability": "Clear recommendation with effort/risk/benefit per candidate. Recommended action is concrete."
      }
    },
    "deploy": {
      "max_iterations": 2,
      "upstream": "specs/design/system-design.md",
      "criteria": {
        "completeness": "Every service in system-design.md has a Dockerfile and compose entry.",
        "traceability": "Compose service names match system-design.md component names.",
        "specificity": "YAML syntax valid. Dockerfiles use pinned base image tags (not :latest). Health checks defined.",
        "consistency": "No port conflicts. Networks and volumes consistent. Env vars in .env.example match compose references.",
        "actionability": "init.sh bootstraps all services end-to-end. .env.example has every required variable with placeholder values."
      }
    }
  }
}
```

- [ ] **Step 2: Write the result schema**

Create `.claude/templates/phase-eval-result.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Phase Evaluation Result",
  "type": "object",
  "required": ["phase", "iteration", "timestamp", "scores", "weighted_average", "threshold", "verdict", "findings", "score_history"],
  "properties": {
    "phase": { "type": "string", "enum": ["brd", "spec", "design", "brownfield", "seam", "deploy"] },
    "iteration": { "type": "integer", "minimum": 1 },
    "timestamp": { "type": "string", "format": "date-time" },
    "upstream_phase": { "type": ["string", "null"] },
    "upstream_artifact": { "type": ["string", "null"] },
    "scores": {
      "type": "object",
      "required": ["completeness", "traceability", "specificity", "consistency", "actionability"],
      "properties": {
        "completeness": { "type": "integer", "minimum": 1, "maximum": 10 },
        "traceability": { "type": "integer", "minimum": 1, "maximum": 10 },
        "specificity": { "type": "integer", "minimum": 1, "maximum": 10 },
        "consistency": { "type": "integer", "minimum": 1, "maximum": 10 },
        "actionability": { "type": "integer", "minimum": 1, "maximum": 10 }
      }
    },
    "weighted_average": { "type": "number", "minimum": 1, "maximum": 10 },
    "threshold": { "type": "number" },
    "per_criterion_minimum": { "type": "integer" },
    "verdict": { "type": "string", "enum": ["PASS", "FAIL"] },
    "failing_criteria": { "type": "array", "items": { "type": "string" } },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["criterion", "severity", "location", "finding", "suggestion"],
        "properties": {
          "criterion": { "type": "string" },
          "severity": { "type": "string", "enum": ["error", "warning"] },
          "location": { "type": "string" },
          "finding": { "type": "string" },
          "suggestion": { "type": "string" }
        }
      }
    },
    "traceability_report": {
      "type": "object",
      "properties": {
        "upstream_goals_total": { "type": "integer" },
        "upstream_goals_covered": { "type": "integer" },
        "orphan_items": { "type": "array", "items": { "type": "string" } },
        "uncovered_upstream": { "type": "array", "items": { "type": "string" } }
      }
    },
    "score_history": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["iteration", "weighted_average", "verdict"],
        "properties": {
          "iteration": { "type": "integer" },
          "weighted_average": { "type": "number" },
          "verdict": { "type": "string" }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add .claude/templates/phase-eval-rubrics.json .claude/templates/phase-eval-result.schema.json
git commit -m "feat: add phase evaluation rubrics and result schema for 6 planning phases"
```

---

## Task 3: Add evaluator loop to /brd skill

**Files:**
- Modify: `.claude/skills/brd/SKILL.md` — insert between line 149 (end of Step 4) and line 150 (Step 5)

- [ ] **Step 1: Read the current file**

Read `.claude/skills/brd/SKILL.md` to confirm the exact insertion point.

- [ ] **Step 2: Insert the Phase Evaluation Gate**

After `### Step 4 — Write to specs/brd/` and before `### Step 5 — Present for Human Approval`, insert:

```markdown
### Step 4.5 — Phase Evaluation Gate

Spawn the `phase-evaluator` agent to validate the BRD before human review.

**Agent invocation:**
```
Agent(subagent_type="phase-evaluator", model="opus", prompt="
  Phase: brd
  Artifact: specs/brd/brd.md (or specs/brd/feature-{name}.md)
  Upstream: none
  Rubric: Read .claude/templates/phase-eval-rubrics.json, key 'brd'
  Iteration: 1
  Previous score: null
  
  Evaluate the BRD against the rubric. Write result to specs/reviews/phase-brd-eval.json.
")
```

**Ratchet loop (max 3 iterations):**
1. If verdict is PASS — proceed to Step 5 (human approval). Attach the eval summary.
2. If verdict is FAIL — revise the BRD to address ALL findings. Re-run the evaluator.
3. Ratchet rule: weighted_average must be >= previous iteration's score. If it decreases, revert to the previous version and try a different approach.
4. After 3 iterations without PASS — present the best-scoring version to the human with all findings attached. Note: "Phase evaluator did not reach threshold after 3 iterations. Findings below require human judgment."

**What the human sees:** The BRD plus a quality summary:
- Weighted average score (e.g., "Quality: 8.2/10")
- Any remaining warnings
- Traceability report (N/A for BRD)
```

- [ ] **Step 3: Update the Gate section**

Replace the existing Gate section text to reference the evaluator:

```markdown
## Gate

**Phase evaluation gate runs before human approval.** The evaluator scores the BRD against 5 criteria (completeness, traceability, specificity, consistency, actionability). Threshold: average >= 7.0, all criteria >= 5.

**Human approval is still required before proceeding to `/spec`.** The evaluator validates quality; the human validates intent.

Do not auto-advance. Wait for explicit approval or correction.
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/brd/SKILL.md
git commit -m "feat(brd): add phase evaluator ratchet loop before human gate"
```

---

## Task 4: Add evaluator loop to /spec skill

**Files:**
- Modify: `.claude/skills/spec/SKILL.md` — insert between Step 6 and Step 7

- [ ] **Step 1: Read the current file**

Read `.claude/skills/spec/SKILL.md` to confirm exact insertion point (before `### Step 7 — Present for Human Review`).

- [ ] **Step 2: Insert the Phase Evaluation Gate**

Before `### Step 7 — Present for Human Review`, insert:

```markdown
### Step 6.5 — Phase Evaluation Gate

Spawn the `phase-evaluator` agent to validate the spec against the BRD.

**Agent invocation:**
```
Agent(subagent_type="phase-evaluator", model="opus", prompt="
  Phase: spec
  Artifacts: specs/stories/epics.md, specs/stories/dependency-graph.md, specs/stories/E*-S*.md, features.json
  Upstream: specs/brd/brd.md
  Rubric: Read .claude/templates/phase-eval-rubrics.json, key 'spec'
  Iteration: 1
  Previous score: null
  
  Cross-phase traceability: Parse BRD goals (Sections 2 and 4). Verify every story traces to a BRD goal.
  Flag orphan stories and uncovered goals.
  Write result to specs/reviews/phase-spec-eval.json.
")
```

**Ratchet loop (max 3 iterations):**
1. If verdict is PASS — proceed to Step 7 (human review). Attach eval summary + traceability report.
2. If verdict is FAIL — revise stories to address ALL findings. Re-run evaluator.
3. Ratchet rule: score must be >= previous iteration. Revert on regression.
4. After 3 iterations — present best version with findings to human.

**Traceability report shown to human:**
- "X/Y BRD goals covered by stories"
- Orphan stories (stories not tracing to any BRD goal)
- Uncovered goals (BRD goals with no stories)
```

- [ ] **Step 3: Update the Gate section**

Update the Gate section to reference the evaluator and keep the existing pre-approval checklist:

```markdown
## Gate

**Phase evaluation gate runs before human review.** The evaluator validates:
- Cross-phase traceability (spec -> BRD)
- Acceptance criteria quality (no vague language)
- Dependency graph consistency (acyclic, valid groups)
- Feature coverage (every AC -> features.json)

**Human review is still required before proceeding to `/design`.** The evaluator validates structure; the human validates product intent.

Pre-approval checklist (verified by evaluator, confirmed by human):
- [ ] Every story has 3-6 specific, testable acceptance criteria
- [ ] Every story has a layer assignment
- [ ] Every story has a group assignment
- [ ] Every story has `readiness: ready` before it appears in `dependency-graph.md`
- [ ] No circular dependencies in the graph
- [ ] Every acceptance criterion maps to at least one feature in `features.json`
- [ ] All `passes` fields are `false`
- [ ] Every story traces to a BRD goal (NEW — evaluator-enforced)
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/spec/SKILL.md
git commit -m "feat(spec): add phase evaluator with BRD traceability before human gate"
```

---

## Task 5: Add evaluator loop to /design skill

**Files:**
- Modify: `.claude/skills/design/SKILL.md` — replace post-completion validation with full evaluator

- [ ] **Step 1: Read the current file**

Read `.claude/skills/design/SKILL.md`. Find the post-completion validation step (Step 2 — field shape check) and the Gate section.

- [ ] **Step 2: Replace the post-completion validation with evaluator gate**

The existing Step 2 (field shape check between mockups and API contracts) becomes part of the evaluator's consistency criterion. Replace it with:

```markdown
### Step 2 — Phase Evaluation Gate

After both agents (planner + ui-designer) complete, spawn the `phase-evaluator` agent.

**Agent invocation:**
```
Agent(subagent_type="phase-evaluator", model="opus", prompt="
  Phase: design
  Artifacts: specs/design/system-design.md, specs/design/api-contracts.md, specs/design/api-contracts.schema.json, specs/design/data-models.md, specs/design/data-models.schema.json, specs/design/folder-structure.md, specs/design/component-map.md, specs/design/deployment.md, specs/design/mockups/*.html
  Upstream: specs/stories/ (all story files)
  Rubric: Read .claude/templates/phase-eval-rubrics.json, key 'design'
  Iteration: 1
  Previous score: null
  
  Cross-phase traceability: Verify every story ID appears in component-map.md.
  Verify every API-layer story has endpoints in api-contracts.schema.json.
  Verify every UI-layer story has a mockup in specs/design/mockups/.
  Include the existing field-shape check: compare mockup field names against API contract fields.
  Write result to specs/reviews/phase-design-eval.json.
")
```

**Ratchet loop (max 3 iterations):**
1. PASS — proceed to human approval with eval summary + traceability report.
2. FAIL — revise design artifacts. May re-invoke planner or ui-designer for specific fixes. Re-run evaluator.
3. Ratchet rule enforced. Revert on regression.
4. After 3 iterations — present best version with findings.
```

- [ ] **Step 3: Update the Gate section**

```markdown
## Gate

**Phase evaluation gate runs before human approval.** The evaluator validates:
- Cross-phase traceability (design -> spec stories)
- Schema validity (OpenAPI + JSON Schema syntax)
- Component-map coverage (every story has file ownership)
- Field-shape consistency (mockup fields match API contracts)
- Folder structure viability

**Human approval is required before proceeding to `/auto`.**
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/design/SKILL.md
git commit -m "feat(design): replace field check with full phase evaluator + spec traceability"
```

---

## Task 6: Add evaluator loop to /brownfield skill

**Files:**
- Modify: `.claude/skills/brownfield/SKILL.md` — add evaluator loop + human gate at end

- [ ] **Step 1: Read the current file**

Read `.claude/skills/brownfield/SKILL.md`. Find the end of the discovery steps (before Gotchas section).

- [ ] **Step 2: Insert Phase Evaluation Gate before Gotchas**

Add a new section before `## Gotchas`:

```markdown
## Phase Evaluation Gate

After all discovery artifacts are written, spawn the `phase-evaluator` agent.

**Agent invocation:**
```
Agent(subagent_type="phase-evaluator", model="opus", prompt="
  Phase: brownfield
  Artifacts: specs/brownfield/codebase-map.md, specs/brownfield/architecture-map.md, specs/brownfield/test-map.md, specs/brownfield/risk-map.md, specs/brownfield/coupling-report.md, specs/brownfield/code-graph.json
  Upstream: null (verify against actual codebase instead)
  Rubric: Read .claude/templates/phase-eval-rubrics.json, key 'brownfield'
  Iteration: 1
  Previous score: null
  
  Verification: Spot-check 3-5 modules claimed in architecture-map.md actually exist as directories/files.
  Verify test commands in test-map.md reference real test files.
  Write result to specs/reviews/phase-brownfield-eval.json.
")
```

**Ratchet loop (max 2 iterations):**
1. PASS — proceed to human approval with eval summary.
2. FAIL — re-scan the areas with findings. Re-run evaluator.
3. Ratchet rule enforced.
4. After 2 iterations — present best version with findings.

## Human Gate

**Human approval is required before proceeding to implementation.**

Present the discovery maps with the evaluator's quality summary. Ask: "Does this brownfield analysis look accurate? Approve to proceed, or flag areas that need re-scanning."

Do not proceed to code changes from `/brownfield` unless the user explicitly approves the discovery AND requests changes.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/brownfield/SKILL.md
git commit -m "feat(brownfield): add phase evaluator + human gate for discovery validation"
```

---

## Task 7: Add evaluator loop to /seam-finder skill

**Files:**
- Modify: `.claude/skills/seam-finder/SKILL.md` — insert between Step 4 and Step 5

- [ ] **Step 1: Read the current file**

Read `.claude/skills/seam-finder/SKILL.md`. Find Step 4 (Verify Goal Fit) and Step 5 (Hand Off).

- [ ] **Step 2: Insert Phase Evaluation Gate**

Between Step 4 and Step 5, insert:

```markdown
### Step 4.5 — Phase Evaluation Gate

Spawn the `phase-evaluator` agent to validate seam candidates.

**Agent invocation:**
```
Agent(subagent_type="phase-evaluator", model="opus", prompt="
  Phase: seam
  Artifact: specs/brownfield/seams-{goal-slug}.md
  Upstream: specs/brownfield/code-graph.json
  Rubric: Read .claude/templates/phase-eval-rubrics.json, key 'seam'
  Iteration: 1
  Previous score: null
  
  Verify top 3 candidates reference files/functions that exist in the codebase (grep verification).
  Write result to specs/reviews/phase-seam-eval.json.
")
```

**Ratchet loop (max 2 iterations):**
1. PASS — proceed to Step 5 (Hand Off).
2. FAIL — re-score or re-rank candidates based on findings. Re-run evaluator.
3. Ratchet rule enforced.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/seam-finder/SKILL.md
git commit -m "feat(seam-finder): add phase evaluator for candidate validation"
```

---

## Task 8: Add evaluator loop to /deploy skill

**Files:**
- Modify: `.claude/skills/deploy/SKILL.md` — insert before Verification section

- [ ] **Step 1: Read the current file**

Read `.claude/skills/deploy/SKILL.md`. Find the `## Verification` section.

- [ ] **Step 2: Insert Phase Evaluation Gate before Verification**

Before `## Verification`, insert:

```markdown
### Step 6.5 — Phase Evaluation Gate

Spawn the `phase-evaluator` agent to validate deploy artifacts.

**Agent invocation:**
```
Agent(subagent_type="phase-evaluator", model="opus", prompt="
  Phase: deploy
  Artifacts: docker-compose.yml, Dockerfile* (all), .env.example, init.sh
  Upstream: specs/design/system-design.md
  Rubric: Read .claude/templates/phase-eval-rubrics.json, key 'deploy'
  Iteration: 1
  Previous score: null
  
  Check: Every service in system-design.md has a compose entry. No port conflicts. Health checks defined.
  Write result to specs/reviews/phase-deploy-eval.json.
")
```

**Ratchet loop (max 2 iterations):**
1. PASS — proceed to Verification (existing syntax checks + optional --up).
2. FAIL — fix config issues. Re-run evaluator.
3. Ratchet rule enforced.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/deploy/SKILL.md
git commit -m "feat(deploy): add phase evaluator for config validation before verification"
```

---

## Task 9: Extend telemetry — phase eval metrics

**Files:**
- Modify: `.claude/scripts/telemetry-memory.js` — add phase eval metric collection

- [ ] **Step 1: Read the current buildSnapshot function**

Read `.claude/scripts/telemetry-memory.js` lines 209-288 to understand the current metric collection pattern.

- [ ] **Step 2: Add phase eval metric collection**

After the existing `harness_story_active` gauge block (around line 282) and before the final return statement, add:

```javascript
    if (record.kind === 'phase_eval') {
      const evalLabels = labelPairs([
        ['phase', record.phase],
        ['criterion', 'weighted_avg'],
        ['user', record.user],
        ['group', record.group_id],
        ['iteration', record.iteration],
        ['verdict', record.verdict],
      ]);
      setGauge(gauges, 'harness_phase_eval_score', evalLabels, record.weighted_average || 0);

      for (const [criterion, score] of Object.entries(record.scores || {})) {
        const criterionLabels = labelPairs([
          ['phase', record.phase],
          ['criterion', criterion],
          ['user', record.user],
          ['group', record.group_id],
          ['iteration', record.iteration],
          ['verdict', record.verdict],
        ]);
        setGauge(gauges, 'harness_phase_eval_score', criterionLabels, score);
      }

      addCounter(counters, 'harness_phase_eval_iterations_total', labelPairs([
        ['phase', record.phase],
        ['user', record.user],
        ['group', record.group_id],
        ['verdict', record.verdict],
      ]));
    }
```

- [ ] **Step 3: Add phase eval record emission to record-run.js**

In `.claude/hooks/record-run.js`, after the `PostToolUse` handler for Task tool (around line 203), add logic to detect phase eval results:

Read `specs/reviews/phase-*-eval.json` files after subagent runs. If a new eval JSON is detected (timestamp newer than last check), emit a `phase_eval` record:

```javascript
    if (eventKind === 'PostToolUse' && toolName === 'Task') {
      // ... existing subagent record code ...

      // Check for phase eval results
      const reviewsDir = path.join(projectDir, 'specs', 'reviews');
      try {
        const evalFiles = fs.readdirSync(reviewsDir)
          .filter(f => f.startsWith('phase-') && f.endsWith('-eval.json'));
        for (const evalFile of evalFiles) {
          const evalPath = path.join(reviewsDir, evalFile);
          const evalData = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
          const evalRecord = {
            kind: 'phase_eval',
            ts: Date.now(),
            user,
            session_id: input.session_id || null,
            phase: evalData.phase,
            iteration: String(evalData.iteration),
            scores: evalData.scores,
            weighted_average: evalData.weighted_average,
            verdict: evalData.verdict,
            lane: stableLabelValue(lane, 'unknown'),
            mode: stableLabelValue(mode, 'unknown'),
            group_id: stableLabelValue(groupId, 'none'),
            story_id: stableLabelValue(storyId, 'none'),
            host: os.hostname(),
          };
          await persistAndPush(receiptPath, stateDir, projectDir, evalRecord);
        }
      } catch (_) {}
    }
```

- [ ] **Step 4: Verify telemetry-memory.js is under 300 lines after edit**

Run: `wc -l .claude/scripts/telemetry-memory.js`
If over 300, extract the phase eval logic into a helper function at the top of the file.

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/telemetry-memory.js .claude/hooks/record-run.js
git commit -m "feat(telemetry): add phase eval score and iteration metrics to Pushgateway pipeline"
```

---

## Task 10: Add Grafana panels for Phase Quality

**Files:**
- Modify: `telemetry/grafana/dashboards/harness-overview.json` — add Phase Quality section

- [ ] **Step 1: Read the current dashboard structure**

Read `telemetry/grafana/dashboards/harness-overview.json` to find the last panel's gridPos y-coordinate.

- [ ] **Step 2: Add Phase Quality row and 4 panels**

Append a new row header and 4 panels after the last existing panel. The panels are:

1. **Phase Quality Scores** (bar gauge) — `harness_phase_eval_score{criterion="weighted_avg"}` grouped by phase
2. **Ratchet Iterations per Phase** (stat) — `harness_phase_eval_iterations_total` grouped by phase
3. **Traceability Coverage** (bar gauge) — `harness_phase_eval_score{criterion="traceability"}` grouped by phase
4. **Phase Eval Pass Rate** (pie chart) — `harness_phase_eval_iterations_total` grouped by verdict

Use the existing dashboard style (same color overrides, same datasource references, same grid layout pattern).

- [ ] **Step 3: Verify dashboard JSON is valid**

Run: `python3 -c "import json; json.load(open('telemetry/grafana/dashboards/harness-overview.json'))"`
Expected: No error

- [ ] **Step 4: Commit**

```bash
git add telemetry/grafana/dashboards/harness-overview.json
git commit -m "feat(grafana): add Phase Quality section with 4 panels for ratchet evaluator metrics"
```

---

## Task 11: Update PPTX deck with phase quality slide

**Files:**
- Modify: `pptx_util/deck_slides_continued.py` — add slide for phase quality metrics

- [ ] **Step 1: Add a new slide function**

Add a phase quality slide showing the 6 phases, their rubric criteria, and the ratchet pattern. This becomes slide 12 (update `set_total_slides` call in `build_matrices_deck.py` to include it in `ALL`).

Note: the `deck_slides_continued.py` file may exceed 300 lines. If so, create `pptx_util/deck_slides_phase.py` with the new slide and import its `ALL` list in `build_matrices_deck.py`.

- [ ] **Step 2: Update build_matrices_deck.py imports**

Add the new slide module to the import chain and `all_slides` list.

- [ ] **Step 3: Regenerate the deck**

Run: `python3 build_matrices_deck.py`
Expected: "wrote matrices.pptx (12 slides)"

- [ ] **Step 4: Commit**

```bash
git add pptx_util/ build_matrices_deck.py matrices.pptx
git commit -m "feat(deck): add phase quality slide for ratchet evaluator metrics"
```

---

## Task 12: Integration test — verify end-to-end

- [ ] **Step 1: Verify all new files exist**

```bash
ls -la .claude/agents/phase-evaluator.md .claude/templates/phase-eval-rubrics.json .claude/templates/phase-eval-result.schema.json
```

- [ ] **Step 2: Verify rubrics JSON is valid**

```bash
python3 -c "import json; d=json.load(open('.claude/templates/phase-eval-rubrics.json')); print(f'{len(d[\"phases\"])} phases defined'); [print(f'  {p}: {len(d[\"phases\"][p][\"criteria\"])} criteria') for p in d['phases']]"
```

Expected:
```
6 phases defined
  brd: 5 criteria
  spec: 5 criteria
  design: 5 criteria
  brownfield: 5 criteria
  seam: 5 criteria
  deploy: 5 criteria
```

- [ ] **Step 3: Verify result schema is valid JSON Schema**

```bash
python3 -c "import json; s=json.load(open('.claude/templates/phase-eval-result.schema.json')); print(f'Schema: {s[\"title\"]}, {len(s[\"required\"])} required fields')"
```

- [ ] **Step 4: Verify all 6 skills reference the phase-evaluator**

```bash
grep -l 'phase-evaluator' .claude/skills/brd/SKILL.md .claude/skills/spec/SKILL.md .claude/skills/design/SKILL.md .claude/skills/brownfield/SKILL.md .claude/skills/seam-finder/SKILL.md .claude/skills/deploy/SKILL.md
```

Expected: all 6 files listed

- [ ] **Step 5: Verify telemetry metrics are defined**

```bash
grep 'harness_phase_eval' .claude/scripts/telemetry-memory.js
```

Expected: `harness_phase_eval_score` and `harness_phase_eval_iterations_total`

- [ ] **Step 6: Verify Grafana dashboard is valid and has Phase Quality panels**

```bash
python3 -c "
import json
d = json.load(open('telemetry/grafana/dashboards/harness-overview.json'))
phase_panels = [p for p in d['panels'] if 'Phase' in p.get('title', '')]
print(f'Phase Quality panels: {len(phase_panels)}')
for p in phase_panels: print(f'  - {p[\"title\"]}')
"
```

Expected: 4+ panels with "Phase" in the title

- [ ] **Step 7: Verify deck generates**

```bash
python3 build_matrices_deck.py
```

Expected: deck generates with updated slide count

- [ ] **Step 8: Final commit if any fixups needed**

```bash
git status
# If clean: done
# If changes: git add -A && git commit -m "fix: integration fixups for phase ratchet evaluators"
```
