# symphony_clone

`symphony_clone` is a standalone Symphony-style orchestrator for Claude Harness story groups.

It runs outside Claude Code. Its job is to monitor a tracker (Linear, Jira, or Azure DevOps Boards), claim an eligible dependency group, create an isolated Git workspace, and launch Claude Code non-interactively inside that workspace.

```text
Linear issue (Todo + label)
  -> symphony_clone Docker container
  -> /workspaces/<issue-key>
  -> git clone + agent branch
  -> claude --print
  -> Claude Harness /auto --group <group>   (or /lite, /deep, ... — configurable)
  -> result.json + branch/PR
  -> Linear proof comment + Human Review
```

## What It Does

- **Planning (architect stage):** an issue carrying `PLAN_LABEL` (default `agent-plan`) is treated as a **PRD**. Claiming it runs the planning pipeline — `/brd → /spec → /design → /test → /tracker-publish` (plan only, no application code) — which **publishes the per-cluster group issues** the execution path then claims, and advances the PRD issue to `PLANNED_STATE`. This makes the flow genuinely PRD-in → PRs-out with no human grooming.
- Polls Linear for group issues in the configured ready state.
- Requires the configured ready label (default `agent-ready`).
- Skips issues with unfinished blockers.
- Clones the target repository into `/workspaces/<issue-key>`.
- Creates a branch like `agent/ENG-101`.
- Starts Claude Code with `CLAUDE_COMMAND`, passing a generated harness prompt.
- Reads `.claude/state/tracker-runs/<group>/result.json`.
- Pushes the branch and creates a GitHub PR via `gh`.
- Posts a proof comment back to Linear and moves the issue to `Human Review` or `Blocked`.
- **Self-heals stuck runs**: if an issue is left in the running state but no orchestrator process is actually running it (after a crash or restart), the next tick reclaims it back to ready state and retries.
- **Supports parallel runs**: launches up to `MAX_CONCURRENT_RUNS` group issues concurrently per tick, each in its own isolated workspace.
- Records run state in `STATE_DIR/state.json` and structured logs in `LOG_ROOT/orchestrator.jsonl`.
- Retries failed runs with exponential backoff before moving work to the blocked state.

By default it does not mark tracker work `Done` — human review and merge remain explicit. Set `AUTO_MERGE=true` for the fully autonomous path: a run that reaches `human_review` (harness gates already passed) enables GitHub native auto-merge on its PR — GitHub merges only once required checks pass, so a red build never lands — and advances the issue to `DONE_STATE`. See `.env.example`.

## Tracker providers

Select the provider with `TRACKER_PROVIDER` (`linear` | `jira` | `azure`; aliases `ado`,
`azure-devops` map to `azure`). All three implement the same adapter contract, so the
orchestration loop, eligibility, and PR flow are identical — only the API transport and
the way "state" and "labels" map to native concepts differ:

| Concept | Linear | Jira Cloud | Azure DevOps Boards |
|---|---|---|---|
| Auth | API key (`LINEAR_API_KEY`) | email + API token, HTTP Basic | Personal Access Token, HTTP Basic |
| Pipeline state (`READY_STATE`, …) | workflow state | status (workflow transition) | work-item `System.State` |
| Label (`READY_LABEL`, `PLAN_LABEL`) | issue label | issue label | work-item tag |
| Blockers | `blocked_by` relations | "Blocks" issue links | Predecessor (Dependency) links |
| Required env | `LINEAR_API_KEY`, `LINEAR_PROJECT_SLUG` | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY` | `AZURE_DEVOPS_ORG_URL`, `AZURE_DEVOPS_PROJECT`, `AZURE_DEVOPS_PAT` |

The configured state names (`READY_STATE`, `RUNNING_STATE`, `REVIEW_STATE`, `BLOCKED_STATE`,
`PLANNED_STATE`, `DONE_STATE`) and labels must exist in your board. For Jira, `READY_STATE`/etc.
must be reachable workflow **transitions**; for Azure DevOps they must be valid states for the
work-item type. The fallback-candidate lists (e.g. `BLOCKED_STATE_CANDIDATES`) let one `.env`
cover boards with slightly different state names. See `.env.example` for the full per-provider block.

All three authenticate with a long-lived token (no interactive OAuth), so the daemon runs
headless. Tokens stay in `.env`/runtime secrets — never in Git.

## Prerequisites

The target repository must already contain the Claude Harness scaffold:

```text
.claude/
specs/stories/
specs/stories/dependency-graph.md
features.json
specs/design/component-map.md
```

The machine running `symphony_clone` needs:

- Docker and Docker Compose
- Linear API key (workspace + project access)
- Git access to the target repository
- Claude Code subscription (Pro/Max/Team/Enterprise) **or** an Anthropic API key
- GitHub Personal Access Token with `repo` scope (PRs and pushes use it)

## Quick Start

### First-time setup

```bash
cp .env.example .env
# edit .env: LINEAR_API_KEY, LINEAR_PROJECT_SLUG, TARGET_REPO_URL
./scripts/bootstrap.sh
```

`bootstrap.sh` validates `.env`, auto-pulls a `GITHUB_TOKEN` from `gh auth token` if you have the GitHub CLI signed in, builds the image, starts the container, and verifies Claude Code authentication inside the container. If Claude is not yet authenticated, the script prints the exact `/login` command to run.

### First-time Claude login (one-off, only on a fresh volume)

The container persists Claude's auth tokens in a Docker volume. The first time the volume exists, you have to log in once:

```bash
docker exec -u node -it symphony_clone-symphony-clone-1 claude /login
```

Pick **option 1** (Claude account with subscription) and complete the OAuth flow in your browser. The token lands in the `symphony-claude-home` volume and survives container recreates.

### Tail logs

```bash
docker compose logs -f symphony-clone
```

### Health check Linear

```bash
node scripts/diagnose-linear.js
```

## Configure `.env`

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
MAX_WALLCLOCK_PER_RUN_MS=7200000
WORKSPACE_RETENTION=delete
STATE_DIR=/workspaces/.symphony
LOG_ROOT=/workspaces/.symphony/logs
STATUS_PORT=0

CLAUDE_COMMAND=claude --print --permission-mode bypassPermissions
HARNESS_COMMAND_TEMPLATE=/auto --group {{group}}

GITHUB_BASE_BRANCH=main
BRANCH_PREFIX=agent
CREATE_PR=true
GITHUB_TOKEN=
```

Environment variables exported in the shell override `.env` values. Do not commit real `.env` files.

### Configurable Harness Command

`HARNESS_COMMAND_TEMPLATE` controls the slash command Claude is told to execute. Two placeholders are substituted at runtime:

- `{{group}}` — the harness group ID (from the Linear issue description)
- `{{issue}}` — the Linear issue key (e.g. `ENG-101`)

Examples:

```text
HARNESS_COMMAND_TEMPLATE=/auto --group {{group}}                    # default — full ratcheting loop
HARNESS_COMMAND_TEMPLATE=/vibe --group {{group}}                    # tiny-effort lane (no sprint contract)
HARNESS_COMMAND_TEMPLATE=/improve --group {{group}} --issue {{issue}}  # narrow improvement on existing code
```

**Important:** `/lite` is a scaffold-time skill that writes `specs/brd/`, `specs/stories/`, and design artifacts from a one-paragraph description. It is **not** an implementation runtime, so `HARNESS_COMMAND_TEMPLATE=/lite` would try to re-scaffold the workspace and fail. Use `/auto` (full ratcheting) or `/vibe` (no-ratchet lane for trivial changes) for implementation.

#### Per-issue mode override via Linear label

To override the global template on a single issue, add a Linear label of the form `mode-<command>` to that issue. The orchestrator strips the `mode-` prefix and uses the rest as the slash command name. Only commands that operate on an existing workspace (require `--group` to mean "implement that group") are valid here:

| Label on issue | Command Claude runs |
|----------------|---------------------|
| `mode-auto`    | `/auto --group <id>`    (explicit default) |
| `mode-vibe`    | `/vibe --group <id>`    (skip ratchet) |
| `mode-improve` | `/improve --group <id>` (enhancement on existing code) |

