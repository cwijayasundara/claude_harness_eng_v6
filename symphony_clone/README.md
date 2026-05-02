# symphony_clone

`symphony_clone` is a standalone Symphony-style orchestrator for Claude Harness story groups.

It is versioned in the same repository as `claude_harness_eng_v4`, but it is not copied into scaffolded target projects. It runs outside Claude Code, monitors Linear, claims an eligible dependency group, creates an isolated Git workspace, and launches Claude Code non-interactively inside that workspace.

```text
Linear issue
  -> symphony_clone Docker container
  -> /workspaces/<issue-key>
  -> git clone + agent branch
  -> claude --print
  -> Claude Harness /auto --group <group>
  -> result.json + branch/PR
  -> Linear proof comment + Human Review
```

## What It Does

- Polls Linear for group issues in `Ready for Agent`.
- Requires the configured ready label, default `agent-ready`.
- Skips issues with unfinished blockers.
- Clones the target repository into `/workspaces/<issue-key>`.
- Creates a branch like `agent/ENG-101`.
- Starts Claude Code with the configured `CLAUDE_COMMAND`.
- Passes a generated prompt on stdin telling Claude Code to run the scaffold workflow for one group.
- Reads `.claude/state/tracker-runs/<group>/result.json`.
- Pushes the branch and attempts to create a GitHub PR with `gh`.
- Posts a proof comment back to Linear.
- Moves the issue to `Human Review` or `Blocked`.
- Records run state in `STATE_DIR/state.json`.
- Writes structured JSONL logs to `LOG_ROOT/orchestrator.jsonl`.
- Retries failed runs with exponential backoff before moving work to the blocked state.
- Resolves Linear workflow states through workspace-specific aliases, for example `Human Review` -> `In Review`.

It does not mark tracker work `Done`. Human review and merge remain explicit.

## Prerequisites

The target repository must already contain the Claude Harness scaffold:

```text
.claude/
specs/stories/
specs/stories/dependency-graph.md
features.json
specs/design/component-map.md
```

Target repos get the project-side contract from `.claude/` and `CLAUDE.md`; this `symphony_clone/` directory stays in the harness repo and runs as infrastructure.

The machine or container running `symphony_clone` needs:

- Docker and Docker Compose
- Linear API key
- Git access to the target repository
- Claude Code authentication
- Optional: GitHub CLI auth/token if PR creation is enabled

## Configure `.env`

From the `symphony_clone` directory:

```bash
cp .env.example .env
```

Edit `.env`:

```text
TRACKER_PROVIDER=linear
LINEAR_API_KEY=lin_replace_me
LINEAR_PROJECT_SLUG=replace-with-linear-project-slug
TARGET_REPO_URL=git@github.com:your-org/your-repo.git
WORKSPACE_ROOT=/workspaces

READY_STATE=Ready for Agent
RUNNING_STATE=In Progress
REVIEW_STATE=Human Review
BLOCKED_STATE=Blocked
REVIEW_STATE_CANDIDATES=Human Review,In Review,Review
BLOCKED_STATE_CANDIDATES=Blocked,Canceled,Cancelled
READY_LABEL=agent-ready
TERMINAL_STATES=Done,Closed,Canceled,Cancelled,Duplicate
MAX_CONCURRENT_RUNS=1
POLL_INTERVAL_MS=60000
MAX_RETRY_ATTEMPTS=3
RETRY_BASE_DELAY_MS=60000
RETRY_MAX_DELAY_MS=900000
STATE_DIR=/workspaces/.symphony
LOG_ROOT=/workspaces/.symphony/logs
STATUS_PORT=0

CLAUDE_COMMAND=claude --print --permission-mode bypassPermissions

GITHUB_BASE_BRANCH=main
BRANCH_PREFIX=agent
CREATE_PR=true
GITHUB_TOKEN=
```

Environment variables exported in the shell override `.env` values.

Do not commit real `.env` files.

## Typical Setup

```bash
# In a target application repo:
claude --plugin-dir ~/claude_harness_eng_v4/.claude
# Run scaffold, spec, design, and tracker-publish from Claude Code.

# In this orchestrator directory:
cd ~/claude_harness_eng_v4/symphony_clone
cp .env.example .env
$EDITOR .env
docker compose up --build
```

For local development without Docker:

```bash
npm test
npm run check
node src/index.js
```

## Hardening Controls

### Retry Policy

The orchestrator records each run attempt in:

```text
${STATE_DIR}/state.json
```

When a Claude Code run, Git push, PR creation handoff, result read, or tracker update fails, the run is marked `retry_wait` until the next retry time. Backoff is exponential:

```text
delay = min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2^(attempt - 1))
```

After `MAX_RETRY_ATTEMPTS`, the issue is commented with the final error and moved to the configured blocked state.

### Linear State Mapping

Different Linear workspaces often use different names for the same workflow step. Configure the preferred state and aliases:

```text
REVIEW_STATE=Human Review
REVIEW_STATE_CANDIDATES=Human Review,In Review,Review
BLOCKED_STATE=Blocked
BLOCKED_STATE_CANDIDATES=Blocked,Canceled,Cancelled
```

The orchestrator tries these names against the workspace workflow states and uses the first match. If none match, the error includes the tried names and available Linear states so the mapping can be fixed quickly.

### Dashboard and Logs

Set `STATUS_PORT` to enable the lightweight dashboard:

```text
STATUS_PORT=8787
```

Endpoints:

```text
GET /          HTML status table
GET /health   {"ok":true}
GET /state    current state.json snapshot
```

If `STATUS_PORT=0`, the server is disabled. To expose the dashboard from Docker, set `STATUS_PORT=8787` and add a port mapping such as `8787:8787` in your deployment override.

Structured logs are written to:

```text
${LOG_ROOT}/orchestrator.jsonl
```

Each record includes a timestamp, event name, level, and run context such as issue key, group, attempt, PR URL, or error.

## Deploy With Docker

Build and run:

```bash
docker compose up --build
```

Run in the background:

```bash
docker compose up --build -d
```

View logs:

```bash
docker compose logs -f symphony-clone
```

Stop:

```bash
docker compose down
```

The included `docker-compose.yml` mounts:

```yaml
volumes:
  - symphony-workspaces:/workspaces
  - ${HOME}/.claude:/root/.claude:ro
  - ${HOME}/.ssh:/root/.ssh:ro
```

For local testing, this lets the container reuse your Claude Code and SSH credentials. For production, prefer a dedicated runtime identity and scoped deploy keys.

## How Claude Code Is Triggered

`symphony_clone` launches Claude Code as a subprocess in the cloned workspace.

Default command:

```bash
claude --print --permission-mode bypassPermissions
```

The orchestrator executes `CLAUDE_COMMAND` through `${SHELL:-/bin/bash} -lc` and passes the generated task prompt as the final shell-escaped argument. This matters for local runs because Claude Code authentication may be initialized by the user's login shell.

Conceptually:

```bash
cd /workspaces/ENG-101
claude --print --permission-mode bypassPermissions "generated prompt text"
```

If you need a custom command shape, include `{{prompt}}` in `CLAUDE_COMMAND`; the runner replaces it with the shell-escaped prompt.

The generated prompt tells Claude Code to:

1. Read `.claude/skills/auto/SKILL.md`.
2. Read `.claude/program.md`, learned rules, `features.json`, and story files.
3. Execute the harness workflow for one group, for example `/auto --group A`.
4. Commit the completed changes.
5. Write `.claude/state/tracker-runs/A/result.json`.

If slash commands are unavailable in non-interactive mode, the prompt instructs Claude Code to follow the skill file directly.

## Linear Issue Format

Each eligible Linear issue should represent one Claude Harness dependency group.

Minimum body:

```markdown
## Harness Group

- Group: A
- Harness command: /auto --group A
- Stories: E1-S1, E1-S2
- Depends on groups: none
```

The issue must:

- Be in the configured ready state, default `Ready for Agent`.
- Have the configured ready label, default `agent-ready`.
- Have blockers completed or in terminal states if blockers are configured.

Recommended workflow:

```text
Published -> Ready for Agent -> In Progress -> Human Review -> Done
                         \-> Blocked
```

## Result Contract

Claude Code must write:

```text
.claude/state/tracker-runs/<group>/result.json
```

Success example:

```json
{
  "group": "A",
  "status": "human_review",
  "summary": "Implemented group A password reset foundation.",
  "branch": "agent/ENG-101",
  "commit": "abc123",
  "tests": [
    "npm test: passed",
    "npm run lint: passed"
  ],
  "reports": [
    "specs/reviews/evaluator-report.md",
    "specs/reviews/security-review.md"
  ],
  "features_updated": ["F001", "F002"]
}
```

Blocked example:

```json
{
  "group": "A",
  "status": "blocked",
  "summary": "Could not start evaluator.",
  "blocker": "Missing DATABASE_URL required by project-manifest local verification mode.",
  "tests": [],
  "reports": []
}
```

When status is `human_review`, the orchestrator pushes the branch, attempts PR creation, posts proof to Linear, and moves the issue to `Human Review`.

When status is `blocked`, the orchestrator posts the blocker and moves the issue to `Blocked`.

## Run Without Docker

For local development:

```bash
node src/index.js
```

Verify:

```bash
npm test
npm run check
```

## Security Notes

- Keep API tokens in `.env` or runtime secrets, not Git.
- Prefer a dedicated Linear API key and GitHub token for the orchestrator.
- Use a dedicated SSH deploy key for repository access.
- Keep `MAX_CONCURRENT_RUNS=1` until the workflow is proven.
- Review generated PRs before merge.
- Do not use broad production credentials inside agent workspaces.

## Troubleshooting

**No issues are picked up**

- Confirm the issue state equals `READY_STATE`.
- Confirm the issue has `READY_LABEL`.
- Confirm blockers are in terminal states.
- Confirm `LINEAR_PROJECT_SLUG` matches the Linear project slug.

**Git clone fails**

- Confirm `TARGET_REPO_URL`.
- Confirm the container has SSH credentials or use an HTTPS token URL.
- Check `docker compose logs -f symphony-clone`.

**Claude Code does not start**

- Confirm Claude Code is installed in the image or available in the runtime.
- Confirm `${HOME}/.claude` is mounted for local Docker testing.
- Override `CLAUDE_COMMAND` if your Claude Code command differs.

**No PR is created**

- Confirm `CREATE_PR=true`.
- Confirm `gh` is authenticated or `GITHUB_TOKEN` is available.
- Branch push can still succeed even if PR creation fails; the proof comment will include the PR failure text.

## Current Limitations

- Linear is implemented first.
- Jira is an explicit stub.
- No webhook receiver yet; polling only.
- No dynamic workflow reload.
- No terminal-state workspace cleanup yet.
- Claude Code runs as a subprocess, not through Codex app-server.
