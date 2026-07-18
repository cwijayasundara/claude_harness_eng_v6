# Claude Harness Engine wiki brief

Generate an evidence-backed, agent-first wiki for this repository. Prioritize the
public product surface and the execution model over exhaustive file inventories.

The most important sources are `README.md`, `HARNESS.md`, `design.md`,
`CODEBASE_MAP.md`, `CLAUDE.md`, `project-manifest.json`, `.claude/`,
`symphony_clone/`, `harness-lite/`, `docs/`, and representative tests in `test/`.

Organize the wiki around these questions:

1. What does the Claude Harness Engine provide, and which SKU should a user load?
2. How do `/scaffold`, `/build`, `/feature`, `/auto`, `/gate`, and brownfield work relate?
3. Which scripts, hooks, state files, and quality gates enforce the harness loop?
4. How are telemetry, tests/evals, packaging, and the Symphony orchestrator structured?
5. Where should a future coding agent start for a requested change, and what invariants must it preserve?

Include concise architecture, execution-flow, configuration, testing, and extension
pages. Link to source files using repository-relative paths. Avoid documenting
generated fixtures in detail unless they explain an important contract.

Treat the wiki as a context graph, not a set of isolated summaries. Give every
substantive page a descriptive `type`, `title`, `description`, and useful `tags`.
Create explicit Markdown links between pages whenever one consumes, enforces,
tests, configures, or operationalizes another. Prefer repository-relative paths
in backticks when citing source files, directories, commands, or artifacts: the
context-graph generator turns those verified references into navigable source
nodes. Create focused pages for independently changing subsystems rather than
burying those relationships in a broad catch-all page.
