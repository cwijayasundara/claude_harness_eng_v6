# Brownfield v2 Proposal — AST Context Graph, Codebase Map, God-Class Handling, Hook-Driven Freshness

**Status:** Implemented (2026-06-10) — all four milestones (M1–M4) landed with tests; see §5
**Date:** 2026-06-10
**Scope constraint:** Python + React (JS/JSX/TS/TSX) only. Simplicity is a hard constraint.

---

## 1. Deep analysis of the existing brownfield implementation

### How it works today

`/brownfield` runs a 3-layer pipeline (`.claude/skills/brownfield/SKILL.md`):

1. **Deterministic graph build** — `.claude/skills/code-map/scripts/build_graph.js` walks the repo, extracts edges, writes `specs/brownfield/code-graph.json` + Mermaid `dependency-graph.md` + `coupling-report.md`. Zero npm deps, ~600 LOC total across `extractors.js` / `graph.js` / `render.js`.
2. **LLM interpretation** — the planner agent reads the graph and writes prose maps (`codebase-map.md`, `architecture-map.md`, `test-map.md`, `risk-map.md`, `change-strategy.md`).
3. **Eval gate + human gate** — evaluator scores against `phase-eval-rubrics.json` (no hard gate for brownfield, unlike BRD/spec/design), then blocks for approval.

Consumers: `/vibe` reads only `change-strategy.md`; `/change`, `/refactor`, planner, and generator read the prose maps; `seam-finder` reads `code-graph.json` directly.

### Confirmed gaps (with evidence)

| # | Gap | Evidence |
|---|-----|----------|
| G1 | **No AST parsing — pure regex.** Python "call graph" is `/\b(\w+)\s*\(/g` over raw text with a 33-keyword blocklist → massive false positives (fires inside strings, comments, decorators). Multiline Python imports (`from x import (\n a,\n b)`) are missed. | `extractors.js:29–35, 149–175` |
| G2 | **Zero React semantics.** `.jsx` is treated as plain JS, `.tsx` as plain TS. No component nodes, no render edges, no hooks, no `<Route>` → component mapping, no Next.js file-routes. `import type` counts as runtime coupling, inflating hub metrics. | `extractors.js:7–9, 36–51` |
| G3 | **No incremental freshness.** `verify-on-save.js` (PostToolUse) does lint/typecheck only; nothing updates `code-graph.json` on edit. The graph is stale the moment a file changes; `/refactor --sweep` even instructs "Run /code-map first if the graph is missing or stale". No staleness check by any consumer (`meta.generated_at` is never compared to file mtimes). | `.claude/settings.json:55–117`, `refactor/SKILL.md` |
| G4 | **No large-file handling.** `fs.readFileSync` with no size guard — a 10 MB minified bundle or 50k-line god file is regex-scanned whole and produces garbage. No skeleton view, no symbol→line-range index, nothing that lets the agent edit a file bigger than its context. | `extractors.js:102–107` |
| G5 | **Alias resolution fails.** tsconfig `paths` / Vite `resolve.alias` (`@/components/Button`) never resolve to internal nodes → false "zero fan-in" modules. | `graph.js:116–130` |
| G6 | **Accidental complexity.** 4-way producer fallback (Understand-Anything → graphify → hex-graph → vendored) that's almost never exercised; a 360-line adapter for an undocumented external schema; `score_seams.js` recomputes fan-in/out that `graph.js` already computed; coupling report never renders the orphan/dead-code section SKILL.md promises. | `import_understand_graph.js`, `score_seams.js:70–83`, `render.js:58–98` |
| G7 | **File-level granularity only.** A file with 8 classes is one node with a flat `symbols[]` list — seam-finder and change-strategy can't reason at class/function level. | `graph.js:40–71` |

### What's worth keeping

The overall shape is right and matches what the research validates: deterministic script → JSON graph → LLM prose maps → eval gate. The schema (`nodes/edges/metrics/meta`, Tarjan SCC cycles, hubs, instability) is compatible with the converged community schema. The zero-dependency Node scripts are small and fast. **This is a v2 of the extractor + freshness layer, not a rewrite of the pipeline.**

---

## 2. Research findings that drive the design

Full citations in §7. The five load-bearing findings:

