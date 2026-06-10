---
name: code-map
description: Build a deterministic dependency graph of an existing codebase. AST-first for Python and React/JS/TS (stdlib ast + tree-sitter wheels — symbols with line ranges, routes, components, hooks, call/render edges, god-file skeletons, incremental --files patching); regex fallback for C#, Java, Go. Outputs JSON + ranked symbol map + Mermaid + metrics for downstream brownfield, refactor, and seam-finder skills.
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

1. **Vendored AST indexer** (preferred for Python / React / JS / TS repos) — `scripts/code_index/code_index.py`. Python parses with stdlib `ast` (zero deps); JS/JSX/TS/TSX parse with the `tree-sitter` + `tree-sitter-typescript` + `tree-sitter-javascript` pip wheels (prebuilt, no compiler). Emits per-file symbol records with exact line ranges and signatures, FastAPI/Flask + React Router routes, React components and their hooks, confidence-tagged cross-file call edges, `renders` edges, tsconfig-alias-resolved imports with `import type` flagged, god-file skeletons, and supports `--files` incremental patching. If the wheels are missing, install them (`pip3 install tree-sitter tree-sitter-typescript tree-sitter-javascript`); Python-only repos index with no third-party packages at all.
2. **Understand-Anything knowledge graph** — only if `.understand-anything/knowledge-graph.json` already exists, import it with `scripts/import_understand_graph.js` (preserves call/inheritance/read-write edges that plugin emitted).
3. **Vendored regex script** — `scripts/build_graph.js`, zero npm dependencies. Use it for C#, Java, and Go repos, or when no `python3` is available. Fidelity: imports + top-level symbols only (regex), no call graph, no JSX semantics.

Report which producer ran in `code-graph.meta.json` (`vendored-ast`, `understand-anything`, or `vendored`).

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
    "producer": "vendored-ast | understand-anything | vendored",
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
  PRODUCER=vendored-ast        # tree-sitter wheels needed only for JS/TS files
elif test -f .understand-anything/knowledge-graph.json; then
  PRODUCER=understand-anything
else
  PRODUCER=vendored            # regex fallback (also for C#/Java/Go repos)
fi
```

Preferred — the AST indexer (writes `code-graph.json`, `code-graph.meta.json`, and skeletons):

```bash
python3 .claude/skills/code-map/scripts/code_index/code_index.py \
  --root . --out specs/brownfield/code-graph.json \
  --skeleton-dir specs/brownfield/skeletons
```

If it fails on a JS/TS repo with `ModuleNotFoundError`, install the wheels and retry:
`pip3 install tree-sitter tree-sitter-typescript tree-sitter-javascript`.

To import an existing Understand-Anything graph instead:

```bash
node .claude/skills/code-map/scripts/import_understand_graph.js \
  --in .understand-anything/knowledge-graph.json \
  --out specs/brownfield/code-graph.json
```

Regex fallback (C#/Java/Go, or no `python3`):

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
| Java / C# / Go | not covered — use the regex fallback | imports + package/namespace + top-level types |

Understand-Anything imports (`.understand-anything/knowledge-graph.json`) preserve whatever call/inheritance/read-write edges that plugin emitted; the adapter does not invent missing edges.

---

## Consumers

Downstream skills should treat `code-graph.json` as the source of truth for structural questions:

| Skill | What it reads |
|---|---|
| `/brownfield` | All artifacts; cites edge evidence in `architecture-map.md` and `risk-map.md` |
| any agent editing code | `symbol-map.md` for navigation; `skeletons/` + `Read(offset, limit)` for god files |
| `/seam-finder` | `code-graph.json` only; computes seam scores from edges + CRUD edges if available |
| `/refactor` | `coupling-report.md` to identify hubs and unstable modules |
| `/change` | `code-graph.json` to enumerate downstream consumers of a changed symbol |
| `planner` agent | All four; preserves existing public interfaces it sees |
| `generator` agent | `code-graph.json` to avoid creating parallel implementations |

---

## Gotchas

- **Do not call this skill on greenfield projects.** It is for existing codebases. On an empty repo it produces a useless empty graph.
- **Do not edit the JSON by hand.** Re-run the skill to refresh.
- **Understand-Anything imports are source-of-truth preserving.** If its graph omits calls or symbol references, fix or re-run that producer instead of filling gaps manually.
- **Stale graphs lie.** Re-run after large refactors. The skill is fast (under 30s for most repos under 5k files).
- **Hook refresh scope.** The `graph-refresh.js` Stop/SubagentStop hook patches `code-graph.json` and re-renders `symbol-map.md` only — `dependency-graph.md` and `coupling-report.md` are **not** refreshed incrementally and go stale after per-session edits. Re-run `/code-map` (Steps 2–3) when you need those two current.
- **Vendor directories.** Skip `node_modules`, `.venv`, `venv`, `dist`, `build`, `target`, `vendor`, `.git`. The script does this by default but custom layouts may need `--exclude`.
- **Generated code.** Treat generated files (`*.pb.go`, `*.generated.ts`, `migrations/`) as nodes, but flag them in the coupling report so refactors do not target them.
- **Cycles are not always bugs.** Some frameworks expect circular package dependencies. Report them; do not auto-break them.
