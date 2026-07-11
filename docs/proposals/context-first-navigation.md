# Proposal: Context-First Navigation (Devin-grade retrieval on our code-map)

**Date:** 2026-07-11  
**Status:** Design proposal — **P0–P2 + follow-ons implemented** (pack v2, Iron Law across change/implement/generator, receipt/advisor including unconstrained search, nav-query, TF-IDF + inverted graph index, co-change, concept pages, MCP, telemetry, **deterministic lean brownfield maps**, **nav-bench golden queries**, wiki concept links). Disposable analysis artifact — not run through the SDLC pipeline. SQLite store still optional (non-goal until measured need).  
**Trigger:** Review of living DeepWiki/code-map vs Devin DeepWiki, Cursor hybrid RAG, and open code-graph MCPs. Goal: cut token burn on ambiguous queries without replacing the deterministic DAG.  
**Supersedes / extends:** `docs/internal/DEEPWIKI_BROWNFIELD_PROPOSAL_2026-06-21.md` (§3.3 retrieval), `docs/token-usage-optimizer-design.md` (§2 Context Access Optimizer — design ahead of implementation).

---

## 0. TL;DR

We already have the hard substrate peers lack: an **incremental AST code-graph**, deterministic wiki, skeletons, token-advisor, and impact-scoped tests. Tokens still burn because:

1. **Retrieval is underpowered** — `context-pack.js` is lexical-only + 1-hop; the optimizer design already specifies BM25 + wiki + multi-hop + diff boost, but that is not implemented.
2. **Agents are not forced into the retrieval loop** — `/change` S2 still front-loads brownfield essays (`architecture-map`, `risk-map`, …) and never requires `/context` or `code_wiki.js query` before exploration.
3. **`context_search_required: true` in the manifest is not enforced** — token-advisor only warns on broad `Read`, not on “skipped context-pack.”

**Fix in three shippable phases:** close the context-pack design gap + mandate context-first in change lanes (P0); hybrid recall + multi-hop task maps (P1); concept layer + MCP tools + co-change (P2). Do **not** replace the DAG with embeddings-only RAG.

**Success metric (P0):** on a brownfield change query with a fresh graph, agents issue a context-pack (or structural graph query) before any broad source `Read` / unconstrained `rg`, and median orientation tokens drop vs essay front-load.

---

## 1. Current state (grounded)

| Piece | Path | Today |
|-------|------|--------|
| Graph | `specs/brownfield/code-graph.json` | AST / SCIP / regex; incremental via `graph-refresh` |
| Structural query | `.claude/skills/code-map/scripts/code_wiki.js query` | `--callers`, `--calls`, `--symbol`, `--module`, `--hubs`, `--cycles` |
| NL retrieval | `.claude/scripts/context-pack.js` | Word overlap on path/symbol/signature; 1-hop neighbors; budget trim |
| Skill | `.claude/skills/context/SKILL.md` | Thin wrapper; agents rarely required to call it |
| Policy | `project-manifest.json#token_governor` | `context_search_required: true` present but **unused by hooks** |
| Advisor | `.claude/hooks/token-advisor.js` | Warns broad `Read` if symbol ranges exist; does not require pack |
| Change entry | `.claude/skills/change/SKILL.md` Step S2 | Reads full brownfield essay set; symbol-map optional; no `/context` |
| Impact | `.claude/scripts/impact-scope.js` | Reverse deps for tests — not wired into context-pack output |

Wiki text is already written in tests for context-pack fixtures but **not scored** by the pack builder (design/impl drift).

---

## 2. Target agent loop

```text
Ambiguous or multi-file request
    │
    ▼
┌─────────────────────────────┐
│ 0. Ambiguity gate           │  confidence low + ≥2 disjoint clusters → clarify
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ 1. Hybrid context-pack      │  lexical + wiki BM25 + (P1) embeddings
│    + multi-hop graph expand │  callers/callees/imports depth ≤2, budgeted
│    + optional git-diff boost│
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ 2. Task map (JSON)          │  edit_candidates, must_not_break, tests, confidence
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ 3. Slice-read only read_next│  symbol-map / skeletons for god files
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ 4. Edit + impact-scoped verify │  existing local-regression-gate / coverage
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ 5. graph-refresh patches    │  already exists
└─────────────────────────────┘
```

