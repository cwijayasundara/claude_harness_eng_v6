# Changelog

All notable changes to the Claude Harness Engine are documented here.

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
