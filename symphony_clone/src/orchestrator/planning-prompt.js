'use strict';

// The architect (planning) prompt: a PRD issue → a groomed backlog of per-cluster
// group issues, published to the tracker. Plan only — no application code. Kept as
// a top-level template constant (interpolated by a tiny builder) so the long prompt
// body is not a function subject to the 30-line gate.

const PLANNING_PROMPT_TEMPLATE = `You are running an unattended Claude Harness PLANNING run for a PRD. Produce the plan and publish the work clusters — do not generate application code.

Tracker key: {{key}}
Tracker URL: {{url}}

PRD (the product requirements to plan from):
---
{{prd}}
---

Required workflow:
1. Work only in the current repository workspace.
2. Treat the PRD above as the immutable grounding baseline. If it names a file already in the repo, read that file as the PRD instead. Write the PRD to prd.md if it is not already a file.
3. Run the planning pipeline (use the skill files directly if slash commands are unavailable non-interactively): /brd --prd prd.md, then /spec, then /design, then /test --plan-only. This is plan-only — do not generate application code.
4. Publish the dependency groups as tracker work items with /tracker-publish (or .claude/skills/tracker-publish/SKILL.md). These become the per-cluster group issues the orchestrator executes next.
5. Commit the planning artifacts (specs/) to the current branch.
6. Write .claude/state/tracker-runs/{{key}}/result.json with this shape:

{
  "status": "planned",
  "summary": "short planning summary",
  "groups_published": ["A", "B"],
  "branch": "current branch name",
  "commit": "current commit sha"
}

Use "status": "blocked" with a concise "blocker" field if the PRD is missing/unusable or planning cannot complete. Do not mark tracker work Done; the orchestrator moves tracker state after reading the result file.`;

function buildPlanningPrompt(issue) {
  return PLANNING_PROMPT_TEMPLATE
    .split('{{key}}').join(issue.key)
    .split('{{url}}').join(issue.url || 'unknown')
    .split('{{prd}}').join(issue.description || '(no description provided)');
}

module.exports = { buildPlanningPrompt };
