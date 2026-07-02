# Token Usage Optimizer Design

## Purpose

Token Usage Optimizer reduces Claude Code Enterprise spend by making the harness
intentional about what context reaches the model. It builds on Token Governor v1
(`docs/token-governor.md`), which already keeps a living DeepWiki/code-map fresh
from `/scaffold` onward.

The optimizer has three layers:

1. **Navigation Optimizer** — living DeepWiki/code-map and freshness status.
2. **Context Access Optimizer** — bounded, cited context packs before source reads.
3. **Tool Output Optimizer** — compact test/log/tool output with full artifacts
   preserved on disk.
4. **Local CCR Optimizer** — Compress-Cache-Retrieve storage for compacted
   output, with raw originals retrievable by hash.

The navigation, context-pack, tool-output, and local CCR foundations are
implemented. Advisory hook warnings are implemented for broad reads and likely
verbose commands. Hard blocking remains future work.

## Goals

- Reduce input tokens from broad source reads, repeated repo orientation, and
  verbose tool output.
- Keep every optimization auditable: source citations, preserved raw artifacts,
  and visible `/status` metrics.
- Preserve correctness gates. The optimizer may shorten context, but it must not
  hide failing tests, security findings, or final diffs.
- Work in greenfield and brownfield projects without requiring a proxy, hosted
  service, vector database, or third-party token middleware.

## Non-Goals

- No Claude traffic proxy in the default implementation.
- No lossy compression of source files or final PR diffs.
- No embeddings in v1 of the context-access layer. Deterministic graph/wiki
  retrieval comes first; embeddings can be added later if recall is insufficient.
- No hard blocking by default. Enforcement starts as advisory.

## Current State

Implemented:

- `/scaffold` creates placeholder navigation for empty greenfield repos.
- `/scaffold` builds a lean initial code-map/wiki for source-bearing repos.
- `verify-on-save` marks indexed source files dirty after edits.
- `graph-refresh` upgrades placeholder graphs on first source write, patches
  `code-graph.json`, re-renders `symbol-map.md`, and re-renders the deterministic
  DeepWiki.
- `/status` surfaces navigation freshness and conservative token-savings
  estimates.
- `project-manifest.json#token_governor` ships default advisory config.
- `context-pack.js` and `/context` produce bounded, cited source-read packs from
  the living graph/wiki.
- `tool-output-pack.js` stores raw command output, extracts failure evidence, and
  emits compact packs with token-savings estimates.
- `context-store.js` stores raw context by stable hash under
  `.claude/state/context-cache/`.
- `context-retrieve.js` retrieves cached originals, optionally narrowed by query.
- `run-compact.js` executes commands, stores raw output in CCR, and emits the
  compact failure-preserving pack.
- `search-compact.js` emits grouped search results while storing the full result
  set in CCR.
- `token-advisor.js` runs as a PreToolUse advisory hook for `Read|Bash`,
  recording `broad_source_read` and `verbose_command` warnings without blocking.

Not implemented:

- Hard broad-read enforcement.
- Automatic command-output replacement; the hook suggests `run-compact.js` but
  does not rewrite commands.
- Token-savings telemetry beyond local `/status` and pack-level estimates.

## Architecture

### 1. Navigation Optimizer

Navigation Optimizer is the existing Token Governor v1.

Artifacts:

- `specs/brownfield/code-graph.json`
- `specs/brownfield/code-graph.meta.json`
- `specs/brownfield/symbol-map.md`
- `specs/brownfield/wiki/WIKI.md`
- `specs/brownfield/wiki/pages/*.md`
- `.claude/state/navigation-status.json`

Runtime:

- `.claude/scripts/navigation-refresh.js`
- `.claude/hooks/verify-on-save.js`
- `.claude/hooks/graph-refresh.js`
- `.claude/scripts/pipeline-status.js`

Contract:

- Agents start with DeepWiki and symbol-map navigation.
- Agents read exact line ranges when line ranges exist.
- Full `/code-map` refresh remains the path for heavier derived reports such as
  `dependency-graph.md` and `coupling-report.md`.

### 2. Context Access Optimizer

Context Access Optimizer turns navigation artifacts into bounded context packs.

Command:

```bash
node .claude/scripts/context-pack.js "<question>"
```

Skill wrapper:

```text
/context "where is session validation handled?"
```

Inputs:

- user question
- `code-graph.json`
- `symbol-map.md`
- `wiki/WIKI.md`
- `wiki/pages/*.md`
- optional changed files from git diff
- optional active story/design component map

Output:

```json
{
  "question": "where is session validation handled?",
  "status": "ok",
  "budget_tokens": 1200,
  "estimated_tokens": 640,
  "results": [
    {
      "path": "src/auth/session.ts",
      "start": 41,
      "end": 88,
      "symbol": "validateSession",
      "reason": "symbol and wiki page match session validation",
      "confidence": "high"
    }
  ],
  "read_next": [
    "Read src/auth/session.ts lines 41-88"
  ],
  "warnings": []
}
```