1. **Aider's repo map is the proven pattern**: tree-sitter tag extraction (defs + refs) → graph → rank by in-degree/PageRank → render top symbols *with real signatures* into a token-budgeted plain-text map. Aider moved off ctags to tree-sitter specifically because pip wheels removed the external-binary bootstrap problem.
2. **Anthropic's own guidance is anti-index**: agentic grep/read beat embeddings "by a lot"; the recommended artifacts are layered CLAUDE.md files and lightweight markdown tables-of-contents. A generated markdown map plugged into the CLAUDE.md convention is the endorsed shape. Deterministic graphs have published evals behind them (RepoGraph: +32.8% relative on SWE-bench-Lite); embedding indexes do not, and they add API keys + DBs + staleness.
3. **One toolchain can parse both languages**: Python stdlib `ast` gives imports, defs, signatures, decorators (= Flask/FastAPI routes), and exact `lineno`/`end_lineno` for free. `tree-sitter` + `tree-sitter-typescript` pip wheels (prebuilt, no compiler) parse JS/JSX/TS/TSX from the same Python script. ~2 pip deps total; no madge/dependency-cruiser/ts-morph/react-docgen needed.
4. **God files: the "skeleton" is the published, evaluated technique** (Agentless paper; repomix `--compress`, ~70% token reduction): signatures + class fields + top-level comments, bodies stripped. Combined with a `symbol → (start_line, end_line)` index, the agent reads exactly one method of a 50k-line file via `Read(offset, limit)` — the file's total size becomes irrelevant. Serena MCP proves the symbol-slice pattern in production; we get it dependency-free.
5. **Freshness: per-file re-parse keyed by content hash, not watchers, not tree-sitter incremental parsing.** Hook timing data from the Graphify writeup: PostToolUse fires per individual edit and concurrent spawns pile up — so PostToolUse handlers must be near-instant (mark-dirty append); sub-second work is safe in a Stop hook (0.425 s precedent, with a lock file); 10 s+ work belongs in explicit commands or git hooks.

---

## 3. Proposed design

### 3.1 New extractor: `code_index.py` (replaces regex extractors for Py/React)

One Python script, vendored into `.claude/skills/code-map/scripts/`. Deps: `tree-sitter`, `tree-sitter-typescript`, `tree-sitter-javascript` (pip wheels, declared in `project-manifest.json`; `init.sh` installs them — same mechanism `/scaffold` already uses for LSP servers). Python parsing uses stdlib `ast` — zero deps.

Per file it emits:

```jsonc
{
  "path": "src/api/users.py",
  "hash": "sha256:…",            // content hash → skip unchanged files
  "language": "python",
  "loc": 412,
  "imports": [{"target": "src/db/session.py", "kind": "value"},
              {"target": "ext:fastapi", "kind": "value"}],
  "symbols": [
    {"name": "UserService", "kind": "class", "start": 18, "end": 240,
     "signature": "class UserService(BaseService):",
     "doc": "Manages user lifecycle.",            // first docstring line only
     "children": [
       {"name": "create_user", "kind": "method", "start": 31, "end": 58,
        "signature": "def create_user(self, payload: UserCreate) -> User:"}
     ]},
    {"name": "get_user", "kind": "route_handler", "start": 250, "end": 270,
     "route": {"method": "GET", "path": "/users/{id}"},   // from @app.get decorator
     "signature": "async def get_user(id: int) -> User:"}
  ],
  "calls": [{"from": "UserService.create_user", "to": "send_welcome_email",
             "confidence": "extracted"}]   // extracted | inferred — honesty tag for static call edges
}
```

