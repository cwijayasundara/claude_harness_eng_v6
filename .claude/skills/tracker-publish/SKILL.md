---
name: tracker-publish
description: Publish approved Claude Harness dependency groups to Linear/Jira-compatible tracker tasks and write the local tracker mapping contract.
argument-hint: "[--provider linear|jira] [--granularity group|story] [--dry-run]"
context: fork
---

# Tracker Publish

Publish approved story groups to an external tracker. This skill prepares the handoff contract used by the standalone orchestrator; it does not start the orchestrator.

## Operating Model (overview)

This optional add-on mirrors approved Claude Harness story groups into an external tracker (Linear/Jira), then lets a standalone orchestrator schedule unblocked groups and launch Claude Code in isolated workspaces. The default scaffold remains local-only — use tracker orchestration only when a project wants Linear/Jira to act as the visible work queue and human review surface.

Claude Harness stays the source of truth for planning and verification (`/brd` → `/spec` → `/design` → `/auto --group <id>`). The tracker is only a control plane: issue status gates whether a group may run, blocker links mirror the local dependency graph, and comments hold proof/PR links. Human review and final merge stay outside the autonomous loop. The orchestrator is external — it polls the tracker, claims eligible unblocked group issues, creates one workspace per group, launches `claude --print`, reads `.claude/state/tracker-runs/<group>/result.json`, updates the tracker, and leaves completed work in `Human Review`.

**Recommended tracker states:** `Published`/`Todo` (created, not eligible) → `Ready for Agent` (eligible when blockers are terminal/pass) → `In Progress` (claimed) → `Human Review` (branch/PR/proof ready) → `Done` (after human merge). Plus `Blocked`, `Canceled`/`Cancelled`/`Duplicate` as terminal states.

**Safety rules:**
- Do not dispatch work unless the issue carries the configured ready label/state.
- Never mark tracker issues `Done` automatically.
- Do not bypass local story readiness, design approval, sprint contracts, or evaluator gates.
- Keep tracker API keys in environment variables, not repo files.
- Use isolated workspaces for unattended runs; prefer group-level execution (the external orchestrator schedules groups; `/auto` creates the internal agent teams).

Related files: `.claude/templates/tracker-config.template.json`, `.claude/templates/tracker-workflow.template.md`, `.claude/state/tracker-map.json`, `.claude/state/tracker-runs/`, and the `symphony_clone/` orchestrator.

## Granularity

The `--granularity` flag chooses what becomes a tracker issue:

| Mode | Issue maps to | When to use |
|------|---------------|-------------|
| `group` (default) | One tracker issue per dependency group from `dependency-graph.md`. The group issue body lists every ready story in that group, and the harness command is `/auto --group <id>` (or whatever `HARNESS_COMMAND_TEMPLATE` resolves to). | Default for `/build` projects and any work where a group is reviewed as a single PR. The agent team inside `/auto` handles per-story decomposition. |
| `story` | One tracker issue per ready story. Each story issue carries `Story: E1-S1` plus its group ID. Group-level blockers are mirrored as `blocked_by` links between story issues. The orchestrator runs each story individually via the per-issue mode override (default `mode-vibe` for trivial stories; the publisher writes `mode-lite` or `mode-vibe` based on story metadata). | When the human reviewer wants one PR per story (smaller diffs, faster review cycle), when stories are independently shippable, or when you want different Claude commands per story (for example, `mode-vibe` for a docs story, `/auto` for an API story). |
| `single` | One tracker issue for a single brownfield story (no epic/dependency-graph prerequisites). Built by `scripts/single-story-map.js` into the same map shape `publish-to-linear.js` consumes, then published with the unchanged publisher. | Used by `/feature`'s single-story lane, where the change is one bounded story and the full `/build` artifact set (epics, dependency-graph, component-map, features.json) does not exist. |

Picking the right granularity matters more than people think:

- `group` granularity is cheaper to orchestrate (fewer issues, fewer PRs, fewer Linear comments) and lets `/auto` exploit intra-group parallelism via agent teams. It produces large PRs that need careful human review.
- `story` granularity gives you small PRs but loses the intra-group parallelism gain — each story runs as its own orchestrator workspace and the orchestrator pays per-issue overhead (clone, branch, tracker round-trips). On a Max-licence-only setup, this can be slower wall-clock for the same total work.

If you do not specify `--granularity`, default to `group`. Switch to `story` only if the human explicitly asks for per-story PRs.

