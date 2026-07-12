# Dynamic Workflows

JavaScript files in this directory auto-register as `/<name>` slash commands
(the `name` from each script's `export const meta` block). They are
**dynamic workflows** — deterministic multi-agent orchestration that fans out
subagents, verifies their work, and synthesizes a result. They are shared via
git, so everyone on the project inherits them, exactly like the bundled
`/deep-research`.

### What the harness ships

| Workflow | Role |
|----------|------|
| **`fix-diagnostics.js`** → `/fix-diagnostics` | **Exemplar only** (Bun Phase C): multi-phase fan-out over the Phase B diagnostics work queue. Does **not** replace `/gate` or `/implement`. Skill form remains primary: `fix-from-diagnostics`. |

Earlier versions also bundled `/harness-eval`, `/harness-review`, `/harness-brownfield-map`, and `/harness-implement-group`, but each merely duplicated an existing skill (`/evaluate`, `/gate`, `/brownfield`, `/implement`) — and the weaker duplicate at that. Those were removed. **Do not** re-add skill clones. Author a workflow only when you have a genuinely new fan-out to orchestrate (the diagnostics queue is the pattern to copy).

### Monitor the loop; edit the workflow

Bun’s rewrite succeeded partly because false starts (`git stash` races, stub-to-green, suite thrash) led to **process edits**, not only code patches. When this workflow misbehaves:

1. Fix the tree for the immediate breakage.  
2. Append a **process rule** to `.claude/state/process-rules.md`.  
3. Patch `.claude/workflows/fix-diagnostics.js` (or the skill) so the next run cannot repeat the failure.

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
