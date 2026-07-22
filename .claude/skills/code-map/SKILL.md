---
name: code-map
description: "[Internal pipeline stage — run by /brownfield and /seam-finder; invoke directly only as a power user.] Build a deterministic dependency graph of an existing codebase. AST-first for Python, React/JS/TS, and Java/C#/Go (stdlib ast + tree-sitter wheels — symbols with line ranges, routes, components, hooks, call/render edges, package-aware import resolution, god-file skeletons, incremental --files patching); regex fallback when python3 or the wheels are unavailable. Outputs JSON + ranked symbol map + Mermaid + metrics for downstream brownfield, refactor, and seam-finder skills."
argument-hint: "[path]"
context: fork
---

# Code Map — Deterministic Dependency Graph

`/code-map` produces a structured, queryable map of the codebase that downstream skills (`/brownfield`, `/seam-finder`, `/refactor`, `/change`) consume instead of free-form grepping.

It is deterministic-first: AST/regex extraction runs without an LLM. The LLM only interprets the artifact afterwards.

## Usage

```text
/code-map
/code-map backend/src
/code-map "."
```

Defaults to the repository root.

---

## Resolution Order

The skill picks the strongest available producer in this order. Stop at the first that succeeds.

1. **Vendored AST indexer** (preferred for Python / React / JS / TS / Java / C# / Go repos) — `scripts/code_index/code_index.py`. Python parses with stdlib `ast` (zero deps); JS/JSX/TS/TSX parse with the `tree-sitter` + `tree-sitter-typescript` + `tree-sitter-javascript` pip wheels (prebuilt, no compiler). Emits per-file symbol records with exact line ranges and signatures, FastAPI/Flask + React Router routes, React components and their hooks, confidence-tagged cross-file call edges, `renders` edges, tsconfig-alias-resolved imports with `import type` flagged, god-file skeletons, and supports `--files` incremental patching. If the wheels are missing, install them (`pip3 install tree-sitter tree-sitter-typescript tree-sitter-javascript`); Python-only repos index with no third-party packages at all.
2. **SCIP index** — preferred for **large or polyglot repos** where the vendored AST is weak, *if* the team already produces a SCIP index with the sourcegraph `scip-*` indexers (scip-python / scip-typescript / scip-java / scip-go / …). Convert it to JSON once (`scip print --json index.scip > index.scip.json`) and import with `scripts/import_scip_graph.js --in index.scip.json`. This consumes the JSON, **not** the protobuf or a live sourcegraph backend, so the producer stays deterministic and offline. Precise cross-file import/call/inherit edges; external (other-package) and function-local symbols are intentionally dropped to keep the internal graph clean.
3. **Understand-Anything knowledge graph** — only if `.understand-anything/knowledge-graph.json` already exists, import it with `scripts/import_understand_graph.js` (preserves call/inheritance/read-write edges that plugin emitted).
4. **Graphify knowledge graph** — only if `graphify-out/graph.json` already exists, i.e. a team already runs [Graphify](https://github.com/Graphify-Labs/graphify) (a third-party, MIT-licensed, tree-sitter-based knowledge-graph tool) themselves. This harness never installs, invokes, or depends on Graphify — no client machine needs it, `init.sh` never mentions it, and it is picked up only as a BYO import, exactly like SCIP and Understand-Anything above. Import with `scripts/import_graphify_graph.js --in graphify-out/graph.json`. Graphify's `graph.json` is NetworkX `node_link_data` (`{nodes, links}`, not `{documents}`/`{nodes, edges}`); the adapter converts only its `imports` / `imports_from` / `calls` / `inherits` relations into harness edges — `contains` and `method` (intra-file structure), `rationale_for` (LLM-derived commit narrative), and `uses` (100%-INFERRED fuzzy reference) are dropped rather than guessed at, and nodes with no `source_file` (external/stdlib symbols) never become graph nodes. Confidence (`EXTRACTED`/`INFERRED`) is preserved in each edge's evidence string. Graphify is pre-1.0 with frequent schema changes (see its release notes) — if `import_graphify_graph.js`'s tests start failing after a Graphify upgrade, the fix is isolated to that one file. **Use this as the fallback for languages the vendored AST cannot parse.** Graphify carries 36 tree-sitter grammars; the adapter maps `.rs` (Rust), `.rb` (Ruby), `.c`/`.h` (C), `.cpp`/`.cc`/`.cxx`/`.hpp`/`.hh`/`.hxx` (C++), `.php`, `.kt`/`.kts` (Kotlin), `.swift`, `.scala`/`.sc`, `.lua`, and `.sql` into graph nodes in addition to the six the vendored AST already handles, so a polyglot repo with those languages gets real coupling edges instead of an empty graph. Genuinely unrecognized extensions are still skipped (warned, not invented).
5. **Vendored regex script** — `scripts/build_graph.js`, zero npm dependencies. Use it only when no `python3` is available (the AST indexer covers C#, Java, and Go via tree-sitter wheels). Fidelity: imports + top-level symbols only (regex), no call graph, no JSX semantics.

Report which producer ran in `code-graph.meta.json` (`vendored-ast`, `scip`, `understand-anything`, `graphify`, or `vendored`).

---

## Outputs

All artifacts go under `specs/brownfield/`. Create the directory if missing.

| File | Contents |
|---|---|
| `code-graph.json` | `{nodes, edges, files, metrics, meta}` — see Schema below. `files` (AST producer only) holds per-file records: content hash, LOC, symbols with line ranges + signatures, routes. |
| `code-graph.meta.json` | producer, language stats, scan warnings, run timestamp |
| `symbol-map.md` | Token-budgeted symbol map (AST producer only): files ranked by fan-in, real signatures with `Lstart-Lend` anchors for `Read(offset, limit)` slicing |
| `skeletons/<path>.skel.md` | Signature-only views of god files (≥ 1500 LOC by default) — navigate huge files without reading them whole |
| `dependency-graph.md` | Mermaid `flowchart LR` rendering of file/module-level edges |
| `coupling-report.md` | Per-file fan-in, fan-out, instability, cycles, hubs without tests |
| `wiki/WIKI.md` + `wiki/pages/*.md` | Navigable, always-current wiki rendered deterministically from `code-graph.json` (no LLM): overview (hubs, entry points, cycles, external deps) linking to bounded per-directory pages with per-symbol `file:line` citations and per-cluster Mermaid. The DeepWiki-grade narrative layer, minus the regeneration cost. This is the harness's default, zero-dependency human-browsing surface — every repo gets it, regardless of which producer ran. |
| `graph-explorer.html` | Single-file, dependency-free **interactive** explorer rendered from `code-graph.json` by `scripts/graph_viewer.js` (presentation + browser logic live in `scripts/graph-viewer-template.html`): a searchable file index ranked by fan-in, a canvas ego-network graph (drag / click-to-recenter / zoom / 1–2 hop) of the focused file's importers + imports, and an inspector with symbols (signatures + line ranges), callers, internal imports, and external deps. Deterministic (path-sorted), theme-aware, opens from `file://` or a static host. Ships like the wiki (a `.gitignore` exception un-ignores it) and is refreshed incrementally by the `graph-refresh` hook. Complements the wiki's read-only narrative with click-through navigation. |
| `graphify-out/graph.html` (bonus, not generated by this skill) | Graphify's own interactive force-directed graph view. Only exists if a team already runs Graphify themselves (see producer 4 above); this harness never generates it. Point humans at it alongside the wiki when present — it is not a replacement for the committed Markdown wiki, which is what every non-Graphify repo still gets. |

---

## Schema

```json
{
  "nodes": [
    {
      "id": "py:backend/src/services/auth.py",
      "kind": "file",
      "language": "python",
      "path": "backend/src/services/auth.py",
      "symbols": ["AuthService", "verify_token", "issue_token"]
    }
  ],
  "edges": [
    {
      "source": "py:backend/src/api/routes.py",
      "target": "py:backend/src/services/auth.py",
      "kind": "imports",
      "evidence": "backend/src/api/routes.py:7 from services.auth import AuthService"
    }
  ],
  "metrics": {
    "files": 142,
    "edges": 318,
    "cycles": [["py:backend/src/a.py", "py:backend/src/b.py"]],
    "hubs": [{"id": "py:backend/src/services/auth.py", "fan_in": 18, "fan_out": 4}]
  },
  "meta": {
    "producer": "vendored-ast | scip | understand-anything | vendored",
    "languages": {"python": 88, "typescript": 54},
    "warnings": [],
    "generated_at": "2026-05-02T12:00:00Z"
  }
}
```

**Edge kinds**: `imports`, `calls`, `renders`, `inherits`, `instantiates`, `reads_from`, `writes_to`. The AST producer emits `imports` (with `import_kind: "type"` flagged and excluded from coupling metrics), confidence-tagged `calls` (`confidence: "extracted"` — only calls to locally-defined or explicitly-imported names; builtins never produce edges), and `renders` (React component usage). The regex fallback emits `imports` only.

**Node kinds**: `file`, `module`, `class`, `function`, `external`. The vendored script emits `file` + `external` by default; symbol-level nodes appear when AST extraction succeeds.

---

## Steps

### Step 1 — Detect Producer

```bash
# Pseudocode — Claude evaluates these in order.
if python3 -c "import ast" 2>/dev/null; then
  PRODUCER=vendored-ast        # tree-sitter wheels needed for non-Python files
elif test -f .understand-anything/knowledge-graph.json; then
  PRODUCER=understand-anything
elif test -f graphify-out/graph.json; then
  PRODUCER=graphify            # only if the team already runs Graphify themselves
else
  PRODUCER=vendored            # regex fallback (no python3 at all)
fi
```

Preferred — the AST indexer (writes `code-graph.json`, `code-graph.meta.json`, and skeletons):

```bash
python3 .claude/skills/code-map/scripts/code_index/code_index.py \
  --root . --out specs/brownfield/code-graph.json \
  --skeleton-dir specs/brownfield/skeletons
```

If it fails on a JS/TS repo with `ModuleNotFoundError`, install the wheels and retry:
`pip3 install tree-sitter tree-sitter-typescript tree-sitter-javascript tree-sitter-java tree-sitter-c-sharp tree-sitter-go`.

To import an existing Understand-Anything graph instead:

```bash
node .claude/skills/code-map/scripts/import_understand_graph.js \
  --in .understand-anything/knowledge-graph.json \
  --out specs/brownfield/code-graph.json
```

To import an existing Graphify graph instead (only if `graphify-out/graph.json` already exists — never install or run Graphify to produce it):

```bash
node .claude/skills/code-map/scripts/import_graphify_graph.js \
  --in graphify-out/graph.json \
  --out specs/brownfield/code-graph.json
```

Regex fallback (no `python3`):

```bash
node .claude/skills/code-map/scripts/build_graph.js \
  --root . --out specs/brownfield/code-graph.json
```

### Step 1.5 — Render the Symbol Map (AST producer only)

```bash
python3 .claude/skills/code-map/scripts/code_index/code_index.py \
  --render-map specs/brownfield/code-graph.json \
  --out specs/brownfield/symbol-map.md --map-budget 4000
```

This is the agent-facing navigation artifact: files ranked by fan-in, real signatures, `Lstart-Lend` anchors. Read a single symbol out of any file — god files included — with `Read(offset=START, limit=END-START+1)`; never read a skeleton-flagged file whole.

### Step 2 — Render

```bash
node .claude/skills/code-map/scripts/build_graph.js \
  --render-mermaid specs/brownfield/code-graph.json \
  --out specs/brownfield/dependency-graph.md
```

Limit the rendered graph to ≤ 80 nodes for readability. If the graph is larger, render only the top hubs (by fan-in) and their immediate neighbours, and add a note pointing to `code-graph.json` for the full graph.

### Step 3 — Coupling Report

```bash
node .claude/skills/code-map/scripts/build_graph.js \
  --coupling-report specs/brownfield/code-graph.json \
  --out specs/brownfield/coupling-report.md
```

The report lists:
- Cycles (each cycle named, with file paths)
- Top 10 hubs by fan-in with their tests / lack thereof
- Files with `instability = fan_out / (fan_in + fan_out) > 0.8` and `fan_in > 5` (unstable hubs — refactor candidates)
- Files with no inbound edges and no test coverage (dead code candidates)

### Step 3.5 — Render the Wiki + Query the Graph + Secondary Nav

Render the deterministic, always-current wiki (no LLM, instant — re-render any time the graph changes):

```bash
node .claude/skills/code-map/scripts/code_wiki.js render \
  --graph specs/brownfield/code-graph.json \
  --out specs/brownfield/wiki
```

Refresh secondary navigation (TF-IDF, inverted graph index, co-change, concepts, lean maps):

```bash
node .claude/scripts/nav-query.js refresh
```

Writes `wiki/WIKI.md` (overview + page index) and `wiki/pages/*.md` (one bounded page per directory cluster, each with `file:line` symbol citations and a per-cluster Mermaid). Pages cap at `--max-pages` (default 20); the overview notes any overflow. The `graph-refresh` hook re-renders this automatically after AST-graph patches, so it tracks `main` per-turn rather than lagging.

Instead of grepping or reading the six brownfield essays, answer structural questions deterministically off the same graph:

```bash
node .claude/skills/code-map/scripts/code_wiki.js query --graph specs/brownfield/code-graph.json --callers <id>
node .claude/skills/code-map/scripts/code_wiki.js query --graph specs/brownfield/code-graph.json --calls <id>
node .claude/skills/code-map/scripts/code_wiki.js query --graph specs/brownfield/code-graph.json --symbol <name>
node .claude/skills/code-map/scripts/code_wiki.js query --graph specs/brownfield/code-graph.json --module <id>
node .claude/skills/code-map/scripts/code_wiki.js query --graph specs/brownfield/code-graph.json --hubs
node .claude/skills/code-map/scripts/code_wiki.js query --graph specs/brownfield/code-graph.json --cycles
```

Each returns JSON with `file:line` evidence — the "ask the code-map" layer `/change` and `/refactor` use to enumerate blast radius without re-reading source.

### Step 4 — Verify

After running, sanity-check:

- `code-graph.json` exists and parses
- `meta.producer` is set
- `nodes` is non-empty (otherwise the path is wrong or no language was detected)
- Warnings array is reviewed; large warning counts mean fall back fidelity

If `nodes` is empty or all warnings, stop and report. Do not invent a graph from filenames.

---

## Language Coverage Matrix

| Language | AST indexer (`code_index.py`) | Regex fallback (`build_graph.js`) |
|---|---|---|
| Python | full: imports, classes/functions with line ranges + signatures + docstrings, FastAPI/Flask routes, confidence-tagged call edges (stdlib `ast`, zero deps) | imports + classes + functions |
| JavaScript / JSX | full: imports (alias-resolved), components, hooks, `renders` edges, React Router routes (tree-sitter wheel) | imports + top-level symbols; no JSX semantics |
| TypeScript / TSX | same as JSX, plus `import type` flagged and excluded from coupling metrics (tree-sitter wheel) | imports + top-level symbols; `import type` counted as coupling |
| Java / C# / Go | types with method children + line ranges, package/namespace declarations, package-aware import edges (Java fq-type, C# namespace, Go module-path; tree-sitter wheels) | imports + package/namespace + top-level types |

Understand-Anything imports (`.understand-anything/knowledge-graph.json`) preserve whatever call/inheritance/read-write edges that plugin emitted; the adapter does not invent missing edges.

For languages outside this matrix (Rust, Ruby, C/C++, PHP, Kotlin, Swift, Scala, Lua, SQL), neither the AST indexer nor the regex fallback produces symbol-level edges. If the team already runs Graphify (producer 4), its `graph.json` import is the way to get real coupling edges for those languages — the `import_graphify_graph.js` adapter maps their extensions to graph nodes. The harness still never installs or runs Graphify itself.

---

## Consumers

Downstream skills should treat `code-graph.json` as the source of truth for structural questions:

| Skill | What it reads |
|---|---|
| `/brownfield` | All artifacts; cites edge evidence in `architecture-map.md` and `risk-map.md` |
| any agent editing code | `symbol-map.md` for navigation; `skeletons/` + `Read(offset, limit)` for god files |
| `/seam-finder` | `code-graph.json` only; computes seam scores from edges + CRUD edges if available |
| `/refactor` | `coupling-report.md` to identify hubs and unstable modules |
| `/change` | `code-graph.json` (or `code_wiki.js query --callers/--symbol`) to enumerate downstream consumers of a changed symbol |
| any human / agent orienting in the repo | `wiki/WIKI.md` + `code_wiki.js query` — navigable overview and deterministic "ask the code-map" without reading source |
| `planner` agent | All four; preserves existing public interfaces it sees |
| `generator` agent | `code-graph.json` to avoid creating parallel implementations |

---

## Gotchas

- **Do not call this skill on greenfield projects.** It is for existing codebases. On an empty repo it produces a useless empty graph.
- **Do not edit the JSON by hand.** Re-run the skill to refresh.
- **Understand-Anything imports are source-of-truth preserving.** If its graph omits calls or symbol references, fix or re-run that producer instead of filling gaps manually.
- **Never install Graphify.** It is a bring-your-own producer, not a harness dependency: do not add it to `init.sh`, do not suggest `pip install`/`uv tool install graphifyy` as part of any harness flow, and do not run the `graphify` CLI or its MCP server on the user's behalf. Only import `graphify-out/graph.json` if it already exists in the repo.
- **Stale graphs lie.** Re-run after large refactors. The skill is fast (under 30s for most repos under 5k files).
- **Hook refresh scope.** The `graph-refresh.js` Stop/SubagentStop hook patches `code-graph.json` and re-renders `symbol-map.md` only — `dependency-graph.md` and `coupling-report.md` are **not** refreshed incrementally. The hook stamps both with a `> STALE since <timestamp>` banner the moment the graph is patched; if a file you are about to use for planning starts with that banner, re-run `/code-map` (Steps 2–3) first instead of trusting it.
- **Vendor directories.** Skip `node_modules`, `.venv`, `venv`, `dist`, `build`, `target`, `vendor`, `.git`. The script does this by default but custom layouts may need `--exclude`.
- **Generated code.** Treat generated files (`*.pb.go`, `*.generated.ts`, `migrations/`) as nodes, but flag them in the coupling report so refactors do not target them.
- **Cycles are not always bugs.** Some frameworks expect circular package dependencies. Report them; do not auto-break them.
- **The wiki is a committed, living artifact under `/feature`.** When `/feature` runs the change route, `specs/brownfield/wiki/` is committed to the repo (it is not gitignored) and refreshed incrementally per change via `--files` patching + the `graph-refresh` hook — never fully rebuilt except on first run or after a massive refactor. The updated wiki ships in the same PR as the code, so the doc and code move together.