## Prerequisites

The following files must exist and be approved by the human:

- `specs/stories/epics.md`
- `specs/stories/dependency-graph.md`
- `specs/stories/E*-S*.md`
- `features.json`
- `specs/design/component-map.md`
- `specs/design/api-contracts.md`
- `.claude/tracker-config.json`

If design artifacts are missing, stop and ask the human to run `/design` first. The orchestrator needs `component-map.md` so `/auto` can coordinate agent teams without file ownership conflicts.

- **`--granularity single` exception:** the single-story lane needs only `.claude/tracker-config.json` and the story's acceptance criteria — none of `epics.md`, `dependency-graph.md`, `component-map.md`, or `features.json` is required. `/feature` builds the one-entry map via `scripts/single-story-map.js`.

## Output Contract

Write or update:

```text
.claude/state/tracker-map.json
.claude/state/tracker-runs/
```

`tracker-map.json` shape (group granularity):

```json
{
  "provider": "linear",
  "granularity": "group",
  "published_at": "2026-05-01T00:00:00.000Z",
  "groups": {
    "A": {
      "tracker_key": "ENG-101",
      "tracker_id": "tracker-internal-id",
      "url": "https://linear.app/example/issue/ENG-101",
      "stories": ["E1-S1", "E1-S2"],
      "depends_on_groups": []
    }
  },
  "stories": {
    "E1-S1": {
      "group": "A",
      "tracker_key": "ENG-101"
    }
  }
}
```

`tracker-map.json` shape (story granularity):

```json
{
  "provider": "linear",
  "granularity": "story",
  "published_at": "2026-05-01T00:00:00.000Z",
  "groups": {
    "A": {
      "stories": ["E1-S1", "E1-S2"],
      "depends_on_groups": []
    }
  },
  "stories": {
    "E1-S1": {
      "group": "A",
      "tracker_key": "ENG-101",
      "tracker_id": "tracker-internal-id-1",
      "url": "https://linear.app/example/issue/ENG-101",
      "harness_command": "/build --lite --group A",
      "mode_label": "mode-lite",
      "blocked_by_stories": []
    },
    "E1-S2": {
      "group": "A",
      "tracker_key": "ENG-102",
      "tracker_id": "tracker-internal-id-2",
      "url": "https://linear.app/example/issue/ENG-102",
      "harness_command": "/build --lite --group A",
      "mode_label": "mode-lite",
      "blocked_by_stories": ["E1-S1"]
    }
  }
}
```

Under story granularity, the `groups` section is informational — every actual tracker issue lives under `stories`. The orchestrator looks up the story by tracker key and runs the harness command resolved for that story.

## Publishing Rules

### Common rules (both granularities)

1. Do not publish stories marked `needs_breakdown`.
2. Do not dispatch any run from this skill.
3. Apply configured labels such as `harness-group`, `agent-ready`.
4. Always include the per-issue `mode-*` label when a non-default harness command is intended (for example `mode-lite` for a `/build --lite`-eligible scope).
5. Keep `.claude/state/tracker-map.json` authoritative for the local repo. If you re-publish, update entries in place rather than creating duplicates.

### Group granularity (`--granularity group`, default)

1. Read `dependency-graph.md` and create one tracker issue per dependency group.
2. Include every ready story in the group issue body.
3. Include acceptance criteria, feature IDs, owned files from `component-map.md`, and the harness command:

   ```text
   /auto --group A
   ```

4. Mirror group dependencies as tracker blocker relationships when the provider supports them.
5. Apply `group-A` (or equivalent group ID) label.

### Story granularity (`--granularity story`)

1. Read every ready story file under `specs/stories/` and create one tracker issue per story (skip `needs_breakdown` and stories not in any group).
2. Include the story's acceptance criteria, owned files from `component-map.md`, and feature IDs from `features.json` filtered to that story.
3. The harness command for each story is derived as follows:
   - If the story file declares a `Mode:` field (e.g. `Mode: lite`), use that.
   - Otherwise, if the entire group fits `/build --lite` eligibility (≤5 stories, single group, no DB/auth — see `.claude/skills/build/references/lite-lane.md`), use `/build --lite --group <group-id>` for every story in that group.
   - Otherwise default to `/auto --group <group-id>` and let `/auto` recognise the single-story scope.
