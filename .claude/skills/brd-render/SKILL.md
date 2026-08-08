---
name: brd-render
description: "[Internal pipeline stage — dispatched by /brd once the interview and clarifications are recorded; invoke directly only to re-render an approved intake.] Expand the confirmed requirement spine and clarification log into the BRD analysis pack, the BRD document, and the deterministic grounding and taxonomy gates."
argument-hint: "[--sprint N]"
context: fork
agent: generator
---

# BRD Render — Requirements Expansion (sidekick)

The **rendering** half of `/brd`. `/brd` holds the interview and the
clarification dialogue in the main session and records what was confirmed; this
skill expands that into the analysis pack, the BRD document, and the two hard
gates. It decides nothing and it asks nothing.

Runs on the sidekick model by design. The analysis pack alone was 73 KB on a
real run — six tables derived from requirements that already existed. That is
transcription.

## What is authoritative

- `specs/brd/frd-requirements.json` — the source spine (`--prd` / `--frd` mode),
  already adopted verbatim by `brd-adopt.js`. **Do not reword it.** The
  grounding gate is an identity in adopt mode precisely because nothing was
  transformed; paraphrasing here reintroduces the drift R2 removed.
- `specs/brd/clarification-log.json` — the confirmed answers. Every `basis`
  records who decided. An entry is only usable as a requirement source when it
  was actually confirmed.
- `specs/brd/interview-requirements.json` — in interview mode, the confirmed
  `INT-n` spine. Same rule: confirmed answers only.

Anything not in one of those three is **not** a sanctioned source. Do not invent
a requirement, a threshold, or a retention window to fill a gap — a number
nobody chose reads as decided the moment it is written down, and the grounding
gate will carry it faithfully into the build.

## Ambiguity is returned, not resolved

**Never invoke `/clarify` here.** A forked skill cannot reach the human, so
"clarifying" means answering your own question — the pattern that produced a
clarification log whose every `basis` ended "Original planner reasoning: …",
model-authored on both sides.

Where a gap blocks you, record it and continue with everything it does not
block:

```json
{ "unresolved": [ { "question": "...", "blocks": ["BR-12"], "options": ["...", "..."] } ] }
```

Write these to `specs/brd/brd-unresolved.json` and name them in your return
message. `/brd` puts them to the human and re-dispatches.

`/brd` dispatches this skill after its interview and clarification steps.
Reached on its own with no confirmed spine, stop and say so rather than
interviewing yourself.

---

### Step 2.7 — Seed Domain Vocabulary from Enabled Vertical Plugins

**Run the vertical glossary pack script.** Run `node .claude/scripts/vertical-glossary-pack.js`. This is a no-op (nothing written, nothing to do here) unless `.claude/config/scaffold-packs.json`'s `verticalPacks` array has at least one entry whose `enabled_plugin_prefix` matches a truthy key in `.claude/settings.json#enabledPlugins`.

- **Pack(s) written.** For each `specs/brd/<plugin>-glossary-pack.json` the script wrote, read it. For each context entry, distill the real domain nouns implied by each skill's description into `CONTEXT.md`'s `## Terms` section (create `CONTEXT.md` from `.claude/templates/context.template.md` first if it does not exist yet). Use the context's `name` as a **`<Bounded Context Name>`** bold grouping line (not a `###` heading — `vocabulary-check.js` parses every `###` under `## Terms` as a glossary term, so only actual terms may use that heading level), with individual `### <Term>` entries and a one-line definition beneath each.
- **Broken plugin install.** If the script exited 2, at least one enabled vertical's skills directory was missing or empty. Note the broken plugin install(s) in the progress log and continue — packs from any OTHER, successfully-resolved vertical were still written and should still be distilled per the bullet above. Do not block the BRD on a broken install.
- **No verticals enabled.** If the script reported nothing enabled and wrote no pack files, no registered vertical plugin is active for this project — do nothing further.

**Layering with Step 2.8.** Step 2.8 below still runs afterward for every project and merges `domain_concepts`-derived terms into the same `CONTEXT.md`, layering project-specific concepts on top of any vertical baseline(s) rather than overwriting them.

---

### Step 2.8 — Write the BRD Analysis Pack

Before synthesizing the BRD prose, write `specs/brd/brd-analysis.json`. This is the SPDD-inspired analysis layer that turns the PRD/interview into a design contract instead of a thin summary. It must be grounded in the FRD/PRD, the clarification log, and existing-code scan.

The JSON must include:

```json
{
  "domain_concepts": [
    { "name": "Subscription Plan", "status": "existing|new", "evidence": "FRD-1 or specs/brownfield/code-graph.json node", "notes": "business meaning and nearby terms" }
  ],
  "ambiguity_table": [
    { "id": "AMB-1", "question": "What remains ambiguous?", "default_assumption": "Chosen assumption", "risk_if_wrong": "Concrete consequence", "resolution": "clarified|assumed|deferred", "trace": ["FRD-1", "C1"] }
  ],
  "edge_case_table": [
    { "id": "EDGE-1", "scenario": "Boundary/failure case", "expected_behaviour": "Observable result", "trace": ["FRD-1"] }
  ],
  "decision_log": [
    { "id": "DEC-1", "decision": "Chosen direction", "alternatives_rejected": ["Alternative A"], "rationale": "Trade-off that decided it", "trace": ["C2"] }
  ],
  "ac_coverage_matrix": [
    { "requirement_id": "FRD-1", "acceptance_criteria": ["AC-1"], "covered": true, "gap": "" }
  ],
  "risk_gap_table": [
    { "id": "RISK-1", "risk": "What could derail this", "mitigation": "Harness or design response", "owner": "human|agent|deferred", "trace": ["FRD-2"] }
  ]
}
```

Rules:
- **Domain Concepts** marks each important business object as `existing` or `new`. In brownfield mode, `existing` entries cite a code-graph node or file path; in greenfield, they cite FRD/PRD sections or `INT-n` interview requirements.
- **Ambiguity Table** captures load-bearing uncertainties that were clarified, assumed, or deferred. A deferred ambiguity must appear in the BRD Open Questions.
- **Edge-Case Table** names failures, limits, empty states, concurrency/race cases, and security/privacy exceptions that the BRD must preserve downstream.
- **AC Coverage Matrix** proves every extracted FRD/PRD/`INT-n` requirement has at least one observable acceptance criterion before the grounding gate runs.
- **Risk & Gap Table** records risks and missing inputs without turning them into hidden implementation scope.

  **Seed it from `specs/brd/brd-risks.json`.** Adoption extracts the PRD's own Risks section into that file, and every entry belongs in `risk_gap_table` with its source id in `trace`. The author already identified those risks; a table that omits them while inventing others is describing a different project. Add risks you find beyond them — never replace them.

**Seed the domain glossary.** After writing `domain_concepts`, create or update `CONTEXT.md` at the repo root from it: for each entry, add or update a `### <name>` heading under `## Terms` using `notes` as the definition (use the template at `.claude/templates/context.template.md` if `CONTEXT.md` does not exist yet). Do this for greenfield BRDs too — `CONTEXT.md` must exist after this step whenever `domain_concepts` is non-empty, which it always is. If `/brownfield` already created `CONTEXT.md`, merge into it rather than overwriting existing terms.

If this pack exposes a dropped requirement, unresolved high-risk ambiguity, or uncovered acceptance criterion, fix the interview/clarification log before proceeding. Do not paper over it in the BRD.

### Step 3 — Synthesize into BRD

After all five dimensions are confirmed, produce a structured BRD with these sections:

1. Executive Summary
2. Problem Statement
3. Target Users
4. Success Metrics
5. Scope (In / Out)
6. MVP Definition
7. Alternatives Considered (with rationale for chosen approach)
8. Technical Architecture
9. Data Model Overview
10. External Integrations
11. Edge Cases & Constraints
12. UI Context
13. Open Questions
14. BRD Analysis Summary — summarize the Domain Concepts, Ambiguity Table, Edge-Case Table, AC Coverage Matrix, and Risk & Gap Table from `brd-analysis.json`; keep the full detail in JSON.
15. Forbidden Actions — an explicit list of things the implementation must **not** do, derived from the Out-of-Scope items (Dimension 2) and any source "non-goals". This becomes the deny-list the downstream gate (and any autonomous merge) enforces; phrase each as a checkable prohibition (e.g. "must not call external payment APIs", "must not store raw passwords").

    **Also read `specs/brd/brd-context.json`.** A PRD states deferrals in prose — "v1.5 defers Mode B", "no front-end until P3", "single-user, no RBAC" — and those sit under Scope or Milestones headings, so adoption classifies them as context rather than as `Out of Scope` entries. They are deny-shaped all the same, and a deferral that never reaches this list is one the autonomous merge will not enforce. Promote each such statement to a checkable prohibition here, citing its source id.

### Step 4 — Write to `specs/brd/`

