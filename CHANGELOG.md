# Changelog

All notable changes to the Claude Harness Engine are documented here.

## Unreleased

### Human trust + production-quality surfaces (P0–P3)

World-class human review and codebase understanding (Devin DeepWiki/Review + OpenAI harness patterns):

- **P0 quality card + walkthrough:** `quality-card.js`, `pr-walkthrough.js`, `pr-body.js` — `/gate` Step 4 always writes a trust receipt + logical PR tour; Phase 11 opens PRs via `pr-body.js --require-gate` (refuses red cards).
- **P0 human homepage:** `human-codebase.js` → `docs/CODEBASE.md` from code-graph + CONTEXT + concepts; fail-open on graph-refresh.
- **P1 observability ratchet:** `observability-gate.js` — BLOCK swallowed exceptions/empty catches; WARN unstructured logs / boundary without logger / middleware without request_id.
- **P2 Ask CLI:** `ask-codebase.js` / `npm run ask -- "…"` — human-readable context-pack answers with citations.
- **P3 perf smells + digest:** `perf-smell-gate.js` (N+1 / sync-in-async BLOCKs); `readiness-digest.js` weekly ops view.

Sensors registered in `harness-manifest.json`; scripts on `CORE_SCRIPTS` + npm scripts.

## 2.1.0 — 2026-07-10

### Unreleased follow-ups (same minor line until next tag)

- **Context-first navigation:** living DeepWiki/code-map retrieval stack — `context-pack` v2 (lexical+wiki+TF-IDF semantic+co-change+depth-2), Iron Law in change/feature/refactor/vibe/implement/generator, `nav-query` facade, lean deterministic brownfield maps, concept pages, MCP (`nav-mcp-server`), nav-bench golden queries, token-advisor (`context_search_required`, unconstrained search); see [docs/proposals/context-first-navigation.md](docs/proposals/context-first-navigation.md) and [docs/token-governor.md](docs/token-governor.md)
- **Token cost control (enterprise):** receipt model stamps, cache-aware pricing, `cost-report.js`, `/status` Cost line; product scaffold default `model_tier=cost` (Haiku explorer); `token_governor.mode=enforced` optional; `team-policy` solo_sequential; frontier `advisor` agent + `/advise`; [docs/token-cost-playbook.md](docs/token-cost-playbook.md)
- Progressive `/auto` `/design` `/build` + `/scaffold-upgrade`
- CI gitleaks; Project Zero readiness **8/8** (observability convention enabled)
- All pre-commit gates use `failBlock` / `formatBlock` (Fix / Waive / Tier)
- `docs/marketplace-publish.md`, `docs/symphony-product.md`, `npm run release:skus`

### Operability & packaging

- **Sensor tiers** (`minimal` | `standard` | `strict`) filter pre-commit via a gate registry; default `standard` preserves prior commit-time behavior.
- **Lean core scaffold** excludes vertical/framework optional skills (`pe-ic-memo`, framework packs); use `--full` or framework packs.
- **Project Zero dogfood**: root `project-manifest.json`, agent-readiness **ratchet** in CI (`min_active_pillars` + no regression vs baseline).
- **ESLint** + **gitleaks** in GitHub Actions; `npm ci` + lockfile.
- **SKU packaging**: `npm run package:skus` → `dist/skus/harness-{core,lite,full}` for `claude --plugin-dir`.
- **scaffold-upgrade**: dry-run / `--apply` refresh of hooks/scripts/git-hooks without wiping project state.
- **Progressive `/auto`**: short entry `SKILL.md` + `references/section-*.md`; skill-length budget test.
- **Retention**: `npm run retention` prunes old `.claude/runs` and state archive locally.

### Planning gate

- **`plan-confidence.js --gate`**: exit `0` for high|medium, exit `2` for low — mechanical stop for `/build --auto` after one `/clarify` pass (and lite→full escalation on low confidence).

### Docs

- `docs/product-skus-and-tiers.md` SKU + tier vocabulary.
- README install path prefers packaged SKUs; clone path for contributors.

## 2.0.0

Prior harness control-system baseline (G1–G32 gap closures, GAN evaluator, brownfield lanes). See git history and `HARNESS.md`.