**Truth layers (non-negotiable):**

| Layer | Authority | Use for |
|-------|-----------|---------|
| AST / SCIP graph | Edges, symbols, line ranges | Blast radius, safe refactors, impact tests |
| Lexical + wiki BM25 | Identifier / page text | Cheap exact-ish recall |
| Embeddings (P1, optional) | Fuzzy intent | When lexical misses domain phrasing |
| Concept summaries (P2) | Hash-cached prose | Macro orientation, not source of truth |
| Human steering | `.harness/wiki.json` (P2) | Monorepo page priorities (DeepWiki `.devin/wiki.json` analogue) |

---

## 3. Schemas

### 3.1 Context pack v2 (extends v1, backward compatible)

Existing fields stay. New fields are additive so old tests keep working when ignored.

```json
{
  "schema_version": 2,
  "question": "where is session validation handled?",
  "status": "ok | no_match | missing | placeholder | low_confidence",
  "budget_tokens": 1600,
  "estimated_tokens": 640,
  "confidence": "high | medium | low",
  "confidence_reasons": ["exact_symbol_match", "wiki_heading_hit", "single_cluster"],
  "results": [
    {
      "path": "src/auth/session.py",
      "start": 41,
      "end": 88,
      "symbol": "validate_session",
      "kind": "function",
      "reason": "symbol/signature match",
      "confidence": "high",
      "score": 12.4,
      "sources": ["lexical", "wiki", "graph_neighbor"]
    }
  ],
  "read_next": [
    "Read src/auth/session.py lines 41-88"
  ],
  "task_map": {
    "entrypoints": [
      { "path": "src/api/middleware.py", "symbol": "auth_middleware", "start": 12, "end": 49 }
    ],
    "edit_candidates": [
      { "path": "src/auth/session.py", "symbol": "validate_session", "start": 41, "end": 88, "why": "primary symbol match" }
    ],
    "must_not_break": [
      { "path": "tests/test_session.py", "symbol": "test_expired_session", "start": 20, "end": 39, "why": "direct caller / test" }
    ],
    "tests_to_run": [
      { "kind": "symbol_test", "path": "tests/test_session.py" },
      { "kind": "impact_hint", "command": "node .claude/scripts/local-regression-gate.js" }
    ],
    "clusters": [
      { "id": "auth", "paths": ["src/auth/session.py", "src/api/middleware.py"], "score": 0.9 }
    ],
    "clarify_options": []
  },
  "graph_queries_used": [
    { "op": "symbol", "arg": "validate_session" },
    { "op": "callers", "arg": "py:src/auth/session.py" }
  ],
  "fallback": {
    "allowed": true,
    "when": "status is no_match or confidence is low",
    "suggest": ["rg -n 'session' --glob '!node_modules'", "refresh /code-map if source found outside index"]
  },
  "warnings": []
}
```

**Status rules:**

| status | Meaning | Agent action |
|--------|---------|--------------|
| `ok` + high/medium confidence | Pack is authoritative enough | Read only `read_next`; then edit |
| `ok` + `low_confidence` or `low_confidence` status | Hits exist but weak / multi-cluster | Prefer `task_map.clarify_options`; else narrow `rg` then refresh graph |
| `no_match` | Nothing scored | Narrow `rg` → if hits, `/code-map --files` or full refresh |
| `missing` / `placeholder` | No real graph | `/code-map` or `/brownfield` first |

### 3.2 Ranker inputs (deterministic)

```text
score(record) =
  4.0 * exact_symbol_or_path_token
+ 2.0 * bm25(symbol, signature, path)
+ 1.5 * bm25(wiki_page_text + WIKI.md snippets citing path)
+ 1.0 * glossary_term_hit(CONTEXT.md)
+ 0.8 * graph_proximity(depth)          # depth1=0.8, depth2=0.4
+ 1.2 * in_git_diff_or_dirty_list
+ 0.6 * is_test_of_hit
+ 0.5 * route_or_entrypoint_boost
- 0.3 * vendor_or_generated_path
```

