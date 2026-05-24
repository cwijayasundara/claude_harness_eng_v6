# Phase Ratchet Evaluators — Design Spec

**Date:** 2026-05-24
**Status:** Draft
**Author:** Claude Harness Engine v4

## Problem

The harness has a validation asymmetry: phases 4-6 (implement/evaluate/design-critic) use a full GAN ratchet loop with automated quality gates, but phases 1-3 (BRD/spec/design) and brownfield discovery rely solely on human approval gates with no automated validation. Bad planning artifacts cascade: a vague BRD produces vague specs, which produce incomplete contracts, which produce code that passes tests but misses requirements.

## Solution

Add an Opus 4.7 phase evaluator that validates every planning artifact before the human gate. The evaluator scores against a phase-specific rubric, returns findings, and the generator (Opus 4.6) revises. Scores must monotonically increase (ratchet rule). Human gate is preserved — the evaluator runs BEFORE the human sees the artifact.

## Model Strategy

| Role | Model | Rationale |
|------|-------|-----------|
| Generator (planning phases) | Opus 4.6 | Strategic reasoning — quality of first draft reduces iterations |
| Validator (all phases) | Opus 4.7 | Highest intelligence for cross-phase traceability and rubric scoring |
| Generator (code phases) | Sonnet 4.6 | Mechanical work — advisor pattern sweet spot (unchanged) |

Planning phases are ~10% of total project tokens but determine ~80% of downstream rework. Investing in Opus 4.6 generation + Opus 4.7 validation here saves cost in code phases.

## Phases Covered

| Phase | Skill | Artifacts validated |
|-------|-------|---------------------|
| BRD | `/brd` | `specs/brd/brd.md` |
| Spec | `/spec` | Story files, `features.json`, `epics.md`, `dependency-graph.md` |
| Design | `/design` | API contracts, schemas, mockups, component-map, folder-structure |
| Brownfield | `/brownfield` | Architecture map, risk map, test map, coupling report |
| Seam-finder | `/brownfield` (sub) | `seams-<goal>.md` ranked candidates |
| Deploy | `/deploy` | Docker Compose, Dockerfiles, init.sh |

## Architecture

### Core Loop

```
Generator (Opus 4.6) produces artifact
        |
        v
Phase Evaluator (Opus 4.7) scores against rubric
        |
        v
    Score >= threshold (7.0) AND all criteria >= 5?
       /                    \
     YES                    NO
      |                      |
      v                      v
  Present to human      Return findings to generator
  for approval          Generator revises artifact
                        Re-score (MUST be >= previous)
                        Max 3 iterations
                             |
                             v
                        3rd fail? Present best version
                        to human with findings attached
```

### Ratchet Rule

```
score_history = []

for iteration in 1..MAX_ITERATIONS:
    score = evaluator.score(artifact)

    if score_history and score.weighted_avg < last(score_history).weighted_avg:
        revert to previous artifact version
        instruct generator to try DIFFERENT approach (not incremental fix)
        continue

    score_history.append(score)

    if score.weighted_avg >= 7.0 and all(criterion >= 5 for criterion in score):
        present_to_human(artifact, score)
        break

    generator.revise(artifact, findings=score.findings)

if not passed after MAX_ITERATIONS:
    present_to_human(best_scoring_version, all_findings)
```

**Ratchet invariant:** `score[i].weighted_avg >= score[i-1].weighted_avg` — always. If violated, revert and force pivot.

### Cross-Phase Traceability Chain

```
BRD goals/scope
    | (spec evaluator validates)
    v
Spec stories — each must trace to >= 1 BRD goal
    | (design evaluator validates)
    v
Design components — every story must have API endpoints + component-map entry
    | (existing sprint contract negotiation validates)
    v
Sprint contract checks — each traces to >= 1 acceptance criterion
    | (existing evaluator validates)
    v
Running code verified against contract
```

**Checks at each boundary:**

