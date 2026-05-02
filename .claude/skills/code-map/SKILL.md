---
name: code-map
description: Build a deterministic dependency graph of an existing codebase (Python, Node, TypeScript, C#, Java, Go). Outputs JSON + Mermaid + metrics for downstream brownfield, refactor, and seam-finder skills.
argument-hint: "[path]"
context: fork
---

# Code Map — Deterministic Dependency Graph

`/code-map` produces a structured, queryable map of the codebase that downstream skills (`/brownfield`, `/seam-finder`, `/refactor`, `/improve`) consume instead of free-form grepping.

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

1. **`graphify` skill** — if installed, invoke `/graphify <path>`. Read its `GRAPH_REPORT.md` plus `.graphify/graph.json` (or equivalent) and project into our schema. Best fidelity for 25 languages.
2. **`hex-graph` MCP** — if the MCP server is available, query its SQLite KG via the `symbol_search`, `references`, and `architecture_overview` tools. Project results into our schema.
3. **Vendored script** — `scripts/build_graph.js` runs deterministic regex extraction with zero npm dependencies (Node stdlib only):
   - **Python** — imports (`import`, `from … import`), classes, functions, **re-exported names** (from `__init__.py` and `__all__`), and a coarse **call graph** (`sym:` edges for non-builtin call sites)
   - **Node / TypeScript** — `import`, `require()`, exports, classes, top-level functions and `const`/`let`/`var`
   - **Java** — `package`, `import`, top-level types
   - **C#** — `using`, `namespace`, top-level types
   - **Go** — `package`, `import`, top-level `func` and `type`

   Trade-off vs a tree-sitter implementation: non-Python call graphs and inheritance edges are not produced. For full fidelity in those languages install `graphify` or `hex-graph` (see above).

Report which producer ran in `code-graph.meta.json`.

---

## Outputs

All artifacts go under `specs/brownfield/`. Create the directory if missing.

| File | Contents |
|---|---|
| `code-graph.json` | `{nodes, edges, metrics, meta}` — see Schema below |
| `code-graph.meta.json` | producer, language stats, scan warnings, run timestamp |
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
    "producer": "vendored | graphify | hex-graph",
    "languages": {"python": 88, "typescript": 54},
    "warnings": [],
    "generated_at": "2026-05-02T12:00:00Z"
  }
}
```

**Edge kinds**: `imports`, `calls`, `inherits`, `instantiates`. Vendored fallback emits at least `imports`; tree-sitter or graphify fill in the rest.

**Node kinds**: `file`, `module`, `class`, `function`, `external`. The vendored script emits `file` + `external` by default; symbol-level nodes appear when AST extraction succeeds.

---

## Steps

### Step 1 — Detect Producer

```bash
# Pseudocode — Claude evaluates these in order.
if command -v graphify &>/dev/null || ls .claude/plugins/*/skills/graphify 2>/dev/null; then
  PRODUCER=graphify
elif test -f .claude/mcp/hex-graph.sqlite || mcp_has_tool hex-graph symbol_search; then
  PRODUCER=hex-graph
else
  PRODUCER=vendored
fi
```

If no MCP/skill is available, run the vendored script:

```bash
node .claude/skills/code-map/scripts/build_graph.js \
  --root "${PATH:-.}" \
  --out specs/brownfield/code-graph.json
```

The script writes both `code-graph.json` and `code-graph.meta.json`.

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

| Language | Vendored fidelity | With tree-sitter | With graphify | With hex-graph |
|---|---|---|---|---|
| Python | imports + classes + functions (regex) | full | full | full |
| Node / JavaScript | imports + classes + funcs + top-level vars (regex) | full | full | full |
| TypeScript | imports + classes + funcs + types + top-level vars (regex) | full | full | full |
| Java | imports + package + types (regex) | full | full | full |
| C# | usings + namespace + types (regex) | full | full | full |
| Go | imports + package + funcs + types (regex) | full | full | full |

"Full" means file + symbol + call + inheritance edges. The vendored regex extractor produces file + import + top-level-symbol fidelity for every supported language. Call-graph and inheritance edges require an external producer. Install `graphify` or `hex-graph` to get them; the skill detects them automatically and projects their output into our schema.

---

## Consumers

Downstream skills should treat `code-graph.json` as the source of truth for structural questions:

| Skill | What it reads |
|---|---|
| `/brownfield` | All four artifacts; cites edge evidence in `architecture-map.md` and `risk-map.md` |
| `/seam-finder` | `code-graph.json` only; computes seam scores from edges + CRUD edges if available |
| `/refactor` | `coupling-report.md` to identify hubs and unstable modules |
| `/improve` | `code-graph.json` to enumerate downstream consumers of a changed symbol |
| `planner` agent | All four; preserves existing public interfaces it sees |
| `generator` agent | `code-graph.json` to avoid creating parallel implementations |

---

## Gotchas

- **Do not call this skill on greenfield projects.** It is for existing codebases. On an empty repo it produces a useless empty graph.
- **Do not edit the JSON by hand.** Re-run the skill to refresh.
- **Stale graphs lie.** Re-run after large refactors. The skill is fast (under 30s for most repos under 5k files).
- **Vendor directories.** Skip `node_modules`, `.venv`, `venv`, `dist`, `build`, `target`, `vendor`, `.git`. The script does this by default but custom layouts may need `--exclude`.
- **Generated code.** Treat generated files (`*.pb.go`, `*.generated.ts`, `migrations/`) as nodes, but flag them in the coupling report so refactors do not target them.
- **Cycles are not always bugs.** Some frameworks expect circular package dependencies. Report them; do not auto-break them.
