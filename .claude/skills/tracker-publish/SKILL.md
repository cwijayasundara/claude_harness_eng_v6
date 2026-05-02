---
name: tracker-publish
description: Publish approved Claude Harness dependency groups to Linear/Jira-compatible tracker tasks and write the local tracker mapping contract.
argument-hint: "[--provider linear|jira] [--dry-run]"
context: fork
---

# Tracker Publish

Publish approved story groups to an external tracker. This skill prepares the handoff contract used by the standalone orchestrator; it does not start the orchestrator.

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

## Output Contract

Write or update:

```text
.claude/state/tracker-map.json
.claude/state/tracker-runs/
```

`tracker-map.json` shape:

```json
{
  "provider": "linear",
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

## Publishing Rules

1. Read `dependency-graph.md` and create one tracker issue per dependency group.
2. Include every ready story in the group issue body.
3. Include acceptance criteria, feature IDs, owned files from `component-map.md`, and the harness command:

   ```text
   /auto --group A
   ```

4. Mirror group dependencies as tracker blocker relationships when the provider supports them.
5. Apply configured labels such as `harness-group`, `agent-ready`, `group-A`.
6. Do not publish stories marked `needs_breakdown`.
7. Do not dispatch any run from this skill.

## Group Issue Body Template

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

## Human Review Gate

After publishing, present:

- groups created or updated
- tracker issue URLs
- dependency/blocker mapping
- next command for the standalone orchestrator

Ask the human to confirm the tracker workflow before unattended orchestration begins.