React-specific extraction (tree-sitter queries on JSX/TSX):
- **Component nodes**: capitalized function/const returning JSX, with props from the signature.
- **Render edges**: `<ComponentName>` occurrences → `renders` edges (the component tree).
- **Hooks used** per component (`useState`, `useEffect`, `useContext`, custom hooks).
- **Routes**: `<Route path=… element={<X/>}>` (React Router) and Next.js file-system routes → `route → component` edges.
- **`import type` flagged** as `kind: "type"` and excluded from coupling metrics (fixes G2's hub inflation).
- **Alias resolution**: read `tsconfig.json#paths` / `vite.config.*#resolve.alias` once and resolve `@/…` imports to internal nodes (fixes G5).

The Python regex call-graph (`extractPythonCalls`) is **deleted** — replaced by real `ast.Call` resolution limited to same-module and known-import targets, confidence-tagged. Files > 1 MB or detected-minified (avg line length > 500) are skeleton-indexed from the parse tree but excluded from full-body operations (fixes G4's OOM/garbage path).

### 3.2 Artifacts: JSON source of truth + token-budgeted markdown map

| Artifact | Role | Format |
|---|---|---|
| `specs/brownfield/code-graph.json` | Queryable source of truth (scripts, seam-finder) | Same top-level schema as today (`nodes/edges/metrics/meta`) extended with per-file records above — **consumers keep working** |
| `specs/brownfield/symbol-map.md` | Agent-facing navigation map (named to avoid clashing with the planner's prose `codebase-map.md`) | Aider-style: top-ranked symbols with real signatures, ranked by internal fan-in, budgeted ≤ ~4k tokens. Linked from CLAUDE.md ("read before structural changes") |
| `specs/brownfield/skeletons/<path>.skel.md` | God-file skeletons (only for files > threshold, default 1,500 LOC) | Signatures + class fields + docstring heads + `# lines 31–58` anchors per symbol |
| Existing prose maps (`architecture-map.md`, `risk-map.md`, …) | Unchanged — still produced by the planner from the richer graph | Markdown |

Mermaid stays for the ≤80-node high-level view only (it degrades past ~50 edges). No MCP server, no SQLite, no embeddings — files + CLI scripts measurably beat MCP servers on token overhead and match Anthropic's no-index guidance.

### 3.3 God classes / files larger than model context (the >1M-token case)

Layered strategy — each layer makes the next unnecessary for most files:

1. **Never read whole god files.** The symbol index gives `(start_line, end_line)` for every class/method; the agent uses `Read(offset, limit)` to pull one symbol slice. A 5M-token file is editable because no step ever needs more than one symbol + its skeleton context. This is the dependency-free equivalent of Serena's `find_symbol`.
2. **Skeleton view for orientation** (~70% token reduction, evaluated in the Agentless paper): the agent reads `<file>.skel.md` to pick the right symbol before slicing.
3. **Ego-graph for impact**: "who calls this / what does it touch" is answered from `code-graph.json` (1–2-hop neighborhood, RepoGraph's evaluated pattern) — no file reading at all.
4. **Last resort — cached summarization**: only if a *skeleton itself* exceeds budget (pathological generated files), a haiku-tier agent writes a cached-by-content-hash summary. This is the only LLM-cost component and is optional.
5. **Enforcement**: `pre-write-gate.js` already blocks *creating* >300-line files; add a guard that edits to indexed god files must target a symbol range, not the whole file.

### 3.4 Hook-driven freshness ("when we make changes all the hooks should get fired")

Three-tier design, derived from the hook-timing evidence (per-edit handlers must be near-instant; sub-second OK at Stop):

| Tier | Trigger | Action | Cost |
|---|---|---|---|
| **Mark dirty** | `PostToolUse` matcher `Edit\|Write\|MultiEdit` — extend the existing `verify-on-save.js` (no new hook entry) | Append `file_path` to `.claude/state/graph-dirty.jsonl` if extension ∈ {py,js,jsx,ts,tsx} | microseconds |
| **Patch graph** | `Stop` hook — extend existing `review-on-stop.js` chain | Drain dirty list → re-parse only those files (content-hash skip) → patch their records in `code-graph.json` → recompute metrics → regenerate `codebase-map.md` if rank order changed. Lock file prevents concurrent runs. | sub-second for typical turn-sized edit sets |
| **Full rebuild** | `/brownfield`, `/code-map`, and optional git `post-checkout`/`post-merge` | Rebuild from scratch | seconds, explicit |

Consumers get a staleness contract: every reader of `code-graph.json` (seam-finder, `/refactor --sweep`, planner) checks `meta.generated_at` + dirty-list emptiness and warns/refreshes instead of silently using a stale graph (fixes G3 end-to-end). No file watchers, no daemons — hooks already tell us exactly which file changed.

### 3.5 Simplification (net deletions)

- **Delete** the 4-way producer fallback. One vendored indexer; keep *only* the Understand-Anything import behind an explicit `--import` flag (it's the only documented external integration). Removes graphify/hex-graph probes.
- **Delete** `extractPythonCalls` regex and the JS/TS regex extractors for Py/React (superseded by §3.1). Java/C#/Go regex extractors stay as-is (out of scope, still functional).
- **Fix** `score_seams.js` to consume `metrics.hubs` instead of recomputing fan-in/out.
- **Fix** `render.js` to actually emit the orphan/dead-code section SKILL.md promises.
- **Tag** test files in the graph (`is_test: true`) so coupling metrics can exclude them.
- Net effect: fewer code paths than today, one new well-tested script, two pip wheels.

---

## 4. Additional features proposed (researched, ranked by simplicity-to-value)

| Rank | Feature | Why | Cost |
|---|---|---|---|
| P1 | **Symbol-slice navigation** (index + skeletons, §3.3) | Directly solves god-class problem; strongest published evidence | Medium |
| P2 | **Hook-driven incremental freshness** (§3.4) | User's explicit requirement; removes the "stale graph" class of bugs | Low |
| P3 | **Route maps** (FastAPI/Flask decorators; React Router/Next routes) | Routes are the natural entry points for `/change` story planning and seam-finder goals; no off-the-shelf tool does this — small per-framework matcher table | Low |
| P4 | **Token-budgeted ranked map** in CLAUDE.md convention (§3.2) | Anthropic-endorsed shape; replaces the static one-shot `CODEBASE_MAP.md` template | Low |
| P5 | **Confidence-tagged call edges** (`extracted`/`inferred`) | Honesty mechanism for static analysis of dynamic languages; lets seam-finder weight evidence | Trivial |
| P6 | **Staleness contract for consumers** | Cheap insurance; turns silent wrong answers into visible warnings | Trivial |
| P7 | **Hard gate for the brownfield eval phase** (currently the only ungated phase in `phase-eval-rubrics.json`) | Consistency with BRD/spec/design phases | Trivial |
| P8 | *(Optional, later)* cached cheap-model file summaries for pathological files | Only LLM-cost component; defer until a real repo needs it | Medium |

**Explicitly rejected** (researched and ruled out for this scaffold): embedding/vector indexes (claude-context, Milvus — API keys, DBs, staleness, no nav evals; contradicts Anthropic guidance), MCP graph servers (codegraph, GitNexus, Serena — ~2–6k tokens of schema overhead per session, daemons/DBs; point users at them as opt-in plugins instead), SCIP/LSIF (CI indexer toolchains; LSP-on-demand already covers precision needs), LibCST/Jedi (codemod/IDE machinery, wrong layer), Graphviz-dependent tools (pydeps, madge visual output — bootstrap liability), tree-sitter *incremental parsing* and file watchers (editor-latency tech; per-file whole re-parse is milliseconds).

---

## 5. Implementation plan (proposed, not started)

1. **M1 — Indexer**: `code_index.py` (Python `ast` + tree-sitter TSX), golden-file tests against fixture repos (one FastAPI, one React Router, one Next.js, one god-file fixture). Wire into `build_graph.js` flow as the Py/React producer; keep JSON schema backward-compatible.
2. **M2 — Artifacts**: ranked `codebase-map.md` renderer + skeleton emitter + symbol-range index; update `/brownfield` SKILL.md steps 1.5/2.
3. **M3 — Freshness**: dirty-list append in `verify-on-save.js`, drain-and-patch in the Stop chain, staleness checks in seam-finder/`/refactor --sweep`/planner prompts.
4. **M4 — Cleanup**: delete fallback chain + Python call regex, fix `score_seams.js`/`render.js`, add brownfield hard gate, update README/design.md.

Each milestone lands via `/change` with tests; M1 is the only one with meaningful new code.

---

## 6. Decisions (resolved 2026-06-10)

1. **Pip wheels approved** — `tree-sitter` + `tree-sitter-typescript` (and `tree-sitter-javascript` for plain JS/JSX) are acceptable scaffold dependencies.
2. **God-file skeleton threshold: 1,500 LOC** (default, configurable).
3. **SubagentStop included** — the graph-patch hook fires on both `Stop` and `SubagentStop` (generator teammates edit files too).

## 7. Key sources

- Aider repo map: https://aider.chat/2023/10/22/repomap.html · https://aider.chat/docs/repomap.html
- Anthropic large-codebase guidance: https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start
- RepoGraph (ICLR 2025, +32.8% SWE-bench-Lite): https://arxiv.org/abs/2410.14684
- Agentless skeleton format: https://arxiv.org/pdf/2407.01489 · repomix compress: https://repomix.com/guide/code-compress
- Hierarchical summarization: https://arxiv.org/html/2501.07857v1 · https://arxiv.org/html/2504.08975
- Hook timing data (Graphify/CRG): https://dev.to/mir_mursalin_ankur/graphify-code-review-graph-build-a-self-updating-knowledge-graph-for-claude-code-and-other-ai-j1m
- Claude Code hooks guide: https://code.claude.com/docs/en/hooks-guide
- Symbol-slice precedent (Serena): https://github.com/oraios/serena
- tree-sitter wheels: https://pypi.org/project/tree-sitter-typescript/
- Cursor Merkle-tree sync: https://cursor.com/blog/secure-codebase-indexing
- Comparable plugins: https://github.com/colbymchenry/codegraph · GitNexus · https://github.com/zilliztech/claude-context
