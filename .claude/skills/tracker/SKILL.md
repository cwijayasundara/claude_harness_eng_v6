---
name: tracker
description: Optional external tracker orchestration overview for publishing Claude Harness story groups to Linear/Jira and running them with a Symphony-style orchestrator.
---

# Tracker Orchestration

This optional add-on mirrors approved Claude Harness story groups into an external tracker such as Linear or Jira, then lets a standalone orchestrator schedule unblocked groups and launch Claude Code in isolated workspaces.

The default scaffold remains local-only. Use tracker orchestration only when a project wants Linear/Jira to act as the visible work queue and human review surface.

## Operating Model

Claude Harness remains the source of truth for planning and verification:

- `/brd` captures product requirements.
- `/spec` writes `specs/stories/`, `specs/stories/dependency-graph.md`, and root `features.json`.
- `/design` writes implementation ownership and contracts under `specs/design/`.
- `/auto --group <group>` implements one dependency group with sprint contracts, agent teams, ratchet gates, evaluator review, and proof.

The tracker is a control plane:

- Linear/Jira issue status controls whether a group may run.
- Blocker/dependency links mirror the local dependency graph.
- Comments hold proof links, evaluator summaries, and PR links.
- Human review and final merge decisions stay outside the autonomous loop.

The orchestrator is external:

- It polls Linear/Jira or receives webhook events.
- It claims eligible unblocked group issues.
- It creates one workspace per group.
- It launches Claude Code non-interactively with `claude --print`.
- It reads `.claude/state/tracker-runs/<group>/result.json`.
- It updates the tracker and leaves completed work in `Human Review`.

## Recommended Granularity

Publish one tracker issue per dependency group, not one process per story. The harness already knows how to create agent teams inside `/auto`, including story-level ownership, micro-DAGs, shared interfaces, and evaluator gates.

`/tracker-publish --granularity story` is supported when a human explicitly wants per-story PRs (small diffs, faster human review, different harness command per story). Trade-off: you lose intra-group parallelism and pay per-issue orchestrator overhead. Default to group; use story when reviewers ask for it. See `.claude/skills/tracker-publish/SKILL.md` for the exact rules.

## State Model

Recommended tracker states:

- `Published` or `Todo`: created but not eligible.
- `Ready for Agent`: eligible if all blockers are terminal/pass.
- `In Progress`: claimed by the orchestrator.
- `Human Review`: branch/PR/proof is ready.
- `Blocked`: agent could not proceed.
- `Done`: terminal after human merge/review policy.
- `Canceled`, `Cancelled`, or `Duplicate`: terminal cleanup states.

## Safety Rules

- Do not dispatch work unless the tracker issue carries the configured ready label or state.
- Do not mark tracker issues `Done` automatically.
- Do not bypass local story readiness, design approval, sprint contracts, or evaluator gates.
- Keep tracker API keys in environment variables, not repo files.
- Use isolated workspaces for unattended runs.
- Prefer group-level execution: external orchestrator schedules groups; `/auto` creates internal agent teams.

## Related Files

- `.claude/skills/tracker-publish/SKILL.md`
- `.claude/templates/tracker-config.template.json`
- `.claude/templates/tracker-workflow.template.md`
- `.claude/state/tracker-map.json`
- `.claude/state/tracker-runs/`