Retrieval strategy:

1. Exact symbol match from `code_wiki.js query --symbol`.
2. Module/page match from wiki page headings and citations.
3. BM25-style lexical scoring over symbol names, signatures, file paths, and wiki
   text.
4. Graph expansion to direct callers/callees/import neighbors, capped by budget.
5. Final ranking by symbol match, graph proximity, changed-file relevance, and
   test proximity.

The result must be citation-first. It should return path and line ranges, not
large source bodies, unless explicitly requested with a small token budget.

### 3. Tool Output Optimizer

Tool Output Optimizer compacts verbose command output before it becomes repeated
agent context.

Script:

```bash
node .claude/scripts/tool-output-pack.js --kind test --in <raw.log> --out <pack.json>
```

Supported kinds:

- `test`
- `lint`
- `typecheck`
- `ci`
- `security`
- `generic-log`

Rules:

- Preserve failing test names, stack traces, file paths, line numbers, commands,
  exit code, and first/last relevant output windows.
- Collapse repeated lines.
- Summarize passing test blocks.
- Preserve full raw output under `specs/test_artefacts/raw/` or `.claude/state/tool-output/`.
- Never compress final PR diffs, source files, or security findings below the
  finding granularity.

Output:

```json
{
  "kind": "test",
  "command": "npm test",
  "exit": 1,
  "raw_path": ".claude/state/tool-output/2026-07-02T120000Z-npm-test.log",
  "estimated_raw_tokens": 18000,
  "estimated_pack_tokens": 2200,
  "estimated_saved_tokens": 15800,
  "summary": "3 failing tests, 914 passing",
  "failures": [
    {
      "name": "auth rejects expired token",
      "path": "test/auth.test.ts",
      "line": 52,
      "message": "expected 401, got 200"
    }
  ]
}
```

### 4. Local CCR Optimizer

Local CCR is the scaffold-native version of Headroom's reversible compression
pattern. It does not proxy Claude traffic. Instead, it targets the highest-token
local inputs before they become agent context: command output, logs, search
results, and broad local artifacts.

Compress-Cache-Retrieve contract:

1. Store raw content under `.claude/state/context-cache/<hash>.raw`.
2. Store metadata under `.claude/state/context-cache/<hash>.json`.
3. Return compact content with `context_hash`, `raw_path`, token estimates, and a
   retrieval command.
4. Retrieve full or query-filtered raw content on demand.

Scripts:

```bash
node .claude/scripts/context-retrieve.js <hash> --query "auth token"
node .claude/scripts/run-compact.js --kind test -- npm test
node .claude/scripts/search-compact.js --pattern "validateSession" --glob "src/*.ts"
```

This keeps compression reversible while avoiding a local provider proxy. Source
code is still handled by cited line ranges from `context-pack.js`; the CCR layer
does not lossy-compress source bodies by default.

### 5. Policy And Enforcement

Manifest defaults:

```json
{
  "token_governor": {
    "enabled": true,
    "mode": "advisory",
    "living_navigation": true,
    "context_search_required": true,
    "max_source_read_lines": 300,
    "tool_output_token_estimates": true,
    "compress_tool_output": true,
    "ccr_enabled": true,
    "preserve_full_outputs": true,
    "budget_warn_pct": 80
  }
}
```

Modes:

- `off`: no optimizer checks beyond normal navigation files.
- `advisory`: report savings and warnings, never block.
- `enforced`: block avoidable broad reads and require context packs for
  brownfield lanes.

Initial enforcement should be narrow:

- Warn when a file over `max_source_read_lines` is read while a symbol-map range
  exists. Implemented by `.claude/hooks/token-advisor.js` as
  `broad_source_read`.
- Warn when likely verbose `Bash` commands such as `npm test`, `pytest`, `tsc`,
  or build commands are run directly while `compress_tool_output` is enabled.
  Implemented by `.claude/hooks/token-advisor.js` as `verbose_command`.
- Warn when `/feature`, `/change`, or `/refactor` proceeds with stale navigation.
- Block only in `enforced` mode, and only when a deterministic alternative is
  available.

## Data Flow

Greenfield:

```text
/scaffold
  -> placeholder graph/wiki
/brd, /spec, /design
  -> planned component map only, no fake code graph
/auto writes first source
  -> verify-on-save marks dirty
  -> graph-refresh bootstraps real graph/wiki
/status
  -> freshness + estimated savings
```

Brownfield:

```text
/scaffold
  -> lean initial code-map/wiki
/feature request
  -> context-pack retrieves bounded paths/ranges
  -> agent reads exact ranges
  -> edits mark dirty
  -> graph-refresh patches graph/wiki
/gate
  -> navigation must be fresh or explicitly waived
```

Tool output:

```text
command runs
  -> raw output stored in CCR
  -> output pack generated
  -> agent receives pack first
  -> raw output remains available via context-retrieve
```

## Metrics

Local status:

- `navigation.status`
- `navigation.source_files`
- `navigation.indexed_files`
- `navigation.dirty_files`
- `estimated_source_tokens`
- `estimated_navigation_tokens`
- `estimated_context_query_tokens`
- `estimated_tokens_saved_per_orientation`
- `context_cache.entries`
- `context_cache.estimated_saved_tokens`
- `token_advisor.warnings`
- `token_advisor.by_kind`

Future telemetry:

- `harness_context_pack_requests_total`
- `harness_context_pack_tokens_estimated`
- `harness_context_pack_tokens_saved_estimated`
- `harness_tool_output_raw_tokens_estimated`
- `harness_tool_output_pack_tokens_estimated`
- `harness_tool_output_tokens_saved_estimated`
- `harness_context_cache_entries_total`
- `harness_context_retrieve_requests_total`
- `harness_broad_read_warnings_total`
- `harness_verbose_command_warnings_total`
- `harness_navigation_stale_warnings_total`

All savings are estimates unless native Claude Code token metrics are available
through OTEL. Estimated values must be labelled as estimates in UI and docs.

## Safety

- Every compressed or packed artifact points to the raw source or raw output.
- Final review agents read diffs directly, not compressed summaries.
- Security scans preserve every finding with file, line, rule, severity, and
  message.
- A context pack with low confidence must say so and recommend exact next
  queries rather than pretending to be complete.
- Missing or failed optimizer steps fail open in advisory mode and fail with a
  clear remediation in enforced mode.

## Implementation Plan

### Phase 1 — Context Packs

Files:

- `.claude/scripts/context-pack.js`
- `.claude/skills/context/SKILL.md`
- `test/context-pack.test.js`

Status: implemented.

Acceptance:

- Given a symbol query, returns exact path/line citations from `code-graph.json`.
- Given a fuzzy module query, returns ranked wiki/symbol candidates.
- Caps output by token budget.
- Reports stale or missing navigation clearly.

### Phase 2 — Tool Output Packs

Files:

- `.claude/scripts/tool-output-pack.js`
- optional `.claude/hooks/lib/output-pack.js`
- `test/tool-output-pack.test.js`

Status: implemented as a standalone script. Hook integration is still pending.

Acceptance:

- Compacts test output while preserving failures and stack traces.
- Stores raw output path.
- Estimates raw/packed/saved tokens.
- Does not compress final diffs or source files.

### Phase 3 — Local CCR And Compact Wrappers

Files:

- `.claude/scripts/context-store.js`
- `.claude/scripts/context-retrieve.js`
- `.claude/scripts/run-compact.js`
- `.claude/scripts/search-compact.js`
- `test/context-store.test.js`
- `test/context-compact-wrappers.test.js`

Status: implemented.

Acceptance:

- Stores raw content by hash and writes retrievable metadata.
- Retrieves full raw content or query-filtered matching lines.
- Runs commands through `run-compact.js` with raw output preserved in CCR.
- Groups search results through `search-compact.js` while keeping full raw
  results available.

### Phase 4 — Status And Advisory Telemetry

Files:

- `.claude/scripts/pipeline-state-readers.js`
- `.claude/scripts/pipeline-status.js`
- `.claude/hooks/token-advisor.js`
- `.claude/scripts/telemetry-memory.js`
- telemetry dashboards

Status: local `/status` reporting and advisory hook warnings are implemented.
External Prometheus telemetry remains future work.

Acceptance:

- `/status` shows context-pack and tool-output savings.
- `/status` shows context-cache entries and token-advisor warning counts.
- `token-advisor.js` warns, but never blocks, on `broad_source_read` and
  `verbose_command` opportunities.
- Prometheus memory metrics include estimated optimizer savings when telemetry
  is enabled.

### Phase 5 — Advisory Policy Expansion

Files:

- `.claude/hooks/pre-bash-gate.js`
- `.claude/hooks/pre-write-gate.js`
- relevant lane skills

Acceptance:

- Warns on avoidable broad source reads.
- Warns on stale navigation before brownfield planning.
- No blocking unless `token_governor.mode` is `enforced`.

### Phase 6 — Enforced Mode

Acceptance:

- Blocks broad reads only when an exact symbol-map/context-pack alternative is
  available.
- Provides the replacement command or exact line range in the block message.
- Allows explicit waiver with evidence.

## Open Questions

- Should `/context` be a user-facing command or an internal skill invoked by
  `/feature`, `/change`, and `/refactor`?
- Should context packs include small source snippets by default, or citations
  only?
- Where should raw tool output live for projects with strict artifact hygiene:
  `.claude/state/tool-output/` or `specs/test_artefacts/raw/`?
- What is the first enforcement threshold: 300 lines, 500 lines, or based on
  estimated tokens?

## Recommendation

Build enforced mode last. Context packs, standalone tool-output packs, local CCR,
`/status` visibility, and initial advisory warnings now exist; the next
highest-leverage step is expanding advisory coverage and Prometheus telemetry
before any hard blocking.