Cap expansion: max **depth 2**, max **N neighbor files** (default 12), stop when `estimated_tokens >= budget_tokens`.

Reuse edge shape already in graph (`source`/`target` or `from`/`to`, kinds `imports|calls|renders|…`). Prefer `calls`/`imports` for blast radius; include test files that call the hit.

### 3.3 Optional semantic index (P1 only)

Store under `.claude/state/nav-index/` (gitignored):

```json
{
  "schema_version": 1,
  "model": "local-default",
  "built_at": "ISO-8601",
  "graph_meta_generated_at": "ISO-8601",
  "chunks": [
    {
      "id": "src/auth/session.py:validate_session",
      "path": "src/auth/session.py",
      "start": 41,
      "end": 88,
      "text": "function validate_session(token) — checks expiry…",
      "kind": "symbol"
    }
  ]
}
```

Embeddings optional binary/sqlite beside it. **Fail open** if index missing: ranker skips semantic term. Rebuild when `code-graph.meta.json#generated_at` advances or dirty list drains.

### 3.4 Wiki steering (P2) — DeepWiki analogue

`.harness/wiki.json` (or `project-manifest.json#wiki_steering`):

```json
{
  "repo_notes": [
    { "content": "Auth lives in src/auth; billing is services/billing. Prefer those over utils/.", "author": "team" }
  ],
  "max_concept_pages": 20,
  "priority_paths": ["src/auth", "services/billing"]
}
```

### 3.5 Concept page cache (P2)

`specs/brownfield/wiki/concepts/<cluster-id>.md` + sidecar:

```json
{
  "cluster_id": "auth",
  "member_paths": ["src/auth/session.py", "src/api/middleware.py"],
  "content_hashes": { "src/auth/session.py": "sha256:…" },
  "generated_at": "ISO-8601",
  "stale": false
}
```

Regenerate only when any member hash differs from `code-graph.json#files[].hash` (or equivalent).

---

## 4. Tool / CLI contracts

### 4.1 Context pack CLI (extend existing)

```bash
node .claude/scripts/context-pack.js "question"
node .claude/scripts/context-pack.js --budget 1600 "question"
node .claude/scripts/context-pack.js --root <dir> --budget 1600 "question"
# P0 additions:
node .claude/scripts/context-pack.js --diff          # boost files from git status + dirty list
node .claude/scripts/context-pack.js --depth 2        # graph expansion depth (default 2)
node .claude/scripts/context-pack.js --json-out path  # optional write receipt
```

Exit codes: `0` always for successful run (including `no_match`); `2` only on I/O/parse failure. Agents must branch on `status` / `confidence`, not exit code.

### 4.2 Structural tools (thin wrappers over `code_wiki` + impact)

Prefer **one facade** so skills document a single entrypoint:

```bash
# New thin CLI (P0.5 / P1) — pure wrappers, no new graph logic
node .claude/scripts/nav-query.js symbol validate_session
node .claude/scripts/nav-query.js callers py:src/auth/session.py
node .claude/scripts/nav-query.js impact --files src/auth/session.py
node .claude/scripts/nav-query.js pack --budget 1600 "session validation"
```

Implementation:

| Subcommand | Delegates to |
|------------|----------------|
| `symbol|callers|calls|module|hubs|cycles` | `code_wiki.js query` |
| `impact` | `impact-scope.js` (or shared lib extract) |
| `pack` | `buildContextPack` |

### 4.3 MCP surface (P2, optional)

If/when MCP is desired for non-Claude-Code agents, expose the same ops as tools with identical JSON. Do not invent a second schema.

Suggested tool names: `nav_pack`, `nav_symbol`, `nav_callers`, `nav_impact`.

---

## 5. Agent / skill contracts (the enforcement that actually saves tokens)

### 5.1 Iron Law — Context-First (P0)

