---
type: Product Workflow
title: Product routes and install boundaries
description: "How Claude Harness Engine packages its three loadouts and routes greenfield, existing-code, sprint, and review work through scaffolded controls."
resource: README.md
tags: [workflows, skus, scaffolding, orchestration]
---

# Product routes and install boundaries

The harness exposes a deliberately small public surface: `/build` for a new product, `/feature "<request>"` for normal existing-code work, `/sprint <prd>` for the next PRD on an established product, and `/gate` for independent verification. These routes dispatch to skills and agents, then rely on the [control plane](../architecture/control-plane.md) for lifecycle and commit enforcement.

## What users install

| Loadout | Use it for | Boundary |
| --- | --- | --- |
| `harness-core` | Default shippable software work | Lean build/feature/gate spine plus brownfield discipline. |
| `harness-full` | Teams that need optional skills, framework packs, and broader operations surface | Core plus optional runtime surface. |
| `harness-lite` | Research, mockups, and architecture/ARB documents that will not ship | Separate artifact-only plugin; no SDLC loop, quality hooks, or generator/evaluator system. |

`npm run package:skus` uses `.claude/scripts/package-sku.js` to emit `dist/skus/*` plugin trees. `symphony_clone/` is deliberately excluded from these SKUs; it is described in [delivery and observability](../operations/delivery-observability.md).

SKU is an **install boundary**. It is separate from the `minimal`/`standard`/`strict` sensor-tier runtime dial described in the [control plane](../architecture/control-plane.md).

## Scaffold and upgrade

`/scaffold` is the bootloader for a target project. Its interactive flow selects a profile; headless use must invoke the deterministic `scaffold-apply.js` path instead of manually reconstructing files. That script creates the target manifest, selected `.claude` tree and Git hooks, starter artifacts, navigation/state seeds, `features.json`, and `claude-progress.txt`.

`.claude/scripts/scaffold-copy.js` owns profile selection and explicit copy allowlists. This is an integrity boundary: adding a source skill, hook, or script does not make it available to `core`/`brownfield` targets unless the copy policy changes too.

`/scaffold-upgrade` is dry-run by default. Applying it refreshes hooks, scripts, Git hooks, and agents but preserves target `project-manifest.json`, settings, `program.md`, and `.claude/state/`; it only refreshes skills with `--include-skills` because that changes the prompt surface.

## Route selection

| Route | When to use it | Main behavior |
| --- | --- | --- |
| `/build` | New product or sufficiently large new scope | BRD → stories → design/test plan → state initialization → `/auto`. Approval mode changes human gates, never machine gates. |
| `/feature` | Normal request in an existing repository | Refreshes committed maps, creates/publishes a story when configured, routes to the right lower-level lane, gates, and opens a PR for human review. |
| `/brownfield` | Discovery only | Produces factual graph/wiki/navigation and risk/change maps; it does not modify production code. |
| `/change` | Bounded behavior change | Requires a story or reproducible issue and a failing test before production edits; redirects refactors, tiny safe changes, and multi-story scope to more suitable routes. |
| `/refactor` or `/vibe` | Behavior-preserving cleanup or a tiny low-risk edit | Narrow routes that must not become ways to bypass wider scope or safety requirements. |
| `/sprint` | New PRD for an existing product | Grounds the PRD against prior requirements, creates delta artifacts and a human-approved design amendment, then enters `/auto`. |
| `/gate` | Pre-merge or after manual edits | Runs evaluator and fresh-context review, conditionally adds security checks, self-heals blockers within bounds, and ends with quality-card/walkthrough artifacts. |

`/feature` normally owns the existing-code decision. It can delegate to `/vibe`, `/change`, `/refactor`, or `/build`; `/brownfield` is the discovery-only route when the user explicitly wants understanding without implementation.

## Automated execution and human authority

`/auto` is the primary autonomous coordinator: recover context, establish contracts, execute ownership-bounded story work with agent teams, ratchet/evaluate, self-heal, record learning, and commit. Generator agents implement; evaluator, code-reviewer, and security-reviewer agents provide independent judgment. The implementation loop writes durable state described in [continuation and reuse](continuation-and-reuse.md).

Approval flags alter planning approval, not the core safety model:

- default `/build` or `/feature`: normal human approval gates;
- `--autonomous`: a reduced approval path;
- `--auto`: no human planning approvals, while machine controls and PR review still apply.

The harness does **not** merge for the user. `/gate` may block a PR from opening on unresolved findings, and final merge remains human-owned unless an external operator explicitly configures an autonomous system.

## Route-change cautions

- Do not regenerate a living product design for feature/sprint work; use design delta/amendment paths so existing decisions remain reviewable.
- Use Lite/artifact lanes for non-product deliverables. Escalate only when the output becomes shipped code.
- Treat `settings.auto.json` as an isolated, high-privilege unattended mode: it broadens tool permissions but does not disable the installed [control plane](../architecture/control-plane.md). Run it only in a container, CI runner, or VM without host secrets and with constrained egress.
