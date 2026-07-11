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

1. Run a **context pack** (preferred) or read `specs/brownfield/wiki/WIKI.md` /
   use a graph/wiki query.
2. Read `specs/brownfield/symbol-map.md` for exact line ranges when needed.
3. Read only the cited source range from `read_next`.
4. Avoid whole-file reads when the symbol map or pack has a smaller range.

### Context-first Iron Law

When `specs/brownfield/code-graph.json` is a real (non-placeholder) graph,
change-family skills (`/feature`, `/change`, `/refactor`, `/vibe`) must run:

```bash
node .claude/scripts/context-pack.js --diff --budget 1600 "<request>"
```

before broad production source reads or unconstrained repo-wide search. The pack
returns schema v2 JSON: citations, `task_map`, `confidence`, and writes a session
receipt to `.claude/state/context-pack-last.json`.

Low confidence / multi-cluster packs should clarify or re-pack after one narrow
`rg` — not open a multi-file exploration loop. See
[proposals/context-first-navigation.md](proposals/context-first-navigation.md).

`project-manifest.json#token_governor` controls the default policy:

| `mode` | Behavior |
|--------|----------|
| `off` | no-op |
| `advisory` (default) | warn + jsonl; never blocks |
| `enforced` | same predicates → block + exit 2 when a deterministic alternative exists |

| Key | Behavior |
|-----|----------|
| `context_search_required` | When true (scaffold default), warn/block production source `Read`s that lack a fresh context-pack receipt |
| `context_pack_receipt_max_age_ms` | Receipt freshness window (default 4h) |
| `max_source_read_lines` | Broad whole-file read threshold when symbol ranges exist |

**Fail open** when the code-graph lacks symbol ranges, the graph is missing/
placeholder, or paths are outside the project. Escape hatches:
`token_governor.enabled: false`, `mode: off`, or env `HARNESS_TOKEN_GOVERNOR=off`.

Enterprise org policy may set `enforced`; product scaffolds still ship
`advisory` so greenfield installs are not surprise-blocked. See
[token-cost-playbook.md](token-cost-playbook.md).

`/status` reports navigation freshness and an estimated token saving per
orientation:

```text
Navigation: fresh · graph=fresh · wiki=fresh · indexed=42/42 · dirty=0 · ~4200 tokens saved/orientation
```

The estimate is intentionally conservative. It compares an approximate source
corpus read with a bounded navigation query, not with the full generated wiki.

`token-advisor.js` runs as a `Read|Bash` PreToolUse hook. In advisory mode it
warns when:

- `context_search_required` and a production source `Read` has no fresh
  context-pack receipt (`kind: context_search_skipped`)
- a large source read has symbol-map ranges available (`kind: broad_source_read`)
- likely verbose test/lint/build commands could use `run-compact.js`
  (`kind: verbose_command`)

In enforced mode those cases block with a remediation command (never silent
rewrite).

## Commands

Build a bounded source context pack:

```bash
node .claude/scripts/context-pack.js --diff --budget 1600 "where is session validation handled?"
# unified facade:
node .claude/scripts/nav-query.js pack --budget 1600 "where is session validation handled?"
```

or in Claude Code:

```text
/context "where is session validation handled?"
```

Refresh secondary navigation (semantic TF-IDF index, co-change edges, concept pages):

```bash
node .claude/scripts/nav-query.js refresh
```

Optional MCP (same tools as nav-query) — merge `.claude/templates/mcp-nav.snippet.json`
into project `.mcp.json` **before** long agent runs (do not churn MCP mid-session).
The harness monorepo dogfoods this at the repo-root `.mcp.json` (`harness-nav`).

Wiki steering (DeepWiki-style): `.harness/wiki.json` (`repo_notes`, `priority_paths`,
`max_concept_pages`) shapes concept pages under `specs/brownfield/wiki/concepts/`.

Lean brownfield maps (no LLM):

```bash
node .claude/scripts/nav-brownfield-maps.js --goal "add invites"
node .claude/scripts/nav-query.js lean-maps --goal "add invites"
```

Golden navigation benchmark:

```bash
node .claude/scripts/nav-query.js bench
# or: node .claude/scripts/nav-bench.js --golden test/fixtures/nav-bench/golden-queries.json
```

Ambiguity clarify helper:

```bash
node .claude/scripts/nav-query.js clarify "fix token handling"
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
