# PRD format — the human-authored entry artifact

A PRD (Product Requirements Document) is the **human-written** document that
starts the SDLC pipeline. You write it before scaffolding; you pass it to
`/brd --prd path/to/prd.md` (an alias for `--frd`), which grounds the BRD against
it with a deterministic net-new/dropped gate. Everything downstream
(`/spec → /design → /test → /auto`) traces back to it.

This is the format the harness grounds best against. It is **lean and
machine-checkable on purpose**: every functional and non-functional requirement
carries a stable id so the grounding gate can prove the BRD invented nothing and
dropped nothing.

## Template

```markdown
# PRD: <product / feature name>

## 1. Problem & Goal
<One paragraph. Why this exists, and what success looks like.>

## 2. Users & Jobs-to-be-done
<Who the users are and what they are trying to accomplish.>

## 3. Functional Requirements
- **FR-1** <atomic, testable behavior the system must provide>
- **FR-2** <…>
<Each FR is one discrete, observable behavior with a stable id. No paragraphs
that bundle three requirements into one bullet — split them.>

## 4. Non-Functional Requirements
- **NFR-1** <performance / latency / throughput target>
- **NFR-2** <security / privacy / compliance constraint>
- **NFR-3** <availability / SLO / accessibility level>
<NFRs are where the "ilities" enter the grounding chain. Give numbers where you
can ("p95 < 200ms", "WCAG 2.1 AA"), not adjectives.>

## 5. Out of Scope
- <explicit non-goal>
- <explicit non-goal>
<These become the BRD's Forbidden Actions — the deny-list the gate and any
autonomous merge enforce. Be explicit; silence is read as "allowed".>

## 6. Acceptance / Done
- **FR-1** → <observable end-state that proves FR-1 is met>
- **FR-2** → <…>
<One postcondition per FR. This is the evaluator's pass/fail oracle, so it must
be observable (an API response, a UI state, a row in a table) — not "works
correctly".>
```

## Why this shape

| Section | Feeds | Purpose |
|---|---|---|
| 3. FR-n (id'd) | `/brd` grounding gate | mechanical net-new/dropped proof |
| 4. NFR-n (id'd) | design + evaluator | NFRs are traceable, not afterthoughts |
| 5. Out of Scope | BRD **Forbidden Actions** | deny-list the autonomous gate enforces |
| 6. Acceptance | evaluator **postconditions** | independent pass/fail oracle, not self-judging |

The id discipline (FR-n / NFR-n) is what makes `/brd --prd` deterministic: a
requirement you fail to id here is a requirement that can be silently dropped
downstream. Sections 5 and 6 are what let the pipeline run **autonomously to
merge** safely — the gate has an explicit deny-list and a concrete oracle instead
of trusting the generator's own "done".

## Don't have a PRD yet?

Run `/brd` with no argument for an interactive Socratic interview that builds the
requirements from scratch. Use a PRD when you already know what you want and want
the grounding gate to hold the pipeline to it.
