---
name: context
description: Build a bounded, cited context pack from the living DeepWiki/code-map before broad source reads. Use in brownfield lanes and whenever source orientation could otherwise require large file reads.
argument-hint: "\"question\" [--budget N]"
context: fork
---

# Context Pack

Use `/context` to retrieve exact files and line ranges from the current
DeepWiki/code-map before reading source broadly.

## Command

```bash
node .claude/scripts/context-pack.js "$ARGUMENTS"
```

Optional flags:

```bash
node .claude/scripts/context-pack.js --budget 1600 "$ARGUMENTS"
node .claude/scripts/context-pack.js --diff --budget 1600 "$ARGUMENTS"
node .claude/scripts/context-pack.js --depth 2 --diff --budget 1600 "$ARGUMENTS"
node .claude/scripts/context-pack.js --no-receipt --budget 1600 "$ARGUMENTS"
```

Unified facade (pack + graph + impact + semantic + co-change + refresh):

```bash
node .claude/scripts/nav-query.js pack --budget 1600 "$ARGUMENTS"
node .claude/scripts/nav-query.js symbol validateSession
node .claude/scripts/nav-query.js callers py:src/auth/session.py
node .claude/scripts/nav-query.js impact --files src/auth/session.py
node .claude/scripts/nav-query.js cochange src/auth/session.py
node .claude/scripts/nav-query.js semantic "session validation"
node .claude/scripts/nav-query.js refresh   # TF-IDF index + co-change + concept pages
```

Optional MCP: merge `.claude/templates/mcp-nav.snippet.json` into `.mcp.json`
before long runs (tools: `nav_pack`, `nav_symbol`, `nav_callers`, `nav_impact`,
`nav_cochange`, `nav_semantic`).

| Flag | Meaning |
|------|---------|
| `--budget N` | Max estimated pack tokens (default 1200) |
| `--diff` | Boost files from git status + graph dirty list |
| `--depth N` | Graph neighbor expansion depth (default 2) |
| `--root DIR` | Project root (default cwd) |
| `--json-out PATH` | Also write the pack JSON to PATH |
| `--no-receipt` | Do not write `.claude/state/context-pack-last.json` |

## Reading The Result (schema v2)

The JSON result contains:

- `schema_version`: `2`
- `status`: `ok`, `low_confidence`, `no_match`, `missing`, or `placeholder`
- `confidence` / `confidence_reasons`: how safe it is to act without clarifying
- `results[]`: cited file paths, line ranges, symbols, reasons, scores, sources
- `read_next[]`: exact source reads to perform next
- `task_map`: `edit_candidates`, `must_not_break`, `tests_to_run`, `clusters`, `clarify_options`
- `estimated_tokens`: approximate context-pack size
- `fallback`: when narrow `rg` is allowed
- `warnings[]`: stale/missing/no-match guidance

A successful run also writes `.claude/state/context-pack-last.json` (session
receipt). `token_governor.context_search_required` uses that receipt so agents
are steered to pack before production source reads.

## Rules

- Read the `read_next` ranges before reading entire files.
- Prefer `task_map` over front-loading brownfield essays.
- If `status` is `placeholder`, use the planned component map until source exists.
- If `status` is `missing`, run `/code-map` or `/brownfield`.
- If `status` is `no_match` or `low_confidence`, use `task_map.clarify_options`
  or one narrow `rg`, then re-pack if you find source that was not indexed.
- Change-family skills (`/change`, `/feature`, `/refactor`, `/vibe`) require this
  pack when a real code-graph exists — see their Context-first Iron Law.
