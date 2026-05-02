---
agent:
  runner: claude_code
  max_turns: 3
workspace:
  root: /workspaces
claude_code:
  command: claude --print --permission-mode bypassPermissions
---

You are running an unattended Claude Harness execution for tracker group `{{ group.id }}`.

## Inputs

- Tracker key: `{{ group.tracker_key }}`
- Group: `{{ group.id }}`
- Stories: `{{ group.stories }}`
- Harness command: `/auto --group {{ group.id }}`

## Required Workflow

1. Work only in the current repository workspace.
2. Read `.claude/skills/auto/SKILL.md`, `.claude/program.md`, `.claude/state/learned-rules.md`, `features.json`, `specs/stories/dependency-graph.md`, and every story file in this group.
3. Execute the Auto Skill for this group. If slash commands are unavailable in non-interactive mode, follow the skill file directly.
4. Do not implement stories outside the selected group.
5. Run the required verification gates for the selected mode.
6. Commit the completed group changes to the current branch.
7. Write `.claude/state/tracker-runs/{{ group.id }}/result.json` with:

```json
{
  "group": "{{ group.id }}",
  "status": "human_review",
  "summary": "short implementation summary",
  "branch": "current branch name",
  "commit": "current commit sha",
  "tests": [],
  "reports": [
    "specs/reviews/evaluator-report.md",
    "specs/reviews/security-review.md"
  ],
  "features_updated": []
}
```

Use `"status": "blocked"` if missing requirements, missing secrets, failing prerequisites, or repeated verification failures prevent completion. Include a concise `"blocker"` field.

## Handoff Rule

Do not mark tracker work `Done`. The orchestrator will move the tracker item to `Human Review` after reading the result file and opening or updating a PR.
