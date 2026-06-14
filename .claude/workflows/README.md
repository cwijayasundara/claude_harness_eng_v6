# Dynamic Workflows

JavaScript files in this directory auto-register as `/<name>` slash commands
(the `name` from each script's `export const meta` block). They are
**dynamic workflows** — deterministic multi-agent orchestration that fans out
subagents, verifies their work, and synthesizes a result. They are shared via
git, so everyone on the project inherits them, exactly like the bundled
`/deep-research`.

The harness ships **no** built-in workflows: earlier versions bundled
`/harness-eval`, `/harness-review`, `/harness-brownfield-map`, and
`/harness-implement-group`, but each merely duplicated an existing skill
(`/evaluate`, `/gate`, `/brownfield`, `/implement`) — and the weaker
duplicate at that (no security gate, no `security-verdict.json`, no quality
gate). They were removed to avoid two confusing lanes for the same task. Use
the skill forms; author your own workflow below when you have a genuinely new
fan-out to orchestrate.

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