- **Spec -> BRD:** Parse BRD goals. Verify every story references a BRD goal. Flag orphan stories and uncovered goals.
- **Design -> Spec:** Verify every story ID in component-map. Every API-layer story has endpoints. Every UI-layer story has a mockup.
- **Contract -> ACs:** Already exists in `/auto` step 3 (no change).

## Quality Rubrics

### Scoring Model

5 criteria per phase, each scored 1-10. Equal weights (no per-criterion weighting — planning artifacts don't have the DQ/O/C/F asymmetry of UI design).

**Pass criteria:**
- Weighted average >= **7.0**
- ALL individual criteria >= **5**

### BRD Rubric

| Criterion | Score 1-3 (Fail) | Score 4-6 (Weak) | Score 7-10 (Pass) |
|-----------|------------------|-------------------|-------------------|
| **Completeness** | Missing sections | Sections present but thin | All 13 sections with substance |
| **Traceability** | N/A (root phase) | N/A | N/A — scored as 10 always |
| **Specificity** | "Users are happy" | Some metrics but vague | >= 3 quantified success metrics |
| **Consistency** | Contradictions between sections | Minor misalignments | Scope, MVP, architecture align |
| **Actionability** | No clear MVP | MVP exists but ambiguous | MVP maps to scope, alternatives documented |

### Spec Rubric

| Criterion | Score 1-3 | Score 4-6 | Score 7-10 |
|-----------|-----------|-----------|------------|
| **Completeness** | Missing stories for BRD goals | Most goals covered | Every BRD goal has >= 1 story |
| **Traceability** | No goal references | Some stories reference goals | Every story traces to a BRD goal, zero orphans |
| **Specificity** | "Works properly" ACs | Mostly testable ACs | All ACs contain: specific values, status codes, observable states |
| **Consistency** | Circular deps | Minor dep issues | Acyclic graph, layer assignments respect architecture |
| **Actionability** | Needs_breakdown stories | Most ready | All stories `ready`, 3-6 ACs each, groups assigned |

### Design Rubric

| Criterion | Score 1-3 | Score 4-6 | Score 7-10 |
|-----------|-----------|-----------|------------|
| **Completeness** | Missing components for stories | Most stories covered | Component-map covers every story, all mockups present |
| **Traceability** | No story references | Partial coverage | Every API-layer story has endpoints, every UI story has mockup |
| **Specificity** | Invalid schemas | Schemas valid but incomplete | OpenAPI + JSON Schema valid, all entities cross-referenced |
| **Consistency** | Mockup fields don't match API | Minor mismatches | All mockup fields match API contract fields |
| **Actionability** | No folder structure | Structure exists but incomplete | Folder structure viable, file ownership unique, shared files annotated |

### Brownfield Rubric

| Criterion | Score 1-3 | Score 4-6 | Score 7-10 |
|-----------|-----------|-----------|------------|
| **Completeness** | Major modules missing | Most modules found | All source dirs/modules in architecture map |
| **Traceability** | Claims without evidence | Some citations | Every claim cites graph edge, file path, or test output |
| **Specificity** | Vague risk descriptions | Risks identified but unquantified | Risks cite specific files, metrics, coupling numbers |
| **Consistency** | Coupling numbers don't match graph | Minor discrepancies | Fan-in/fan-out match code-graph.json |
| **Actionability** | No change strategy | Generic recommendations | Concrete lane recommendation with rationale per area |

### Seam-Finder Rubric

| Criterion | Score 1-3 | Score 4-6 | Score 7-10 |
|-----------|-----------|-----------|------------|
| **Completeness** | < 3 candidates | 3+ candidates but narrow | >= 3 diverse candidates with different trade-offs |
| **Traceability** | No file references | Some file refs | Every candidate cites specific files and interfaces |
| **Specificity** | No observability analysis | Partial scoring | All 3 axes scored (observability, funnel, read/write asymmetry) |
| **Consistency** | Candidates overlap heavily | Minor overlap | Candidates are independent cut-points |
| **Actionability** | No recommended action | Recommendation without effort estimate | Clear recommendation with effort/risk/benefit per candidate |

### Deploy Rubric

| Criterion | Score 1-3 | Score 4-6 | Score 7-10 |
|-----------|-----------|-----------|------------|
| **Completeness** | Missing services | Most services present | Every service has Dockerfile + compose entry |
| **Traceability** | Config doesn't match architecture | Partial match | Every service in system-design.md has compose entry |
| **Specificity** | Invalid YAML/Dockerfile syntax | Valid syntax, missing health checks | Valid syntax, health checks, resource limits |
| **Consistency** | Port conflicts, missing networks | Minor config issues | No conflicts, networks/volumes correct, env vars consistent |
| **Actionability** | No init.sh | init.sh exists but incomplete | init.sh bootstraps all services, .env.example complete |

## Phase Evaluator Agent

### Agent Definition

**File:** `.claude/agents/phase-evaluator.md`

**Role:** Skeptical reviewer for planning artifacts. Scores against phase-specific rubrics, checks cross-phase traceability, enforces quality thresholds.

**Model:** Opus (highest intelligence for traceability analysis)

**Key behaviors:**
- Never generate artifacts — only evaluate
- Score conservatively — doubt is a feature, not a bug
- Cross-phase checks are mandatory, not optional
- Return structured JSON with scores + findings
- Each finding must cite specific evidence (line, section, file)

### Output Schema

```json
{
  "phase": "spec",
  "iteration": 2,
  "timestamp": "2026-05-24T14:30:00Z",
  "upstream_phase": "brd",
  "upstream_artifact": "specs/brd/brd.md",
  "scores": {
    "completeness": 8,
    "traceability": 6,
    "specificity": 9,
    "consistency": 7,
    "actionability": 8
  },
  "weighted_average": 7.6,
  "threshold": 7.0,
  "per_criterion_minimum": 5,
  "verdict": "PASS",
  "failing_criteria": [],
  "findings": [
    {
      "criterion": "traceability",
      "severity": "warning",
      "location": "specs/stories/E2-S3.md",
      "finding": "Story E2-S3 user-story does not reference any BRD goal",
      "suggestion": "Add goal reference: BRD goal 'User self-service' (Section 3.2)"
    }
  ],
  "traceability_report": {
    "upstream_goals_total": 5,
    "upstream_goals_covered": 5,
    "orphan_items": [],
    "uncovered_upstream": []
  },
  "score_history": [
    {"iteration": 1, "weighted_average": 5.8, "verdict": "FAIL"},
    {"iteration": 2, "weighted_average": 7.6, "verdict": "PASS"}
  ]
}
```

## Telemetry

### New Prometheus Metrics

**1. `harness_phase_eval_score` (gauge)**

Quality score per phase evaluation.

| Label | Values |
|-------|--------|
| `phase` | brd, spec, design, brownfield, seam, deploy |
| `criterion` | completeness, traceability, specificity, consistency, actionability, weighted_avg |
| `user` | from HARNESS_USER |
| `group` | from current-group marker |
| `iteration` | ratchet iteration number |
| `verdict` | pass, fail |

**2. `harness_phase_eval_iterations_total` (counter)**

Total ratchet iterations per phase.

| Label | Values |
|-------|--------|
| `phase` | brd, spec, design, brownfield, seam, deploy |
| `user` | from HARNESS_USER |
| `group` | from current-group marker |
| `verdict` | pass, fail, escalated |

### Integration with record-run.js

Phase evaluator runs are already captured as subagent events (PostToolUse for Task/Agent tool). The existing `harness_agent_runs_total` metric will show phase-evaluator invocations with `agent=phase-evaluator`.

The two new metrics require extending `telemetry-memory.js`:
- Parse phase eval JSON from `specs/reviews/phase-*-eval.json`
- Push scores as gauge metrics on each evaluation
- Increment iteration counter

### New Grafana Panels

Add to the existing dashboard under a new **"Phase Quality"** section:

| Panel | Type | Query |
|-------|------|-------|
| Phase Quality Scores | Bar gauge | `harness_phase_eval_score{criterion="weighted_avg"}` by phase |
| Ratchet Iterations per Phase | Stat | `harness_phase_eval_iterations_total` by phase |
| Traceability Coverage | Bar gauge | `harness_phase_eval_score{criterion="traceability"}` by phase |
| Phase Eval Pass Rate | Pie chart | `harness_phase_eval_iterations_total` by verdict |

## Memory / Persistence

### Per-Phase Evaluation Artifacts

```
specs/reviews/phase-brd-eval.json         # BRD evaluation scores + findings
specs/reviews/phase-spec-eval.json        # Spec evaluation scores + findings
specs/reviews/phase-design-eval.json      # Design evaluation scores + findings
specs/reviews/phase-brownfield-eval.json  # Brownfield evaluation scores + findings
specs/reviews/phase-seam-eval.json        # Seam-finder evaluation scores + findings
specs/reviews/phase-deploy-eval.json      # Deploy evaluation scores + findings
```

### Score History

Each eval JSON contains `score_history` array preserving all iteration scores. This persists across sessions via `claude-progress.txt` (session chaining) and the eval JSON files themselves.

### Learned Rules

Recurring phase evaluation failures (same criterion fails 2+ times across groups) trigger learned rule extraction, following the existing pattern:

```markdown
## Rule {N}: {phase} — {criterion} failure

- **Source:** Phase {phase}, Group {group}, Iteration {iter}
- **Pattern:** {repeated failure signature}

### Mistake
{what was wrong with the artifact}

### Better Approach
{what the evaluator recommended}

- **Rule:** {concrete instruction to prevent recurrence}
- **Applied in:** planner, phase-evaluator
```

## Skill Modifications

### /brd — Add evaluator loop after generation

Insert between "Generate BRD" and "Request human approval":

```
Step N: Phase Evaluation Gate
1. Spawn phase-evaluator agent (Opus) with:
   - phase: "brd"
   - artifact: specs/brd/brd.md
   - rubric: BRD rubric (5 criteria)
   - upstream: none (root phase)
2. If FAIL: return findings to planner, revise, re-evaluate (max 3 iterations)
3. Ratchet: score must be >= previous iteration
4. If PASS: proceed to human approval with eval report attached
5. If 3 iterations exhausted: present best version + findings to human
```

### /spec — Add evaluator loop with BRD traceability

```
Step N: Phase Evaluation Gate
1. Spawn phase-evaluator agent (Opus) with:
   - phase: "spec"
   - artifact: specs/stories/*.md + features.json
   - rubric: Spec rubric (5 criteria)
   - upstream: specs/brd/brd.md (traceability check)
2. Evaluator parses BRD goals, verifies every story traces to a goal
3. Evaluator checks: ACs testable, deps acyclic, groups valid, features.json complete
4. Ratchet loop (max 3 iterations)
5. Present to human with traceability report
```

### /design — Wrap existing field check into evaluator

Replace existing "post-completion validation" with full evaluator:

```
Step N: Phase Evaluation Gate
1. Spawn phase-evaluator agent (Opus) with:
   - phase: "design"
   - artifact: specs/design/* (all design artifacts)
   - rubric: Design rubric (5 criteria)
   - upstream: specs/stories/*.md (traceability check)
2. Evaluator includes existing field-shape check (mockup vs API)
3. Additionally validates: schema syntax, component-map coverage, file ownership
4. Ratchet loop (max 3 iterations)
5. Present to human with traceability report
```

### /brownfield — Add evaluator loop and human gate

Currently no gate. Add both:

```
Step N: Phase Evaluation Gate
1. Spawn phase-evaluator agent (Opus) with:
   - phase: "brownfield"
   - artifact: specs/brownfield/*.md + code-graph.json
   - rubric: Brownfield rubric (5 criteria)
   - upstream: actual codebase (verify claims against real files)
2. Evaluator spot-checks: do claimed modules exist? do test commands work?
3. Ratchet loop (max 2 iterations — discovery, not creation)
4. Present to human for approval (NEW gate)
```

### /brownfield seam-finder — Add evaluator

```
Step N: Phase Evaluation Gate
1. Spawn phase-evaluator agent (Opus) with:
   - phase: "seam"
   - artifact: specs/brownfield/seams-<goal>.md
   - rubric: Seam-finder rubric (5 criteria)
   - upstream: specs/brownfield/code-graph.json
2. Evaluator verifies top candidates exist in codebase
3. Ratchet loop (max 2 iterations)
4. Present ranked candidates to human
```

### /deploy — Add evaluator

```
Step N: Phase Evaluation Gate
1. Spawn phase-evaluator agent (Opus) with:
   - phase: "deploy"
   - artifact: docker-compose.yml, Dockerfiles, init.sh, .env.example
   - rubric: Deploy rubric (5 criteria)
   - upstream: specs/design/system-design.md (every service needs compose entry)
2. Evaluator validates: YAML syntax, port uniqueness, health checks present
3. Ratchet loop (max 2 iterations)
4. Present to human for approval
```

## Files to Create

| File | Purpose |
|------|---------|
| `.claude/agents/phase-evaluator.md` | Agent definition with rubric scoring instructions |
| `.claude/templates/phase-eval-rubrics.json` | Machine-readable rubric definitions for all 6 phases |
| `.claude/templates/phase-eval-result.schema.json` | JSON Schema for evaluation output |

## Files to Modify

| File | Change |
|------|--------|
| `.claude/skills/brd/SKILL.md` | Add evaluator loop before human gate |
| `.claude/skills/spec/SKILL.md` | Add evaluator loop with BRD traceability |
| `.claude/skills/design/SKILL.md` | Replace field check with full evaluator |
| `.claude/skills/brownfield/SKILL.md` | Add evaluator loop + human gate |
| `.claude/skills/deploy/SKILL.md` | Add evaluator loop |
| `.claude/scripts/telemetry-memory.js` | Add phase eval metric collection |
| `.claude/hooks/record-run.js` | Emit phase eval records |
| `telemetry/grafana/dashboards/harness-overview.json` | Add 4 Phase Quality panels |
| `pptx_util/deck_slides.py` or `deck_slides_continued.py` | Add phase quality slide to deck |

## Iteration Limits

| Phase | Max iterations | Rationale |
|-------|---------------|-----------|
| BRD | 3 | Document artifact, should converge fast |
| Spec | 3 | More complex (stories + deps), may need 3 rounds |
| Design | 3 | Schemas + mockups, may need 3 rounds |
| Brownfield | 2 | Discovery — either the map is right or it needs re-scanning |
| Seam-finder | 2 | Heuristic ranking — 2 rounds sufficient |
| Deploy | 2 | Config generation — syntax issues fix quickly |

## Cost Estimate

| Phase | Without evaluator (current) | With evaluator (proposed) |
|-------|---------------------------|--------------------------|
| BRD | ~15K Opus 4.6 tokens + 0 validation | ~15K Opus 4.6 + ~5K Opus 4.7 (1-2 evals) |
| Spec | ~25K Opus 4.6 + 0 validation | ~25K Opus 4.6 + ~8K Opus 4.7 (1-2 evals) |
| Design | ~30K Opus 4.6 + 0 validation | ~30K Opus 4.6 + ~10K Opus 4.7 (1-2 evals) |
| Brownfield | ~20K Opus 4.6 + 0 validation | ~20K Opus 4.6 + ~6K Opus 4.7 (1-2 evals) |
| Deploy | ~10K Opus 4.6 + 0 validation | ~10K Opus 4.6 + ~4K Opus 4.7 (1-2 evals) |

**Net cost increase:** ~33K Opus 4.7 tokens across all planning phases (~$0.50-1.00 per full pipeline run). This is offset by reduced rework in code phases — fewer ratchet iterations in `/auto` due to better plans.

## Success Criteria

1. Every planning artifact passes a 5-criterion rubric before human review
2. Cross-phase traceability: zero orphan stories, zero uncovered BRD goals
3. Ratchet enforced: scores never decrease between iterations
4. Telemetry: phase eval scores visible in Grafana
5. Learned rules: recurring failures extracted and injected into future runs
6. Human gate preserved: evaluator runs BEFORE human, not instead of human
