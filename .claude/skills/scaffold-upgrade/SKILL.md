---
name: scaffold-upgrade
description: Upgrade harness control-plane files (hooks, scripts, git-hooks, agents) in a previously scaffolded project without wiping project-manifest or state. Dry-run by default.
argument-hint: "[--apply] [--include-skills] [--profile core|full|brownfield] [--target path]"
---

# Scaffold Upgrade

Refresh the **harness machinery** in an existing project after a harness release, without re-running full `/scaffold` or destroying local state.

## When to use

- You upgraded the harness monorepo / SKU version and want new gates, hooks, or scripts.
- You do **not** want to overwrite `project-manifest.json`, `program.md`, settings, or `.claude/state/`.

## Do not use

- Brand-new projects → `/scaffold`
- Disposable artifacts only → harness-lite

## Procedure

1. Resolve the harness plugin source (the `.claude` tree of the harness version you want):
   - Packaged: `dist/skus/harness-core` (or full)
   - Contributor clone: `~/claude_harness_eng_v5/.claude`

2. **Dry-run** (default — always run first):

```bash
node "<plugin-source>/scripts/scaffold-upgrade.js" --target "<project-root>" --profile core
```

Review the printed write/skip counts.

3. **Apply** when the plan looks right:

```bash
node "<plugin-source>/scripts/scaffold-upgrade.js" --target "<project-root>" --profile core --apply
```

Optional: `--include-skills` also refreshes skill prompts (larger surface change).

4. In the target project, review `git diff` under `.claude/hooks`, `.claude/scripts`, `.claude/git-hooks`, `.claude/agents`.

5. Run the project's tests / `npm run agent-readiness` if applicable.

## Guarantees

| Never overwrites | Always refreshes (default apply) |
|---|---|
| `project-manifest.json` (project root) | `.claude/hooks/**` |
| `.claude/state/**` | `.claude/scripts/**` |
| `program.md`, settings (skipped) | `.claude/git-hooks/**`, agents |

## Flags

| Flag | Meaning |
|---|---|
| `--apply` | Perform the copy (omit = dry-run) |
| `--include-skills` | Also refresh `.claude/skills/**` |
| `--profile core\|full\|brownfield` | Copy set (default `core`) |
| `--target <path>` | Project root (default cwd) |
| `--plugin-source <path>` | Harness `.claude` root |

## Related

- Emit SKUs: `npm run package:skus` (in harness monorepo)
- Publish process: `docs/marketplace-publish.md`
