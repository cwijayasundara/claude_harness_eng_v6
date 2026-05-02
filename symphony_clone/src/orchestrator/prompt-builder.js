'use strict';

function buildHarnessPrompt(issue, group) {
  return `You are running an unattended Claude Harness execution for tracker group ${group.id}.

Tracker key: ${issue.key}
Tracker URL: ${issue.url || 'unknown'}
Group: ${group.id}
Stories: ${group.stories.join(', ')}
Harness command: /auto --group ${group.id}

Required workflow:
1. Work only in the current repository workspace.
2. Read .claude/skills/auto/SKILL.md, .claude/program.md, .claude/state/learned-rules.md, features.json, specs/stories/dependency-graph.md, and every story file in this group.
3. Execute the Auto Skill for group ${group.id}. If slash commands are unavailable in non-interactive mode, follow the skill file directly.
4. Do not implement stories outside group ${group.id}.
5. Run the required verification gates for the selected mode.
6. Commit the completed group changes to the current branch.
7. Write .claude/state/tracker-runs/${group.id}/result.json with this shape:

{
  "group": "${group.id}",
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

Use "status": "blocked" if missing requirements, missing secrets, failing prerequisites, or repeated verification failures prevent completion. Include a concise "blocker" field.

Do not mark tracker work Done. The orchestrator will move tracker state after reading the result file.`;
}

function groupFromIssue(issue) {
  const description = issue.description || '';
  const groupMatch = description.match(/(?:^|\n)\s*[-*]\s*Group:\s*([A-Za-z0-9_-]+)/i) ||
    description.match(/(?:^|\n)\s*Group:\s*([A-Za-z0-9_-]+)/i);
  const storiesMatch = description.match(/(?:^|\n)\s*[-*]\s*Stories:\s*([^\n]+)/i) ||
    description.match(/(?:^|\n)\s*Stories:\s*([^\n]+)/i);

  return {
    id: groupMatch ? groupMatch[1].trim() : issue.key,
    tracker_key: issue.key,
    stories: storiesMatch
      ? storiesMatch[1].split(',').map((item) => item.trim()).filter(Boolean)
      : []
  };
}

module.exports = { buildHarnessPrompt, groupFromIssue };