- For a new project: write to `specs/brd/brd.md`
- For a feature addition: write to `specs/brd/feature-{name}.md`

**In `--frd` / `--prd` mode, do NOT write `brd-requirements.json`,
`brd-acceptance.json` or `brd-safeguards.json`.** `/brd` Step 0.1 already
produced them deterministically via `brd-adopt.js`, carrying the source text
verbatim with its own ids. Rewriting them as `BR-n` restores exactly the
paraphrase R2 removed — and neither hard gate can catch it, because an adopted
spine passes Step 4.4 as an identity and a re-expressed `BR-n` spine with
`traces` passes it as coverage. The only difference is that one of them was
proved lossless and the other was not.

Your job in that mode is to **fill what adoption deliberately left blank**: the
`taxonomy` slots on each adopted requirement (Step 4.45 gates them), and the
analysis pack. Leave `id` and `text` untouched. If a requirement's text is
wrong, that is a source-document problem — return it as unresolved rather than
fixing it here, because the source is the immutable baseline.

**Interview mode only** (no `--frd`/`--prd`): write the **machine-readable
requirement spine** to `specs/brd/brd-requirements.json` — one entry per BRD
requirement, each with a stable id and a `traces` array citing the confirmed
`INT-n` interview ids and/or `C-n` clarification ids it derives from:
```json
[
  { "id": "BR-1", "text": "Password reset via emailed link, token valid 1h", "traces": ["FRD-1", "C1"], "taxonomy": ["functional", "security_authz"], "acceptance": "Requesting a reset emails a link that logs the user in once within 1h and is rejected after." },
  { "id": "BR-2", "text": "Paginated order history (20/page)", "traces": ["FRD-2", "C2"], "taxonomy": ["functional"], "acceptance": "Order history returns 20 items/page with working next/prev." }
]
```

Each BR entry carries an `acceptance` postcondition — an observable end-state the evaluator can verify, not a restatement of the requirement. This gives downstream gates (and any autonomous merge) a concrete pass/fail oracle instead of a self-judged "looks done".

Each BR entry also carries `taxonomy` — one or more of the ten slots Step 4.45 checks. Tag by what the requirement *is*, not by which section it came from; one requirement may legitimately carry several tags (an authenticated endpoint is both `functional` and `security_authz`).

**Also write `specs/brd/brd-acceptance.json`** — the postconditions split into individually traceable ids, one per observable claim:

```json
[
  { "id": "BR-1-AC1", "requirement": "BR-1", "text": "A reset request emails a link that logs the user in exactly once" },
  { "id": "BR-1-AC2", "requirement": "BR-1", "text": "A reset link is rejected after 1 hour" }
]
```

A prose `acceptance` sentence usually bundles two or three separate claims, and a story can satisfy one while silently dropping another. Splitting them is what lets `spec-render` Step 6.46 prove coverage at criterion granularity instead of at requirement granularity.

**And write `specs/brd/brd-safeguards.json`** — the non-negotiable boundaries the design must honour, a superset of the Forbidden Actions list:

```json
[
  { "id": "SG-1", "kind": "invariant", "text": "An order total always equals the sum of its line items", "traces": ["FRD-3"] },
  { "id": "SG-2", "kind": "prohibition", "text": "Must not store raw passwords", "traces": ["C4"] },
  { "id": "SG-3", "kind": "limit", "text": "p95 checkout latency stays under 400ms", "traces": ["FRD-7"] }
]
```

`kind` is `invariant` | `prohibition` | `limit` | `norm`. These become required trace targets for the REASONS Canvas `Safeguards` and `Norms` sections at `/design`, so a business constraint cannot quietly fail to reach the design contract.
**Every BR entry must carry at least one valid trace.** If you cannot trace a requirement to an FRD section or a clarification, it is invented — either remove it, or (if the human genuinely wants it) capture the human's confirmation as a new `C-n` entry in `clarification-log.json` first, then trace to it. In interview-from-scratch mode (no FRD), trace BR entries to `INT-n` interview requirements and/or `C-n` clarifications; every `INT-n` must be covered by at least one BR entry.

Create the `specs/brd/` directory if it does not exist.

### Step 4.4 — Grounding Gate [HARD BLOCK — all modes]

Run the deterministic grounding check before the rubric evaluation — in FRD mode against the FRD spine, in interview mode against the confirmed interview spine. This proves mechanically — not by judgement — that the BRD invented and dropped nothing relative to the required spine (FRD or interview) + clarifications:

```bash
# --frd / --prd (adopt) mode: check against the ADOPTION MANIFEST, not the
# requirements subset. brd-requirements.json holds only the requirements, so
# checking the source spine against it reports every context / open-question /
# risk / safeguard entry as \`dropped\` — 52 of 149 on a real spine.
node .claude/skills/brd/scripts/grounding-check.js \
  --frd specs/brd/frd-requirements.json \
  --clarifications specs/brd/clarification-log.json \
  --brd specs/brd/brd-adoption.json \
  --out specs/reviews/brd-grounding.json
```

In interview-from-scratch mode, run the same gate with the interview spine as the required set (the verdict keeps the generic `frd_total`/`frd_covered` field names):

```bash
node .claude/skills/brd/scripts/grounding-check.js \
  --frd specs/brd/interview-requirements.json \
  --clarifications specs/brd/clarification-log.json \
  --brd specs/brd/brd-requirements.json \
  --out specs/reviews/brd-grounding.json
```

**Empty-spine guard (interview mode):** a verdict with `frd_total: 0` means `interview-requirements.json` is empty — the gate checked nothing. A completed five-dimension interview yields at least one `INT-n`; treat `frd_total: 0` as FAIL and return to Step 2 to capture the confirmed requirements before re-running.

The script writes `specs/reviews/brd-grounding.json` (`{ pass, frd_total, frd_covered, net_new[], dropped[] }`) and exits non-zero on any violation. **This is a hard gate, independent of the rubric score:**
- **`net_new` non-empty** → the BRD invented a requirement not in the FRD or any clarification. For each, either delete it or get explicit human sign-off and record it as a `C-n` clarification (then re-trace and re-run). Do **not** proceed with an unresolved net-new requirement.
- **`dropped` non-empty** → the BRD silently lost a required-spine requirement. Add a BR entry covering it (or, if the human confirms it is intentionally out of scope, record that decision as a `C-n` clarification noting the deferral) and re-run.

Only when `brd-grounding.json#pass === true` may you proceed to Step 4.5. (Skip only when neither `frd-requirements.json` nor `interview-requirements.json` exists — a pre-spine legacy project — and note the skipped gate in the BRD summary. **If you conducted the Step 2 interview in this session, the spine MUST exist** — a missing spine is a Step 2 execution bug, not a legacy project: reconstruct `interview-requirements.json` from the confirmed dimension summaries and re-run the gate. The skip applies only to a pre-existing BRD you did not author in this session.)

### Step 4.45 — Requirement-Taxonomy Floor [HARD BLOCK — all modes]

The grounding gate proves the BRD invented and dropped nothing **relative to its source**. It cannot prove the source asked the right questions: if the FRD never mentions retention, authorization, or failure modes, the BRD is silent on them too and every check above still passes. Comprehensiveness then reduces to "all sections are non-empty", which is a formatting property.

```bash
node .claude/scripts/brd-taxonomy-check.js \
  --requirements specs/brd/brd-requirements.json \
  --coverage specs/brd/taxonomy-coverage.json \
  --out specs/reviews/brd-taxonomy.json
```

Every one of the ten slots — `functional`, `data_lifecycle`, `integration`, `performance`, `security_authz`, `privacy_retention`, `observability`, `operability_failure`, `ux_accessibility`, `constraints` — needs either a requirement tagged with it, or an entry in `specs/brd/taxonomy-coverage.json` recording why it does not apply:

```json
[{ "slot": "privacy_retention", "na_reason": "the system stores no personal data; all records are anonymised aggregates" }]
```

**A justification must be a real reason.** `"N/A"`, `"none"`, `"TBD"`, and anything under 25 characters are rejected — the gate exists to force the question to be *asked*, and a box-tick means it was not. The reason lands in a committed artifact precisely so a reviewer can disagree with it.

Resolve a failure at the source: a genuinely uncovered slot usually means the interview skipped a dimension. Return to Step 2, ask, capture the answer as a `C-n` clarification, and add the requirement — do not paper over it with an excuse.

**Pre-existing BRD (not authored in this session).** A spine written before this gate existed carries no `taxonomy` field at all, so every requirement reports `UNTAGGED`. That is a migration state, not a quality signal. Tag the existing requirements first — reading each one and assigning its slots is a mechanical pass over an artifact you already have — then re-run. Do **not** record blanket `na_reason` entries to clear it; that converts a one-time migration into a permanently false clean bill of health. If you authored the spine in this session, `UNTAGGED` is a Step 4 execution bug: go back and tag them.