4. Apply the matching `mode-*` label (e.g. `mode-lite`) when the harness command is not the default `/auto`.
5. Mirror in-group story dependencies (`Depends On:` in story files) as tracker blocker relationships between story issues. Cross-group dependencies are inherited from the group's blocker links.
6. Apply `story-E1-S1` (or the story ID as a slug) label so humans can filter the tracker view by story.

## Group Issue Body Template (`--granularity group`)

```markdown
## Harness Group

- Group: A
- Harness command: /auto --group A
- Stories: E1-S1, E1-S2
- Depends on groups: none

## Acceptance Criteria

### E1-S1 — Story title
- Criterion 1
- Criterion 2

## Feature IDs

- F001
- F002

## Expected Proof

- Branch or PR URL
- Unit/lint/typecheck result
- Evaluator report
- Security review
- Updated `features.json` pass/fail state
```

## Story Issue Body Template (`--granularity story`)

```markdown
## Harness Story

- Story: E1-S1
- Group: A
- Harness command: /build --lite --group A
- Depends on stories: none

## Acceptance Criteria

- Criterion 1
- Criterion 2
- Criterion 3

## Owned Files (from component-map.md)

- src/research/duckduckgo.py
- tests/test_duckduckgo.py

## Feature IDs

- F001

## Expected Proof

- Branch or PR URL
- Unit/lint/typecheck result for the owned files
- Updated `features.json` entry for this story
```

## Remote Publish — How Tracker Issues Actually Get Created

`/tracker-publish` writes the local handoff contract (`.claude/state/tracker-map.json` + `.claude/state/tracker-runs/group-*.md`). It does **not** call Linear directly from Claude's tool surface. The actual remote create happens via one of three transports, picked in this order:

1. **Linear MCP server** — if a Linear MCP is configured in the session, prefer the MCP tool (`linear:issue:create` or equivalent). MCP gives you OAuth and avoids storing the API key.
2. **Bundled publisher script** — `node .claude/skills/tracker-publish/scripts/publish-to-linear.js`. Self-contained Node script that:
   - auto-loads `<project-root>/.env` (without overriding existing shell env)
   - reads `tracker-map.json` + `tracker-config.json`
   - looks up the Linear project by slug, picks the matching team (by `team_key`)
   - resolves the configured `ready_state` to a state ID
   - creates each missing label, then `issueCreate`s one issue per pending group
   - writes the real `tracker_key` / `tracker_id` / `url` back into `tracker-map.json`
   - idempotent: groups whose `tracker_key` already looks real are skipped
3. **Manual `linear-cli`** — if a user has the third-party CLI installed and wants to drive it themselves.

### Invoking the bundled script

```bash
# from the project root
node .claude/skills/tracker-publish/scripts/publish-to-linear.js

# dry run (no remote calls, no file writes)
node .claude/skills/tracker-publish/scripts/publish-to-linear.js --dry-run

# override env file location (e.g. when .env lives elsewhere)
node .claude/skills/tracker-publish/scripts/publish-to-linear.js --env-file /path/to/.env
```

Prerequisites:
- `LINEAR_API_KEY` in `<project-root>/.env` (the file is git-ignored by the scaffold) or in the shell.
- `tracker.project_slug` in `.claude/tracker-config.json` set to a real Linear project slug — the placeholder `replace-with-linear-project-slug` is rejected.
- `tracker.team_key` (e.g. `ENG`) matching the team attached to that project. If absent, the script falls back to the first team on the project and warns.
- Workflow state names in `config_snapshot` (`ready_state`, `running_state`, etc.) must exist in the team — the script will print the available states if a name is wrong.

### What the skill should do when MCP isn't available

After writing the local artifacts, check for Linear MCP. If none:
1. Detect whether `LINEAR_API_KEY` is reachable (project `.env` or shell).
2. If yes, surface the exact command to run (the `node …/publish-to-linear.js` line above) and wait for the user to invoke it.
3. If no, surface a "missing prerequisites" block explaining how to set the key and what to do next.

Do **not** assume the user has shelled in the API key — many users set it only in `.env` and never `export` it. Always prefer the script's built-in `.env` loader over a shell-export requirement.

## Human Review Gate

After publishing, present:

- groups created or updated
- tracker issue URLs (real ones if the bundled script ran, otherwise `pending-remote-publish` placeholders with the follow-up command)
- dependency/blocker mapping
- next command for the standalone orchestrator

Ask the human to confirm the tracker workflow before unattended orchestration begins.
