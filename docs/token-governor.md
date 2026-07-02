# Token Governor

Token Governor is the scaffold's low-token navigation layer. It keeps a
DeepWiki-style wiki and deterministic code graph available from the first
session, then uses those artifacts to steer agents away from broad source reads.

For the broader roadmap that adds context packs, tool-output compression,
enforcement modes, and telemetry metrics, see
[`token-usage-optimizer-design.md`](token-usage-optimizer-design.md).

## Lifecycle

`/scaffold` initializes living navigation in every project:

- Empty greenfield repo: writes a placeholder `specs/brownfield/code-graph.json`,
  `symbol-map.md`, and `wiki/WIKI.md`.
- Existing source-bearing repo: runs a lean initial code-map and wiki render.
- First greenfield source write: the `graph-refresh` Stop/SubagentStop hook
  upgrades the placeholder into a real graph/wiki.
- Later edits: `verify-on-save` marks indexed source files dirty, then
  `graph-refresh` patches the graph, re-renders `symbol-map.md`, and re-renders
  the deterministic wiki once per turn.

`dependency-graph.md` and `coupling-report.md` are heavier derived reports. They
are stamped stale after incremental graph patches and refreshed by a full
`/code-map` run.

## Token-Saving Contract

Agents should navigate in this order:

1. Read `specs/brownfield/wiki/WIKI.md` or use a graph/wiki query.
2. Read `specs/brownfield/symbol-map.md` for exact line ranges.
3. Read only the cited source range.
4. Avoid whole-file reads when the symbol map has a smaller range.

`project-manifest.json#token_governor` controls the default policy. The shipped
default is advisory: it reports status and savings, but does not block work.

`/status` reports navigation freshness and an estimated token saving per
orientation:

```text
Navigation: fresh · graph=fresh · wiki=fresh · indexed=42/42 · dirty=0 · ~4200 tokens saved/orientation
```

The estimate is intentionally conservative. It compares an approximate source
corpus read with a bounded navigation query, not with the full generated wiki.

`token-advisor.js` also runs as a non-blocking `Read|Bash` hook. It warns when a
large source read has symbol-map ranges available, and when likely verbose test,
lint, typecheck, or build commands could use `run-compact.js`.

## Commands

Build a bounded source context pack:

```bash
node .claude/scripts/context-pack.js "where is session validation handled?"
```

or in Claude Code:

```text
/context "where is session validation handled?"
```

Compact a verbose command log while preserving the raw output:

```bash
node .claude/scripts/tool-output-pack.js --kind test --command "npm test" --in raw-test.log
```

Run a command through the local Compress-Cache-Retrieve layer:

```bash
node .claude/scripts/run-compact.js --kind test -- npm test
```

Search with compact grouped results and a retrievable raw result cache:

```bash
node .claude/scripts/search-compact.js --pattern "validateSession" --glob "src/*.ts"
```

Retrieve cached raw context by hash:

```bash
node .claude/scripts/context-retrieve.js <hash> --query "auth token"
```

Tool-output packing and CCR wrappers are explicit commands. The advisory hook
suggests them, but it does not rewrite commands or block work.
