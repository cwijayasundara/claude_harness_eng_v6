---
type: Technical Overview
title: Claude Harness Engine v5 quickstart
description: "Entry point for the Claude Harness Engine v5 repository: a Node.js Claude Code plugin that orchestrates software delivery through routes, lifecycle controls, graph-based navigation, and ratcheting verification."
resource: /README.md
tags: [claude-code, plugin, orchestration, quality, openwiki]
---

# Claude Harness Engine v5

This repository builds a **Claude Code plugin scaffold for long-running software delivery**. It separates generation from evaluation, routes work to an appropriately sized lane, keeps agent context grounded in a repository graph, and applies quality controls before merge. The executable plugin surface lives under [`.claude/`](../.claude/); this repository also dogfoods the scaffold through [`project-manifest.json`](../project-manifest.json).

The product is not an application server. It is a Node.js control system that target projects load with `claude --plugin-dir …`, then use through slash commands, hooks, scripts, and generated project artifacts.

## Start here

### Use the product

1. Build the requested install tree: `npm run package:skus`.
2. Load the default product SKU from a target repository:
   ```bash
   claude --plugin-dir /path/to/claude_harness_eng_v5/dist/skus/harness-core
   ```
3. In Claude Code, scaffold the target project with `/scaffold`.
4. Choose a public route:
   - `/build` for a new product;
   - `/feature "<request>"` for normal work in existing code;
   - `/sprint <prd-file>` for the next increment of a product with a living design;
   - `/gate` for pre-merge quality verification.

`README.md` is the canonical installation and usage guide. It defines `harness-core` as the normal product install, `harness-full` as the optional wider surface, and `harness-lite` for disposable, non-product artifacts. [Packaging, scaffolding, telemetry, and CI](operations/packaging-and-observability.md) explains why installation scope is distinct from runtime enforcement tier.

### Work on this repository

- Fast deterministic suite: `npm test`
- Lint harness code: `npm run lint`
- Live/certification packs: `npm run test:e2e:fast`, `npm run test:e2e:live`, or `npm run test:e2e:cert`
- Package artifacts: `npm run package:skus`
- Project-Zero readiness ratchet: `npm run agent-readiness:assert`

Do **not** use `node --test test/`; the package script intentionally scopes fast tests and prevents expensive Claude-spawning E2E work from being included. See [verification guidance](quality/verification.md) for test layers and targeted checks.

## How the system fits together

```text
User request
  -> route skill (/build, /feature, /sprint, /change, /vibe, /refactor)
  -> planning and context retrieval (code graph / DeepWiki / context-pack)
  -> implementation loop (/auto or bounded lane)
  -> lifecycle hooks and commit gates
  -> independent evaluation / review / quality receipt
  -> human-owned merge
```

The [workflow routes](workflows/product-routes.md) choose how much planning, human approval, and implementation orchestration a request needs. They operate under the [Claude Code control plane](architecture/control-plane.md), which intercepts prompts, file writes, shell writes, reads, stops, and subagent lifecycle events. The control plane in turn maintains [graph-derived navigation and resumable execution state](workflows/navigation-and-continuation.md), which routes use to avoid broad unguided source exploration.

[Quality verification](quality/verification.md) provides the durable backstops: deterministic tests and structural sensors, independent reviews, integration checks, and periodic drift checks. [Operations](operations/packaging-and-observability.md) packages that surface into SKUs, scaffolds it into target repositories, and exposes run/telemetry/CI signals.

## Major concepts

| Concept | Canonical page | Why it matters |
| --- | --- | --- |
| Lifecycle control plane | [Control plane](architecture/control-plane.md) | Hooks enforce scope, secrets, cache safety, test-first and structural policies around native Claude Code tool events. |
| Product and change routes | [Product routes](workflows/product-routes.md) | Routes keep greenfield, brownfield, small-change, refactor, and artifact work from applying the same ceremony indiscriminately. |
| Context and resume loop | [Navigation and continuation](workflows/navigation-and-continuation.md) | A dirty graph → refresh → context-pack loop lets agents identify symbols and impacts before editing; persisted state allows recovery across sessions. |
| Verification system | [Verification](quality/verification.md) | The declared guide/sensor model maps quality controls across planning, session, commit, integration, and drift cadences. |
| Distribution and operators | [Packaging and observability](operations/packaging-and-observability.md) | SKU selection, scaffolding, telemetry, CI, and scheduled automation determine what a target repo receives and how it is operated. |

## Current implementation focus

The most recent committed change (at the initialization HEAD) added **reuse-or-justify** intake wiring. In the brownfield `/change`, `/feature`, and `/sprint` routes, `reuse-scout` is run before implementation/design intake when behavior is added or materially extended. If its confidence-gated signal fires, the route invokes the dialogue and records whether work extends an existing seam or justifies a new structure, including relevant invariant and budget context. The detailed behavior and its place in the routes are documented in [product routes](workflows/product-routes.md).

## Source-of-truth guide

- **Usage and installation:** [`README.md`](../README.md)
- **Always-loaded behavioral rules:** [`CLAUDE.md`](../CLAUDE.md)
- **Human control-system reference:** [`HARNESS.md`](../HARNESS.md)
- **Machine control inventory:** [`harness-manifest.json`](../harness-manifest.json)
- **System rationale:** [`design.md`](../design.md)
- **Current repository navigation:** [`docs/CODEBASE.md`](../docs/CODEBASE.md) and `specs/brownfield/`

The manifest is a registry, not the only runtime dispatcher: actual enforcement paths are configured in [`.claude/settings.json`](../.claude/settings.json), the Git hook dispatcher, and skill procedures. When changing a control, trace all relevant locations and run its focused test plus `npm test`.

## Working-tree note

This initial wiki reflects committed source evidence at `20a6b50`. The checkout also had uncommitted edits to legacy documentation/DeepWiki files, a pending OpenWiki workflow, and new OpenWiki-related files. Those changes are intentionally not presented as established behavior here; inspect `git status` and their diffs before relying on or extending them.

## Backlog

- **Symphony tracker orchestrator** — `symphony_clone/` and `docs/symphony-product.md`: separate product boundary with its own source and tests; deferred to keep this initial harness-focused wiki concise.
- **Framework and vertical skill packs** — `.claude/skills/{fastapi-code,react-code,langchain-code,langgraph-code}/`: optional implementation packs are installed through the full surface; their stack-specific behavior is deferred.