This lets you flag an individual issue without changing global config. Do **not** use `mode-lite`, `mode-brd`, `mode-spec`, `mode-design`, or `mode-brownfield` — those are scaffold/discovery skills that expect a fresh workspace or a description argument, not a group ID.

## Parallel Runs

`MAX_CONCURRENT_RUNS` controls how many group issues the orchestrator can run simultaneously. Each run gets its own workspace directory and Claude process — there is no shared state inside a run.

| Setting | When to use |
|---------|-------------|
| `1` (default) | Conservative; lets you observe one run at a time. |
| `2-3` | Once the workflow is proven. Two independent group issues finish in roughly the wall-clock time of one. |
| `4+` | Watch Anthropic token rate limits and disk usage (each workspace is 100MB+). |

To get genuine parallelism, your project needs **multiple independent groups** in `specs/stories/dependency-graph.md`. A single linear-DAG project still finishes one group at a time even with `MAX_CONCURRENT_RUNS=3`. Use `scripts/create-group-issue.js` to create one Linear issue per group.

## Self-Heal

If a run crashes (orchestrator process killed, container restarted, Docker daemon hiccup) while an issue is in the running state, the next tick detects the orphan and resets it:

1. `listCandidates` returns the issue (still in `In Progress` state in Linear).
2. The in-memory `running` set is empty (new process).
3. `reclaimStuck` fires: records the abandonment as a failure in `state.json` (preserving attempt counter + backoff), comments on the Linear issue, and moves it back to the ready state.
4. The next tick picks it up like any normal Todo issue (subject to retry backoff).

Log events:

```text
warn  run_reclaim_started  issueKey=ENG-101 state="In Progress"
info  run_reclaimed        issueKey=ENG-101
```

The reclaim writes a Linear comment so the human reviewer sees that a previous run was abandoned. Attempt counter is bumped — repeated abandonment will eventually exhaust `MAX_RETRY_ATTEMPTS` and move the issue to blocked.

## Operational Tooling

| Script | Purpose |
|--------|---------|
| `scripts/bootstrap.sh` | Validate `.env`, build image, start container, verify Claude auth. Idempotent — safe to re-run. |
| `scripts/diagnose-linear.js` | Print Linear project state counts and configured target states. Useful when issues are not being picked up. |
| `scripts/create-group-issue.js` | Create a Linear "harness group" issue with the correct labels and description format. Idempotent — refuses to create duplicates for the same group ID. |
| `scripts/sync-to-template.sh` | (Canonical only.) Sync this codebase into the `claude_harness_eng_v5/symphony_clone` template so scaffolded projects inherit fixes. |

### Creating multiple group issues

For a project with three independent groups (A, B, C, where B and C depend on A):

```bash
node scripts/create-group-issue.js --group A --stories "E1-S1,E1-S2" --title "Foundation"
node scripts/create-group-issue.js --group B --stories "E2-S1,E2-S2" --title "Feature B" --depends-on A
node scripts/create-group-issue.js --group C --stories "E3-S1"      --title "Feature C" --depends-on A
```

After Group A finishes, B and C will run **in parallel** if `MAX_CONCURRENT_RUNS >= 2`.

## Deploy With Docker

The included `docker-compose.yml` uses two volumes for persistence and isolation:

```yaml
volumes:
  - symphony-workspaces:/workspaces           # per-issue git workspaces + state.json
  - symphony-claude-home:/home/node           # Claude config + auth tokens (persists across recreates)
  - ${HOME}/.ssh:/home/node/.ssh:ro           # SSH keys for git operations (read-only)
```

