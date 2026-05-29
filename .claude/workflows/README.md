# Dynamic Workflows

JavaScript files in this directory auto-register as `/<name>` slash commands
(the `name` from each script's `export const meta` block). They are the
project's **dynamic workflows** — deterministic multi-agent orchestration that
fans out subagents, verifies their work, and synthesizes a result. They are
shared via git, so everyone on the project inherits them, exactly like the
bundled `/deep-research`.

## Shipped with the harness

| Command | File | What it does |
|---|---|---|
| `/harness-review` | `harness-review.js` | Reviews the current diff across correctness / security / architecture / quality, adversarially verifies each finding, synthesizes a report. Dynamic-workflow form of `/review`. |
| `/harness-implement-group <group-id>` | `harness-implement-group.js` | Builds a sprint group's stories in parallel — one TDD implementer per story in an isolated worktree, then an independent acceptance-criteria reviewer. Dynamic-workflow form of the `/implement` agent-team lane. |
| `/harness-brownfield-map [scope]` | `harness-brownfield-map.js` | Surveys an existing codebase through five parallel lenses (structure, entry points, dependencies, tests, risk), then synthesizes the `specs/brownfield/` maps. Dynamic-workflow form of `/brownfield`. |
| `/harness-eval <contract-id>` | `harness-eval.js` | Runs the three harness verification layers (API, UI/Playwright, schema) in parallel against the running app and aggregates one PASS/FAIL verdict. Dynamic-workflow form of `/evaluate`. |

## Enablement (not a project setting)

Dynamic workflows are plan- and runtime-gated, not turned on by a file:

- **Plan:** Pro+ (Pro toggles "Dynamic workflows" in `/config`; Max/Team/Enterprise default-on).
- **Trigger:** include the word `workflow` in a prompt, run a saved `/<name>`
  command above, or set `/effort ultracode` to let Claude auto-orchestrate.
- **Cost:** workflows spawn many subagents and use substantially more tokens
  than a normal turn. Start scoped.
- **Kill-switch:** an org admin (or `~/.claude/settings.json` /
  `CLAUDE_CODE_DISABLE_WORKFLOWS=1`) can disable workflows via
  `disableWorkflows: true`. The harness deliberately does **not** set this key —
  do not add it to `.claude/settings.json`.

## Adding your own

Create `your-name.js` here, starting with a pure-literal `meta` block:

```js
export const meta = {
  name: 'your-name',
  description: 'one-line summary shown in the permission dialog',
  phases: [{ title: 'Phase A' }, { title: 'Phase B' }],
}
// body: use agent(), parallel(), pipeline(), phase(), log(), args
```

To bind a step to a specific harness agent, pass `agentType` to `agent()` (e.g.
`agentType: 'security-reviewer'`) — but confirm that agent is registered in the
project first, or the call will error.
