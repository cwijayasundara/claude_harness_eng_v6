# Optional Power-Ups

None of these are required. The core loop — pick a lane, let the ratchet run, review the diff — works without any of them.

## Tracker-driven agent factory (Linear/Jira)

For teams that want a visible queue, parallel execution, and tracker-based review:

1. During `/scaffold`, choose tracker mode B/C/D
2. After planning, run `/tracker-publish` — creates one Linear/Jira issue per dependency group
3. Start the orchestrator:
   ```bash
   cd ~/claude_harness_eng_v4/symphony_clone
   cp .env.example .env && $EDITOR .env
   docker compose up --build
   ```
4. The orchestrator polls the tracker, claims ready groups, runs Claude Code in isolated workspaces, opens PRs, and posts proof back to the tracker
5. Humans review PRs and mark issues Done — the orchestrator never does

Operator guide: `symphony_clone/README.md`.

## Framework skill packs

During `/scaffold`, opt into framework-specific skill packs:

| Pack | Skills | Use when |
|---|---|---|
| LangChain / LangGraph / DeepAgents | 9 | Building LangChain agents, LangGraph workflows, or DeepAgents apps |
| Google ADK | 7 | Building Google Agent Development Kit agents |

These inject framework-aware code generation on top of the harness discipline. Same `/auto` ratchet still runs.

`/scaffold` records selected packs in `project-manifest.json` but does not run `npx skills add` from inside Claude Code. The auto-mode classifier blocks external installs, so run the selected pack command in a normal terminal:

```bash
npx --yes skills add cwijayasundara/agent_cli_langchain -a claude-code -s '*' -y   # LangChain
npx --yes skills add google/agents-cli -a claude-code -s '*' -y                     # Google ADK
```

Then verify: `/install-framework-packs`

If a pack shows `PENDING MANUAL INSTALL`, run the `npx` command above in a regular terminal (not Claude Code), then verify with `/install-framework-packs --list`.

## Richer AST graphs with Understand-Anything

For brownfield refactors, the scaffold can consume an [Understand-Anything](https://github.com/Lum1104/Understand-Anything/tree/main) knowledge graph when that Claude Code plugin is installed in the target repo. This is useful when you need AST-backed call, symbol, inheritance, and dependency evidence before changing an existing system.

1. Install the plugin in Claude Code:
   ```text
   /plugin marketplace add Lum1104/Understand-Anything
   /plugin install understand-anything
   ```
2. Run the plugin's analysis workflow in the target repo:
   ```text
   /understand
   ```
   This writes:
   ```text
   .understand-anything/knowledge-graph.json
   ```
3. Run `/code-map` or import the graph directly:
   ```bash
   node .claude/skills/code-map/scripts/import_understand_graph.js \
     --in .understand-anything/knowledge-graph.json \
     --out specs/brownfield/code-graph.json
   node .claude/skills/code-map/scripts/build_graph.js \
     --render-mermaid specs/brownfield/code-graph.json \
     --out specs/brownfield/dependency-graph.md
   node .claude/skills/code-map/scripts/build_graph.js \
     --coupling-report specs/brownfield/code-graph.json \
     --out specs/brownfield/coupling-report.md
   ```
4. Run `/brownfield`, then `/seam-finder "<change goal>"` before `/improve` or `/refactor`.
5. For visual exploration, run `/understand-dashboard` from the plugin. For keeping graphs fresh, use `/understand --auto-update` or re-run `/understand` before large releases.

Understand-Anything is optional. If its graph is absent, `/code-map` falls back to the vendored deterministic extractor, then `/brownfield` still writes the same `specs/brownfield/` artifacts.

## Dynamic workflows

Four `/harness-*` dynamic workflows (`harness-brownfield-map`, `harness-eval`, `harness-implement-group`, `harness-review`) provide parallel-fan-out alternatives to `/brownfield`, `/evaluate`, `/implement`, and `/review`. See `.claude/workflows/README.md`. Use the skill form **or** the workflow form for a given step — never both in the same run.