Add to change-family skills as a **required pre-step** (same tone as coverage preflight):

> **Before any production `Read` of a source file > N lines, or any unconstrained repo-wide search, run:**  
> `node .claude/scripts/context-pack.js --diff --budget 1600 "<user request / story problem>"`  
> Then read **only** `read_next` ranges (and skeletons for god files).  
> If `status` is `missing`/`placeholder` → `/code-map` or `/brownfield` first.  
> If `confidence` is `low` or `status` is `no_match` → either ask a clarifying question using `task_map.clarify_options` / top clusters, or run **one** narrow `rg` and re-pack. Do not open a multi-file exploration loop.

### 5.2 Files that must gain the Iron Law (P0)

| File | Change |
|------|--------|
| `.claude/skills/change/SKILL.md` | Replace S2 “read all brownfield essays” with: context-pack → task_map → optional essay slices only if pack low-confidence or risk flags |
| `.claude/skills/feature/SKILL.md` | After wiki freshness, run context-pack on the feature request before routing |
| `.claude/skills/refactor/SKILL.md` | Context-pack + `nav-query callers` for rename/move blast radius before edit |
| `.claude/skills/vibe/SKILL.md` | Micro-pack for tiny fixes (lower budget, still required if graph exists) |
| `.claude/skills/implement/SKILL.md` / generator agent | Story text → pack before teammate fan-out |
| `.claude/skills/context/SKILL.md` | Document v2 fields + Iron Law consumers |
| `.claude/agents/generator.md` (if present) | Same pre-read rule |
| `CLAUDE.md` / target-project CLAUDE snippet | One short bullet: context-pack before broad source reads (keep cache-stable; no mid-session churn) |

**Essay policy for `/change`:** do **not** require `architecture-map.md` + `test-map.md` + `risk-map.md` + `change-strategy.md` on every S2. Prefer:

1. context-pack task_map  
2. `risk-map.md` **only if** pack hits auth/billing/persistence paths or user asked for risk  
3. full essay set only on `/brownfield` or when pack confidence is low

This lands the DeepWiki proposal’s “/change consumes graph, skips six essays” without deleting brownfield discovery.

### 5.3 Ambiguity gate (P0, prompt-level; P1 can automate)

If `task_map.clusters.length >= 2` and top two cluster scores are within 20%, **stop and ask**:

```text
I found two likely areas for "<request>":
A) <cluster paths/symbols>
B) <cluster paths/symbols>
Which should I change? (or both)
```

Do not implement across both without confirmation.

### 5.4 Hook enforcement (P0.5)

Extend `.claude/hooks/token-advisor.js` (still fail-open):

| Predicate | Advisory message | Enforced mode |
|-----------|------------------|---------------|
| Existing: broad source `Read` with ranges | Use pack / symbol-map | block |
| **New:** brownfield lane skill active (detect via command transcript / env if available) **and** first source `Read` with no prior `context-pack` receipt in session state | Run context-pack first | block if `context_search_required` && mode=enforced |
| Optional: `rg`/`find` over `.` without path filter when graph exists | Prefer pack then narrow path | warn only |

**Receipt:** context-pack writes `.claude/state/context-pack-last.json` (question hash, status, confidence, ts). Advisor checks mtime/session. Avoid false blocks: greenfield placeholder graph → fail open (already).

Wire `context_search_required` from manifest (today dead config).

---

## 6. Implementation phases

### P0 — Close design gap + force the loop (target: 1–3 days)

**Goal:** Ambiguous change queries use graph-backed packs before exploration; essays optional.

