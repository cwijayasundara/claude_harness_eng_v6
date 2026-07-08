---
name: feature
description: Brownfield change route — take an existing-code feature request from intent to a reviewed PR, scaling from a single /change to an epic via /spec→/design→/auto. Linear-tracked, backed by a committed DeepWiki.
argument-hint: "[\"<feature request>\"]"
---

# Feature Skill — Brownfield Change Route

`/feature` is a **thin conductor** for working with existing code: adding a new
feature or altering an existing one. It sequences existing skills behind three
human gates and keeps a committed DeepWiki current. It does **not** reimplement
`/brownfield`, `/code-map`, `/spec`, `/design`, `tracker-publish`, `/change`,
`/auto`, or `/gate` — it delegates to them.

For greenfield builds use `/build`. For a discovery-only pass use `/brownfield`.

**Runs in the main session — do not add `context: fork`.** This route owns the
three interactive human gates and the git workflow (branch → commit → push →
open PR). A forked skill cannot pause for `AskUserQuestion` gates and returns a
single result without committing or pushing, so it leaves the change uncommitted
on the current branch. The conductor must run in the main conversation loop. The
delegated sub-skills (`/brownfield`, `/auto`, etc.) fork their own work as they
already do; the conductor itself stays in the main session.

## Usage

```text
/feature "add confidence scores to the extraction endpoint"              # 3 gates
/feature "split billing into usage-based and seat-based plans"           # 3 gates (likely an epic)
/feature "add a /health endpoint" --autonomous                           # 1 gate (seam-cited plan)
/feature "add a /health endpoint" --auto                                 # 0 gates: request -> PR(s)
/feature "add a /health endpoint" --auto --respond                       # + bounded post-PR response pass
```

Lane resolution is deterministic — `node .claude/scripts/feature-lane.js "<args>"`
returns `{ valid, lane, humanGates, request, auto, autonomous }` (`gated`=3,
`autonomous`=1, `auto`=0; `--auto` implies the autonomous tail). All lanes stop
at the open PR; merge stays human.

**`--respond[=minutes]`.** Opt-in (default **off**): after the PR(s) open, invoke
`/pr-respond <pr#> --watch` on each one so red CI or early review comments get
one bounded, budget-metered response pass before handoff (`=minutes` sets the
watch window, default 30). Merge remains human-owned regardless — `/pr-respond`
never merges or enables auto-merge.

## The spine

The same backbone runs at every scale; only the engine in steps 5–8 differs.

1. **Discover** — ensure the DeepWiki is fresh and committed (see *DeepWiki lifecycle*).
2. **Decompose** — turn the request into a story, or (epic scope) into epics +
   stories + dependency-graph. Cite the DeepWiki. → **GATE 1**.
3. **Plan / design for adherence** — choose the seam/layer each change extends. → **GATE 2**.
4. **Publish to Linear** — single issue, or one issue per dependency group.
5. **Implement** test-first, in place.
6–7. **Unit + integration tests**, full suite green.
8. **Verify** against acceptance criteria + adaptive review.
9. **Open PR(s)** linked to the Linear issue(s). If `--respond` was passed
   (default off), invoke `/pr-respond <pr#> --watch` on each PR just opened —
   one bounded response pass; merge remains human-owned. → **GATE 3**.

## Lanes (autonomous surface)

`/feature` mirrors `/build`'s lane model. Resolve the lane first with
`node .claude/scripts/feature-lane.js "<args>"`.

- **`gated` (default, 3 gates):** the interactive route below — GATE 1
  decomposition, GATE 2 design-adherence, GATE 3 PR review.
- **`--autonomous` (1 gate):** one consolidated **seam-cited plan** gate (folds
  decomposition + design-adherence + the seam-confidence band), then autonomous
  through to the PR. Present at the gate: the decomposition (story or
  epics+stories+dependency-graph), the target seam + seam-confidence band, and
  the design-adherence plan citing the DeepWiki.
- **`--auto` (0 gates):** request → PR(s) with no human stops; machine
  enforcement replaces the human GATE 2.

### Autonomous adherence enforcement (replaces the human GATE 2)

Two layers, run in the `--autonomous` and `--auto` lanes:

1. **Deterministic seam-confidence gate.** After the DeepWiki is fresh, run
   `seam-finder --goal "<request>"`, then
   `node .claude/scripts/seam-confidence.js --graph specs/brownfield/code-graph.json --goal "<request>"`.
   - `band: low` (no clean seam, best score < 0.5, or `recommended_action: avoid`):
     in **`--auto`**, write `specs/brownfield/adherence-report.md` (the goal, the
     best candidate seams + scores, why it's low) and **STOP & surface** — never
     edit a high-risk seam blind. In **`--autonomous`**, surface the low band at
     the single plan gate instead of stopping.
   - `band: high`: proceed, carrying `target_seam` into the plan.
2. **Judged adherence critic.** The **evaluator**'s brownfield-adherence rubric
   (artifact mode) checks the *plan* cites the DeepWiki and extends the seam — the
   machine GATE 2; the **code-reviewer**'s design-adherence lens checks the *diff*
   actually extended it before the PR. A FAIL self-heals up to the loop's attempt
   cap, else STOP & surface.
3. **Design-delta rubric.** When the lane runs `/design --delta` (either
   routing above), its own Delta Mode Step D6 (the `design-delta` evaluator
   rubric) is the machine check for that amendment — in `--autonomous` and
   `--auto`, this still runs and still blocks; only the human stop at Step D7
   is skipped or folded, matching this skill's existing gate-collapse model.

### Autonomous scope routing

Classify scope automatically (reuse the single-vs-epic size thresholds + the
`specs/brownfield/risk-map.md`): single bounded story → `/change`; epic/cluster →
`/spec` → `/design --delta` → `/auto`. When the size is ambiguous, take the larger
(`/auto`) lane — it carries more verification. The human no longer confirms this
classification in autonomous lanes.

Every lane stops at the open PR(s); the human owns merge.

### Sub-skill gate collapse in autonomous lanes

In `--autonomous` and `--auto`, `/feature` is the **conductor** and the
delegated sub-skills (`/brownfield`, `/brd` if used, `/spec`, `/design`,
`/change`) run as **artifact-producers**: their own interactive approval prompts
— e.g. `/spec`'s "approve the decomposition", `/design`'s "approve the
architecture" — are **collapsed into this lane's gate model, not honored as
separate stops**. In `--autonomous` they fold into the single consolidated plan
gate; in `--auto` they are skipped entirely. The conductor drives sub-skills
through to completion without pausing at their internal checkpoints.

This mirrors `/build`'s approval model (`humanGates: 0` ⇒ no sub-phase stops)
— the same mechanism greenfield uses: the conductor instruction supersedes the
sub-skill's own interactive prompt.

**Machine gates are never collapsed.** The deterministic seam-confidence gate,
the evaluator brownfield-adherence rubric (artifact mode), the code-reviewer
design-adherence lens, `/auto`'s ratchet, and `/gate` all run regardless of
lane — only the human approval prompts inside delegated sub-skills are
suppressed.

## Scope classification (two routing decisions)

After GATE 1 you hold the decomposition. First classify size, reusing
`/change` Step 0's thresholds and `specs/brownfield/risk-map.md`:

- **Single-story lane** — 1 bounded story, ≤ 3 files, no auth/authz/payments/
  persistence/public-API-contract change → delegate to **`/change`**.
- **Epic / cluster lane** — multiple stories, an epic, or any dependency graph →
  run **`/spec` → `/design --delta`** (not full `/design` — see below) →
  **`tracker-publish --granularity group`** → **`/auto`** for parallel
  agent-team execution.

State the chosen lane in one line before proceeding.

### Impact classification (single-story lane only)

A bounded single story can still be architecturally invisible or
design-touching. Run:

```bash
node .claude/scripts/impact-classifier.js --story <story-file> --graph specs/brownfield/code-graph.json
```

- **`invisible`** — delegate to `/change` exactly as today. No design
  amendment, no GATE 2.
- **`design-touching`** — before `/change` implements it, run
  `/design --delta --story <story-file> --amendment-id story-<id>` (see
  `design/SKILL.md`'s Delta Mode) to produce
  `specs/design/amendments/story-<id>.md` and amend the living design. GATE 2
  (Delta Mode's Step D7) runs here — approve the amendment before `/change`
  implements the story.

### Epic / cluster lane uses `/design --delta`, not full `/design`

When this project already has an approved `specs/design/` baseline (the
normal case for `/feature`, since it targets existing code), the epic/cluster
lane's `/design` call **must** be `/design --delta --stories
specs/stories/<epic-dir>/ --amendment-id <epic-id>` — never the full
regenerate-from-scratch mode. This closes the gap where the epic lane
previously regenerated `specs/design/` from the epic's stories alone,
discarding everything the rest of the system's design already established.

## DeepWiki lifecycle — build once, maintain incrementally

The wiki at `specs/brownfield/wiki/` is **committed** repo docs, maintained as a
living artifact, never fully rebuilt per request.

1. **First run only — full build.** If no committed wiki exists, run full
   `/brownfield` to produce `code-graph.json` + the wiki; `git add` and commit it.
2. **Subsequent requests — freshness check, not rebuild.** If the wiki carries a
   `> STALE since…` banner (stamped by the `graph-refresh` hook on graph drift),
   incrementally patch only the touched files with `/code-map`'s `--files` mode,
   then re-render. If current, just read it.
3. **During implementation — self-heals.** The `graph-refresh` Stop/SubagentStop
   hook patches `code-graph.json` (`--files`) and re-renders the wiki per turn.
4. **At PR time — ships with the change.** Re-render from the final graph and
   commit the updated wiki **in the same PR** as the code.
5. **Fallback.** If incremental graph warnings spike (e.g. after a massive
   refactor), fall back to a full `/brownfield` rebuild rather than trust a
   degraded patch.

**GATE 2 design-adherence (enforced, not advisory):** the plan/design must cite
specific DeepWiki pages/symbols and state, for each edit, which existing
module/seam/layer it extends. Reject any plan that invents a parallel structure
instead of extending an existing seam. GATE 2 reads the **committed (pre-change)**
wiki; the post-change re-render is part of the implementation output.

## Linear publishing

- **Single-story lane:** build a one-issue map with
  `node .claude/skills/tracker-publish/scripts/single-story-map.js`'s
  `buildSingleStoryMap(...)` (or `tracker-publish --granularity single`), write
  the AC to `.claude/state/tracker-runs/group-<storyId>.md` and the map to
  `.claude/state/tracker-map.json`, then publish with the unchanged
  `node .claude/skills/tracker-publish/scripts/publish-to-linear.js`.
- **Epic / cluster lane:** run `tracker-publish --granularity group` as-is.
- Transport order is the existing one: Linear MCP → `publish-to-linear.js` →
  manual CLI.

## PR ↔ Linear linkage

- Every opened PR body includes the Linear issue identifier/URL.
- After the PR is open, move the Linear issue to **Human Review** (via MCP if
  available, else note it for the human). **Never auto-mark an issue `Done`** —
  merge stays a human gate, per `tracker-publish` safety rules.

## The three gates

- **GATE 1 — approve decomposition.** Present the story (or epics + stories +
  dependency-graph) with acceptance criteria before publishing to Linear.
- **GATE 2 — approve plan/design.** Single-story design-touching lane: the
  `/design --delta` amendment (Delta Mode Step D7). Cluster lane: the same
  `/design --delta` amendment, scoped to the epic's stories. Enforce
  design-adherence here — both share the design-delta rubric and grounding
  gate.
- **GATE 3 — review PR(s).** Stop at the opened PR(s); the human reviews and merges.

## Token discipline

`/feature` should not spawn the full reviewer set by default. Build one compact
`specs/reviews/review-context-pack.md` per change and pass that pack, the final
diff, test output, and directly touched files to reviewers. The default review is
clean-code/quality only; add `security-reviewer` only when auth/authz, secrets,
user input, upload/download, network fetch/redirect/proxy, payments/billing,
persistence/schema/migration, API route/controller/middleware, or configured
security patterns are touched. Use `/gate` for the final PR-quality pass.

## Gotchas

- **Do not reimplement delegated skills.** If `/change` or `/auto` behavior is
  wrong, fix it there, not here.
- **Do not skip the wiki commit.** The PR must contain the updated wiki alongside
  the code — a stale committed wiki is worse than none.
- **Do not auto-merge or auto-close Linear issues.** Merge is a human gate.
- **Do not run the full epic path for a one-line change.** Classify scope first;
  the single-story lane exists to avoid `/spec`/`/design` overhead.
