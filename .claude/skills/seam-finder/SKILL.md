---
name: seam-finder
description: Identify the safest cut-points in an existing codebase for a planned change. Reads code-graph.json + a goal, ranks candidate seams by observability + funnel + read/write asymmetry, and outputs a prioritized list with evidence.
argument-hint: "<goal-description>"
context: fork
---

# Seam Finder — Where to Cut Safely

`/seam-finder` answers the question *"given my goal, which existing module is the smallest, safest place to extend or split?"* It applies the Fowler / Thoughtworks **Uncovering Mainframe Seams** scoring methodology to a deterministic dependency graph.

A "seam" is a junction point where program flow can be diverted without rewriting upstream or downstream code. Good seams:

1. Sit at an **observable** boundary (HTTP route, queue, table, public class)
2. Are a **funnel** — many modules converge on them
3. Have **read/write asymmetry** — pure readers and pure writers are safer than mixed-use nodes

This skill is the bridge between brownfield discovery and `/improve`, `/refactor`, `/spec`. Run it before deciding *where* in the existing code to land a change.

---

## Usage

```text
/seam-finder "add team invites to user onboarding"
/seam-finder "split the billing module into a separate service"
/seam-finder "introduce idempotency to webhook delivery"
```

Always pass a concrete goal. Without one, the skill ranks structural seams generically — useful for a refactor scan but less precise.

---

## Prerequisites

`specs/brownfield/code-graph.json` must exist. If it does not:

1. Suggest running `/code-map` first.
2. Stop. Do not try to score seams from grep results.

If `specs/brownfield/coupling-report.md` exists, prefer it for hub data; otherwise compute on the fly from `code-graph.json`.

---

## Outputs

| File | Purpose |
|---|---|
| `specs/brownfield/seams-<short-goal-slug>.md` | Ranked seam candidates with scores, evidence, and recommended action |

Each candidate includes:

- Module / file path
- `observable_score` (0–1) — how externally visible the boundary is
- `funnel_score` (0–1) — fan-in + fan-out, normalized
- `asymmetry_score` (0–1) — read vs write imbalance
- `total_score` (0–1) — weighted combination (defaults: 0.4 / 0.4 / 0.2)
- Evidence — which files import or call it, with file:line refs
- Recommended action — `extend`, `wrap`, `split`, `introduce-adapter`, `avoid`

---

## Steps

### Step 1 — Load Graph

```bash
test -f specs/brownfield/code-graph.json || { echo "Run /code-map first"; exit 1; }
```

### Step 2 — Score Seams

```bash
node .claude/skills/seam-finder/scripts/score_seams.js \
  --graph specs/brownfield/code-graph.json \
  --goal "$GOAL" \
  --out specs/brownfield/seams-${SLUG}.md
```

By default the scorer **excludes test and fixture paths** (`tests/`, `__tests__/`, `spec/`, `*_test.*`, `*.spec.*`, `fixtures/`, `mocks/`, `examples/`). Pass `--include-tests` or `--include-fixtures` if you genuinely want those ranked (e.g. you're refactoring the test suite itself).

The scorer:

1. Computes per-node fan-in / fan-out from the graph.
2. Tags nodes with an **observable kind** by file path heuristics:
   - `routes/`, `controllers/`, `api/`, `handlers/`, `views/` → HTTP boundary (1.0)
   - `queue/`, `events/`, `consumers/`, `producers/`, `webhooks/` → message boundary (0.9)
   - `db/`, `repository/`, `models/`, `migrations/` → data boundary (0.8)
   - Public classes/exports in any module → module boundary (0.5)
   - Private helpers, deeply nested utils → internal (0.1)
3. Scores read/write asymmetry from `imports` direction and (if present) `reads`/`writes` edges.
4. Filters by goal keywords: nodes whose path or symbols match goal terms get a **goal-relevance bump** (multiplier 1.5).
5. Ranks descending by `total_score`.

### Step 3 — Recommend Action

For each top-N candidate, the skill labels a recommended action based on score profile:

| Score Profile | Action |
|---|---|
| High observable + high funnel | `extend` — add behaviour at the existing seam |
| High observable + low funnel | `wrap` — adapter at the boundary |
| Low observable + high funnel | `introduce-adapter` — extract a public seam first, then change |
| High asymmetry (pure reader) | `split` — replicate writes via existing channel, rebuild reads |
| All scores low | `avoid` — not a seam; keep looking |

### Step 4 — Verify Goal Fit

After the script writes the candidate list, re-read the top 3 candidates' source files and confirm they actually cover the goal's domain. The score is structural; the verification is semantic.

If none of the top 3 candidates fit the goal:

- Re-run with a refined goal phrase.
- Or, if the goal genuinely has no good seam, recommend `/spec` to plan a new module rather than forcing a fit.

### Step 5 — Hand Off

Reference the chosen seam in the next step:

- `/improve "<goal>" — extend seam: <path>`
- `/refactor <path>` (when the seam is the refactor target)
- `/spec` (when no seam fits and a new module is the right call)

---

## Goal-Slug Convention

The output filename uses a short, lowercase, dash-separated slug derived from the first 3–5 meaningful words of the goal.

| Goal | Slug | File |
|---|---|---|
| "add team invites to user onboarding" | `team-invites` | `seams-team-invites.md` |
| "split billing into a separate service" | `split-billing` | `seams-split-billing.md` |

---

## Gotchas

- **No graph, no seams.** Do not attempt to score from filenames alone. Run `/code-map` first.
- **Observable score is heuristic.** A `routes/` directory might be private; a `lib/` directory might be the public API. Always re-read the top candidates to confirm.
- **Goal relevance is keyword-based.** Synonyms may miss the bump. If a candidate scores high but the goal mentions different terms, override manually.
- **Hubs are not always seams.** A god-module with fan-in 50 may be a refactor target, not a place to extend. The recommended action of `introduce-adapter` exists for this case — extract a public seam first.
- **Cycles muddy the waters.** A module inside a cycle has unreliable fan-in/fan-out. The script flags cycle members so the recommendation does not silently land in tangled territory.
- **Do not auto-execute the recommendation.** Seam-finder produces a *plan input*, not a refactor. Always confirm with the user before acting on `extend` / `split`.
