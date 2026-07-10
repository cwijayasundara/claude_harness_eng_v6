# Changelog

All notable changes to the Claude Harness Engine are documented here.

## 2.1.0 — 2026-07-10

### Unreleased follow-ups (same minor line until next tag)

- Progressive `/design` entry index + `references/mode-*.md`
- Progressive `/build` entry index + `references/section-*.md`
- `/scaffold-upgrade` skill (dry-run / apply control-plane refresh)
- CI installs gitleaks before agent-readiness (Security pillar active when tools present)
- `docs/marketplace-publish.md` publish process

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
