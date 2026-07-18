---
type: Project Guide
title: Claude Harness Engine v5
description: "Entry point for the Claude Code harness repository: installable products, execution routes, enforcement controls, operations, and verification."
resource: README.md
tags: [claude-code, harness, agentic-development, openwiki]
---

# Claude Harness Engine v5

Claude Harness Engine is a Node-based Claude Code plugin scaffold for building and changing software through separated generation and evaluation, ratcheting quality controls, and human review before merge. This repository is the **source harness** (also called Project Zero), not one deployed application: `/scaffold` copies a selected `.claude/` runtime into a target project, where its skills, hooks, scripts, state, and Git hooks operate.

Start with the source product guide in `README.md` for installation and command cards. `CODEBASE_MAP.md` is the repository’s hand-authored source-location map; this wiki is the concise, change-oriented synthesis.

## Choose the right starting path

| Need | Start here | Why |
| --- | --- | --- |
| Understand the runtime boundary and what actually blocks work | [Control plane](architecture/control-plane.md) | Settings wire Claude lifecycle events to hooks; manifest-backed, tiered sensors govern changes. |
| Select a SKU or route a new request | [Product routes](workflows/product-routes.md) | Explains `harness-core`, `harness-full`, `harness-lite`, and `/scaffold` → `/build`/`/feature`/`/sprint` → `/auto` → `/gate`. |
| Resume work, update existing code safely, or avoid duplicate structure | [Continuation and reuse](workflows/continuation-and-reuse.md) | Covers durable progress, graph refresh, session chaining, brownfield discovery, and reuse-or-justify intake. |
| Package, upgrade, observe, or operate headlessly | [Delivery and observability](operations/delivery-observability.md) | Covers SKU artifacts, upgrade boundaries, telemetry, Symphony, and scheduled automation. |
| Change harness behavior or decide what to run before merge | [Verification](quality/verification.md) | Maps deterministic tests, live certification, CI, and focused checks to the changed surface. |

## Mental model

The harness uses a generator/evaluator loop: implementing agents produce changes while evaluator and reviewer agents assess them from independent context. [Product routes](workflows/product-routes.md) select the appropriate level of planning and human approval; the [control plane](architecture/control-plane.md) applies policy during tool use, saves, commits, and session completion. The workflow persists progress and navigation artifacts as described in [continuation and reuse](workflows/continuation-and-reuse.md), while [verification](quality/verification.md) supplies the deterministic and live evidence required to trust a change.

## Repository landmarks

- `.claude/` is the distributable runtime: commands, skills, agents, hook wiring, Git hooks, scripts, templates, and state seeds.
- `HARNESS.md` and `harness-manifest.json` own the human and machine views of guides × sensors; do not add a control in only one place.
- `project-manifest.json` configures this dogfooding monorepo. Its architecture enforcement is disabled because this plugin control plane is not a layered product application; it still uses the `standard` sensor tier and agent-readiness ratchet.
- `harness-lite/` is a separate artifact-only plugin. `symphony_clone/` is a separate Docker-based tracker-to-PR orchestrator, not a harness SKU dependency.
- `test/` contains deterministic contract/unit coverage; `test/e2e/` is the Claude-spawning, profile-driven certification surface.
- `open_wiki/` is a repository-specific wrapper for OpenWiki 0.2 and historically stores generated pages under `open_wiki/wiki/`. It is distinct from this canonical `/openwiki` documentation run.

## Change principles

1. **Preserve writer/grader separation.** Do not make an implementer the authority for its own result; retain evaluator and fresh-context reviewer paths.
2. **Keep the manifest and delivery allowlists honest.** A sensor needs real wiring; a new skill or script is not automatically delivered by every scaffold profile.
3. **Treat state and baselines as policy.** Coverage, control-budget, readiness, coupling, clone, and cycle ratchets compare persisted baselines; change them deliberately with evidence.
4. **Use the target route, not a shortcut.** Existing-code feature work should begin with `/feature` or `/brownfield`; behavior changes need the test-first `/change` lane; disposable docs, research, and mockups use Lite/artifact lanes.
5. **Review operating boundaries before enabling autonomy.** The unattended permissions profile, local telemetry defaults, and Symphony’s non-interactive execution each have explicit containment requirements in [delivery and observability](operations/delivery-observability.md).

## Backlog

- **Full sensor-by-cadence matrix** — `harness-manifest.json`, `.claude/settings.json`, and `.claude/git-hooks/pre-commit`; deferred because this initial pass documents the primary triggers and tiered commit registry without duplicating the large registry.
- **Symphony provider adapters and retry state machine** — `symphony_clone/src/`; deferred because the initial operations page covers the product boundary and safe deployment posture rather than every adapter implementation.
