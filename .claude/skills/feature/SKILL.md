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
/feature "add confidence scores to the extraction endpoint"
/feature "split billing into usage-based and seat-based plans"   # likely an epic
```

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
9. **Open PR(s)** linked to the Linear issue(s). → **GATE 3**.

## Scope classification (the one routing decision)

After GATE 1 you hold the decomposition. Classify it, reusing `/change`
Step 0's thresholds and `specs/brownfield/risk-map.md`:

- **Single-story lane** — 1 bounded story, ≤ 3 files, no auth/authz/payments/
  persistence/public-API-contract change → delegate to **`/change`**.
- **Epic / cluster lane** — multiple stories, an epic, or any dependency graph →
  run **`/spec` → `/design` → `tracker-publish --granularity group` → `/auto`**
  for parallel agent-team execution.

State the chosen lane in one line before proceeding.

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
- **GATE 2 — approve plan/design.** Present the DeepWiki-cited plan (single lane)
  or `/design` output (cluster lane). Enforce design-adherence here.
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