`symphony-claude-home` is a named Docker volume — the container's Claude state is **isolated from your host's macOS Claude state**. This is intentional: macOS Claude Code stores auth tokens in Keychain (which the container can't access), while the container's Linux Claude Code stores them in `~/.claude/`. Mixing them via a bind mount confuses both.

The container runs as the **non-root `node` user**. Claude Code refuses to use `--dangerously-skip-permissions` / `bypassPermissions` mode as root.

GitHub authentication for git push and PR creation flows through a system-wide credential helper installed at image build time:

```dockerfile
RUN git config --system 'credential.https://github.com.helper' \
  '!f() { test "$1" = "get" && printf "username=x-access-token\npassword=%s\n" "$GITHUB_TOKEN"; }; f'
```

When git needs credentials for any `https://github.com/*` URL, the helper reads `$GITHUB_TOKEN` from the runtime environment and feeds it to git.

### Commands

```bash
docker compose up --build              # foreground build + run
docker compose up --build -d           # background
docker compose logs -f symphony-clone  # tail
docker compose down                    # stop, keep volumes (auth persists)
docker compose down -v                 # stop AND wipe volumes (Claude re-login required after)
```

## How Claude Code Is Triggered

`symphony_clone` launches Claude Code as a subprocess in the cloned workspace.

Default command:

```bash
claude --print --permission-mode bypassPermissions
```

The orchestrator executes `CLAUDE_COMMAND` through `${SHELL:-/bin/bash} -lc` and passes the generated task prompt as the final shell-escaped argument.

If you need a custom command shape, include `{{prompt}}` in `CLAUDE_COMMAND`; the runner replaces it with the shell-escaped prompt.

The generated prompt tells Claude Code to:

1. Read `.claude/skills/auto/SKILL.md`, `.claude/program.md`, learned rules, `features.json`, and story files.
2. Execute the resolved harness command (from `HARNESS_COMMAND_TEMPLATE` or label override), e.g. `/auto --group A`.
3. Commit the completed changes to the current branch.
4. Write `.claude/state/tracker-runs/<group>/result.json`.

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

- Be in the configured ready state (default `Ready for Agent`).
- Have the configured ready label (default `agent-ready`).
- Have all `blocked_by` related issues in terminal states.

Optional labels:

| Label | Effect |
|-------|--------|
| `mode-auto`, `mode-vibe`, `mode-improve` | Override `HARNESS_COMMAND_TEMPLATE` for this issue only. See the "Per-issue mode override" section above for the full list of valid commands. |

Recommended workflow:

```text
Backlog -> Todo -> In Progress -> Human Review -> Done
                            \-> Blocked / Canceled
```

## Result Contract

Claude Code must write `.claude/state/tracker-runs/<group>/result.json`.

Success example:

```json
{
  "group": "A",
  "status": "human_review",
  "summary": "Implemented group A password reset foundation.",
  "branch": "agent/ENG-101",
  "commit": "abc123",
  "tests": ["npm test: passed", "npm run lint: passed"],
  "reports": ["specs/reviews/evaluator-report.md", "specs/reviews/security-review.md"],
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

When status is `human_review`, the orchestrator pushes the branch, opens a PR, posts proof to Linear, and moves the issue to `Human Review`. When status is `blocked`, the orchestrator posts the blocker and moves the issue to `Blocked`.

## Retry Policy

Each failure (Claude exit code, git push, PR creation, result read, tracker update) records an attempt in `state.json`. Backoff is exponential:

```text
delay = min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2^(attempt - 1))
```

After `MAX_RETRY_ATTEMPTS`, the issue is commented with the final error and moved to the blocked state.

The self-heal flow records reclaim events as failed attempts too — so if a run abandons itself repeatedly (e.g. host keeps sleeping), the system eventually marks the issue blocked instead of looping forever.

## Dashboard and Logs

Set `STATUS_PORT` to enable the lightweight dashboard:

```text
STATUS_PORT=8787
```

Endpoints:

| Route | Response |
|-------|----------|
| `GET /` | HTML status table |
| `GET /health` | `{"ok":true}` |
| `GET /state` | Current `state.json` snapshot |

If `STATUS_PORT=0`, the server is disabled. To expose from Docker, set `STATUS_PORT=8787` and add a port mapping `8787:8787` in your compose override.

Structured JSONL logs are written to `${LOG_ROOT}/orchestrator.jsonl`. Each record includes a timestamp, event name, level, and run context (issue key, group, attempt, PR URL, error message).

## Run Without Docker

For local development:

```bash
node src/index.js
```

Verify:

```bash
npm test        # unit tests (scheduler, prompt-builder, state-store, tracker, runner, etc.)
npm run check   # node --check on every JS file
```

## Testing end-to-end

Validate the orchestrator in three escalating layers (cheapest first). The recipe is the
same for every provider — only the board and credentials change.

**1. Unit (no network, no Claude).** `npm test`. Each tracker adapter takes an injectable
`fetchImpl`, so the adapter logic (issue normalization, state transitions, blocker
resolution) is asserted against mocked API responses — see `src/tracker/*.test.js`.

**2. Dry control-plane loop (real tracker, stub Claude).** Point `.env` at a real project
and replace the agent with a stub so you exercise polling → claim → state machine → PR
plumbing without spending a real build:

```bash
# stub-claude.sh — pretend a group built successfully
mkdir -p .claude/state/tracker-runs/A
printf '{"group":"A","status":"human_review","summary":"stub","branch":"agent/test","commit":"HEAD"}' \
  > .claude/state/tracker-runs/A/result.json
```

Set `CLAUDE_COMMAND=bash /path/to/stub-claude.sh` and `CREATE_PR=false`, create a test
issue in `READY_STATE` with the `agent-ready` label, then run `node src/index.js`. Watch
it move the issue In Progress → comment → Human Review. This proves eligibility, the state
machine, retries, and reclaim logic per provider.

**3. Full live (real tracker, real Claude — full auto).** Use the real `CLAUDE_COMMAND`,
set `AUTO_MERGE=true`, and create a **PRD** issue in `READY_STATE` labelled `agent-plan`.
The planning lane runs `/brd → /spec → /design → /test → /tracker-publish`, publishes one
`agent-ready` issue per cluster, and the execution lane builds each cluster into its own
PR, which GitHub auto-merges once checks pass. This is the end-to-end Flow 1.

For Linear specifically, `node scripts/diagnose-linear.js` prints live state/label counts,
which is the fastest way to confirm your `.env` states and labels match the board.

## Security Notes

- Keep API tokens in `.env` or runtime secrets, not Git. `.env` should be in `.gitignore`.
- Prefer a dedicated Linear API key and GitHub token for the orchestrator.
- `GITHUB_TOKEN` only needs `repo` scope.
- Use a dedicated SSH deploy key for repository access if cloning over SSH.
- Start with `MAX_CONCURRENT_RUNS=1` and scale up after a clean run.
- Review generated PRs before merge.
- The container runs as a non-root `node` user; do not chown volumes back to root.
- The `bypassPermissions` mode skips Claude Code's per-tool confirmation prompts. Acceptable for headless orchestration; do not run interactive Claude this way.

## Troubleshooting

**No issues are picked up**

- Confirm the issue state equals `READY_STATE`.
- Confirm the issue has `READY_LABEL`.
- Confirm blockers are in terminal states.
- Confirm `LINEAR_PROJECT_SLUG` matches the project's Linear slug.
- Run `node scripts/diagnose-linear.js` to see actual state counts.

**`/bin/bash: line 1: claude: command not found`**

- The image was built without Claude Code. Rebuild: `docker compose build --no-cache`.

**`--dangerously-skip-permissions cannot be used with root/sudo privileges`**

- The container is running as root. The included Dockerfile switches to the `node` user — if you customised it, restore `USER node`.

**`Not logged in · Please run /login`**

- The container's Claude state is empty. Run:
  ```bash
  docker exec -u node -it symphony_clone-symphony-clone-1 claude /login
  ```
  Pick option 1. Token persists in the `symphony-claude-home` volume.

**Git push fails: `could not read Username for 'https://github.com'`**

- `GITHUB_TOKEN` is empty or missing. Set it in `.env`:
  ```bash
  echo "GITHUB_TOKEN=$(gh auth token)" >> .env
  docker compose up -d --force-recreate
  ```
- If your remote is SSH (`git@github.com:...`), make sure `~/.ssh/id_*` is registered with your GitHub account; the orchestrator mounts `~/.ssh` read-only.

**Run starts, gets stuck on a single tick for hours**

- A previous run probably crashed and the issue is in the running state. The self-heal should reclaim it within one poll cycle. If not, check `state.json` and the orchestrator logs for `run_reclaim_*` events.

**Linear shows the issue in `Todo` even though `run_started` fired**

- Someone may have moved the issue manually in the Linear UI. Don't move issues during a run — the orchestrator's `finishRun` will overwrite the state when the run completes.

## Retry Preserves Local Commits

When a run fails after Claude has made commits but before the push succeeds (the classic failure mode: `git push` errors because `GITHUB_TOKEN` is missing or the helper isn't installed), the retry would historically reset the agent branch to `origin/main` and erase Claude's work.

`workspace-manager.js:prepare()` now does the following on each invocation:

1. Always `git fetch origin <base-branch>` to pull the latest base.
2. If the workspace already exists and the local agent branch has commits ahead of the base, **preserve them**:
   - Create a recovery tag `recovery/<branchName>/attempt-<n>-<timestamp>` pointing at the branch HEAD.
   - `git checkout <branchName>` (no `-B`, no reset).
   - Return `{ resumed: true, commitsAhead, backupRef }`.
3. Only when the branch is missing locally or has zero commits ahead of the base does the destructive `git checkout -B branchName origin/<base>` run.

The scheduler logs `workspace_resumed` with the recovery tag whenever a retry resumes mid-flight work. Recovery tags accumulate one per attempt; they are not pruned automatically. Clean them up manually with `git tag -d recovery/...` once you're confident the run won't need them.

This means: if a credential, push, or PR-creation step fails after Claude has committed, the retry continues from the existing commits rather than starting Claude over.

## Workspace Retention

`WORKSPACE_RETENTION` controls what happens to `/workspaces/<issue-key>` after a run reaches a terminal state (`human_review` or final `blocked`):

| Value | Behaviour |
|-------|-----------|
| `delete` (default) | The orchestrator removes `/workspaces/<issue-key>` once the issue is moved to its terminal tracker state. The branch is already on the remote, so nothing useful is lost. |
| `keep` | The directory is left in place for forensics. Disk usage grows over time; you are responsible for housekeeping. |

The deletion is sandboxed: the orchestrator refuses to delete any path that is not strictly inside `WORKSPACE_ROOT`.

`MAX_WALLCLOCK_PER_RUN_MS` caps the wall-clock time of a single `claude` subprocess. The default is 2 hours (`7200000`). When the cap is hit, the process is `SIGTERM`'d and the failure follows the normal retry / blocked path. The legacy `CLAUDE_TURN_TIMEOUT_MS` env var still works as an alias if `MAX_WALLCLOCK_PER_RUN_MS` is unset.

## Known follow-ups (from code review)

These were flagged during review and intentionally deferred — none are exploitable, but each is worth a future pass:

- **`branchExists` / `countCommitsAhead` swallow real git errors.** A torn-down git index or a permission error would currently look identical to "branch absent" and silently fall through to the destructive reset path. Hardening: distinguish "ref not found" (expected) from other failure modes (propagate). See `src/orchestrator/workspace-manager.js:69-86`.
- **`post-checkout` hook trust boundary.** When `prepare()` resumes a workspace, `git checkout <branchName>` will execute `.git/hooks/post-checkout` if Claude wrote one in the previous run. Because `runCommand` inherits the full `process.env`, that hook would see `LINEAR_API_KEY`, `GITHUB_TOKEN`, and any LLM keys. Mitigation: `git config core.hooksPath /dev/null` immediately after clone, or run git with a minimal env allow-list. Tracked separately from the resume-preservation work.
- **Recovery tags are local-only and accumulate.** Each retry creates a new `recovery/<branch>/attempt-<n>-<ts>-<uuid>` tag inside the workspace. They are not pushed (intentional — they encode attempt metadata you don't want in the remote). If the workspace lives a long time, tags accumulate. Clean up with `git tag -d recovery/...` or set `WORKSPACE_RETENTION=delete` (default) so the whole workspace goes when the issue reaches a terminal state.
- **`safeWorkspaceKey` enforces 80-char truncation.** Two distinct Linear keys longer than 80 characters could collide on the same workspace dir. Practically a non-issue (Linear keys are short), but flagged for completeness.

## Current Limitations

- Linear is implemented; Jira is a stub.
- No webhook receiver yet; polling only.
- No dynamic workflow reload — `.env` changes require container recreate.
- File-based `state.json` is fine for `MAX_CONCURRENT_RUNS <= ~5`; SQLite would be needed at larger scales.
- Claude Code runs as a subprocess, not through Codex app-server.