| # | Work item | Files |
|---|-----------|--------|
| P0.1 | Implement hybrid **lexical + wiki BM25** + **depth-2** expansion + **git-diff boost** + **task_map** + **confidence** | `.claude/scripts/context-pack.js` |
| P0.2 | Extract pure helpers if needed for testability | `.claude/scripts/lib/context-rank.js` (new, optional) |
| P0.3 | Extend unit tests: wiki-only match, depth-2, diff boost, low multi-cluster confidence, no_match | `test/context-pack.test.js` |
| P0.4 | Iron Law text in change/feature/refactor/vibe (+ implement if easy) | skill SKILL.md files listed above |
| P0.5 | Document v2 in `/context` skill + token-governor.md short section | `.claude/skills/context/SKILL.md`, `docs/token-governor.md` |
| P0.6 | Receipt file for advisor | context-pack.js writes `.claude/state/context-pack-last.json` |
| P0.7 | Advisor: honor `context_search_required`; warn on first broad read without fresh receipt | `.claude/hooks/token-advisor.js`, `test/token-advisor.test.js` |
| P0.8 | Register any new sensor/hook honesty in harness-manifest if behavior is a named control | `harness-manifest.json`, `HARNESS.md` only if new gate semantics |

**Out of P0:** embeddings, MCP, concept LLM pages, co-change index.

**Acceptance tests (must pass):**

1. Existing context-pack tests still green.  
2. Query “session validation” matches wiki prose even if symbol renamed in fixture to something non-overlapping (wiki path).  
3. Neighbor at depth 2 appears when budget allows.  
4. `--diff` ranks dirty file above equal lexical peer.  
5. Multi-cluster fixture yields `confidence: low` and ≥2 `clarify_options` or clusters.  
6. Skill text grep/contract test (optional): `change/SKILL.md` contains `context-pack.js`.

### P1 — Multi-hop quality + optional semantic recall + nav facade

| # | Work item | Files |
|---|-----------|--------|
| P1.1 | `nav-query.js` facade over code_wiki + pack + impact | `.claude/scripts/nav-query.js`, tests |
| P1.2 | Integrate `impact-scope` neighbors into `task_map.tests_to_run` when matrix exists | context-pack or nav-query |
| P1.3 | Optional local embedding index rebuild hook after graph-refresh | `.claude/scripts/nav-index-build.js`, `graph-refresh.js` call site |
| P1.4 | Ranker semantic term (fail open) | context-rank / context-pack |
| P1.5 | Telemetry counters: pack requests, no_match rate, advisor context_search warnings | jsonl + `/status` line |
| P1.6 | Benchmark harness: scripted agent tasks with/without pack (token estimate from tool log) | `test/fixtures/nav-bench/` or docs metric only |

**Acceptance:** no_match rate drops on a fixed 10-query golden set that includes synonym-style questions; pack p95 latency stays under ~2s on ~1k-file graphs without embeddings.

### P2 — Concept layer, steering, co-change, MCP

| # | Work item | Notes |
|---|-----------|--------|
| P2.1 | Hash-cached concept pages per cluster | LLM once per changed cluster only |
| P2.2 | `.harness/wiki.json` steering | Cap pages; priority paths |
| P2.3 | Co-change edges from `git log --name-only` (N months) | Deterministic; feed ranker |
| P2.4 | MCP tool wrappers | Same JSON as nav-query |
| P2.5 | Optional SQLite graph store for huge monorepos | Only if JSON parse/memory becomes a measured problem |

**Acceptance:** concept pages regenerate only for dirty clusters; co-change boost improves golden-set recall on “where do we usually fix X.”

---

## 7. Explicit non-goals

- Replacing `code-graph.json` with embeddings-only retrieval.  
- Eager six-essay regeneration on every `/change`.  
- Loading full wiki into the system prompt (breaks prompt-cache discipline).  
- Repo-specific model fine-tuning (Devin “Kevin” path) until retrieval + tests are excellent.  
- Blocking greenfield or placeholder graphs (fail open).  
- Silent command rewriting by hooks (advisor warns/blocks only).

---

## 8. Rollout & risk

| Risk | Mitigation |
|------|------------|
| Pack misses → agent blocked in enforced mode | Fail open without graph; low_confidence allows narrow rg; default mode stays advisory for P0.7 product default |
| BM25 slower on huge graphs | Index symbols once per pack call into memory; wiki page scan capped (e.g. 64KB / 40 pages) |
| Skill text ignored | Receipt + advisor (P0.6–0.7); later eval metric on sessions |
| Design/impl drift again | Golden tests encode wiki + depth-2 + multi-cluster cases from day one |
| Manifest `context_search_required` surprises users | Document in token-governor; enforced only when `mode=enforced` |

**Default product config after P0:**

```json
"token_governor": {
  "enabled": true,
  "mode": "advisory",
  "living_navigation": true,
  "context_search_required": true,
  "max_source_read_lines": 300
}
```

Enterprise may set `"mode": "enforced"`.

---

## 9. Metrics

| Metric | Source | P0 target |
|--------|--------|-----------|
| `context_pack_status{ok,no_match,…}` | pack receipt / jsonl | baseline only |
| Advisor `kind=context_search_skipped` rate | token-advisor.jsonl | trending down after skill ship |
| Estimated orientation tokens | `/status` existing savings field | ≥30% lower vs essay front-load on fixture tasks |
| Median tool calls to first correct file | manual bench or future telemetry | down vs unconstrained explore |

Do not claim “Devin parity” without a golden-query set and before/after numbers.

---

## 10. Suggested implementation order (when approved)

1. **P0.1–P0.3** — context-pack v2 + tests (no skill text yet; pure function, easy to review).  
2. **P0.4–P0.5** — skill Iron Law + docs.  
3. **P0.6–P0.7** — receipt + advisor wire-up (still advisory).  
4. Measure one real brownfield `/change` orientation.  
5. Only then P1 embeddings / nav-query facade.

---

## 11. File checklist (complete)

### Create

- `docs/proposals/context-first-navigation.md` (this file)  
- `.claude/scripts/lib/context-rank.js` (optional extract)  
- `.claude/scripts/nav-query.js` (P1)  
- `.claude/scripts/nav-index-build.js` (P1)  
- `.harness/wiki.json` template (P2)  
- `.claude/state/context-pack-last.json` (runtime receipt, gitignored via existing state rules)

### Modify (P0)

- `.claude/scripts/context-pack.js`  
- `test/context-pack.test.js`  
- `.claude/hooks/token-advisor.js`  
- `test/token-advisor.test.js`  
- `.claude/skills/context/SKILL.md`  
- `.claude/skills/change/SKILL.md`  
- `.claude/skills/feature/SKILL.md`  
- `.claude/skills/refactor/SKILL.md`  
- `.claude/skills/vibe/SKILL.md`  
- `docs/token-governor.md`  
- `docs/token-usage-optimizer-design.md` (mark §2 “implemented subset” vs remaining)  
- `harness-manifest.json` (only if new named sensor/behavior is registered)

### Modify (P1+)

- `.claude/hooks/graph-refresh.js`  
- `.claude/scripts/impact-scope.js` (export helpers if needed)  
- status/telemetry scripts as applicable  

### Do not touch in P0

- AST indexer / SCIP import (unless a bug blocks symbol ranges)  
- Brownfield essay generation path (except skill consumers stop requiring them)  
- Evaluator / GAN loop  

---

## 12. Bottom line

Ship **retrieval product quality** on top of the graph we already maintain:

1. **Better pack** (wiki + multi-hop + confidence + task_map)  
2. **Mandatory use** in change lanes (skills + optional advisor)  
3. **Later** fuzzy embeddings, concepts, co-change, MCP  

That is the Devin/Cursor lesson without abandoning the deterministic control plane that is already our moat.

---

## Sources (internal)

- Review conversation 2026-07-11 (code-map / DeepWiki vs Devin, Cursor, CodeGraph)  
- `docs/internal/DEEPWIKI_BROWNFIELD_PROPOSAL_2026-06-21.md`  
- `docs/token-usage-optimizer-design.md`  
- `.claude/scripts/context-pack.js`, `test/context-pack.test.js`  
- `.claude/skills/change/SKILL.md` Step S2  
- `.claude/hooks/token-advisor.js`  
- `.claude/skills/code-map/scripts/code_wiki/query.js`  
- Devin DeepWiki docs (`.devin/wiki.json` steering, Ask Devin + wiki grounding)  
