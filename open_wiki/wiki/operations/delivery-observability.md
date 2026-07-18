---
type: Operations Guide
title: Delivery, observability, and headless orchestration
description: "Packaging, scaffold upgrades, telemetry infrastructure, Symphony tracker dispatch, and scheduled documentation or upstream monitoring for the harness."
resource: docs/product-skus-and-tiers.md
tags: [operations, packaging, telemetry, symphony]
---

# Delivery, observability, and headless orchestration

The [product routes](../workflows/product-routes.md) are delivered as plugin directories, can be safely refreshed in target projects, and emit operational evidence through a non-blocking telemetry stack. This repository also ships Symphony as a separate, containerized tracker-to-PR product boundary.

## Package and release the harness

`.claude/scripts/package-sku.js` builds `harness-core`, `harness-full`, and `harness-lite` under `dist/skus/`, stamping each tree with the root version. Run:

```bash
npm run package:skus
npm run package:core
npm run package:lite
```

`.claude/scripts/release-skus.js` creates distributable tarballs under `dist/release` and prints a suggested GitHub release command. It does not publish by itself; marketplace, tarball, and interim-clone distribution remain an operator procedure documented in `docs/marketplace-publish.md`.

Before release, confirm the source/version/changelog alignment, inspect profile boundaries, and run the focused package plus [verification](../quality/verification.md) checks. In particular, treat the core allowlist in `scaffold-copy.js` as product functionality: omitted runtime dependencies can produce an apparently successful but incomplete scaffold.

## Upgrade target projects deliberately

`/scaffold-upgrade` and `.claude/scripts/scaffold-upgrade.js` default to dry run. On `--apply`, they update hooks, scripts, Git hooks, and agents while preserving target configuration and runtime state. Skills require `--include-skills`, which is intentionally an explicit prompt-surface decision.

Use upgrades as a controlled migration: inspect the plan, preserve target-owned customizations, include skills only when the target is ready for changed workflow instructions, and run target-relevant verification afterward. The [control plane](../architecture/control-plane.md) explains why settings and enforcement machinery are protected from arbitrary target-agent writes.

## Telemetry is evidence, not a build dependency

Scaffolded projects default to native Claude OTEL plus harness Pushgateway metrics. The harness monorepo itself keeps telemetry off. The hook push has a two-second timeout and swallows connection errors, so unavailable telemetry does not break a build loop.

`telemetry_docker_compose.yml` provides a shared local stack:

```text
Claude Code OTLP → OTEL Collector → Prometheus → Grafana
Harness hook push → Pushgateway ────────┘
```

The stack exposes Collector `4317/4318`, Prometheus `9090`, Pushgateway `9091`, and Grafana `3001`. Native metrics include tokens, cost, sessions, code-edit decisions, commits, and PRs; `record-run.js` supplies harness lane/agent/turn/review metrics and local JSONL receipts. Pipeline gauges underpin the `/status` view and Grafana pipeline dashboard.

The checked-in Grafana defaults (`admin` / `harness`) and anonymous viewer access are local-development defaults, not a remote-production security posture. Before remote rollout, replace defaults, choose access policy, set distinct `HARNESS_USER` values, validate Prometheus targets, and restart Claude sessions after settings changes. Cache-health rules/dashboard are documented in `telemetry/CACHE_MONITORING.md`.

## Symphony: separate tracker-to-PR service

`symphony_clone/` is an opt-in Docker service that adapts Linear, Jira Cloud, or Azure DevOps Boards into claimed dependency-group work. It creates isolated workspaces/branches, invokes Claude non-interactively, opens GitHub PRs, posts tracker evidence, and uses retries/backoff.

It is not installed with any harness SKU. Its Docker configuration uses named volumes and a non-root container, but the runtime remains privileged: its default Claude command uses `--permission-mode bypassPermissions`, it can use host SSH read-only, and auto-merge can be enabled through configuration. For production, start with low concurrency, minimum-scoped tracker/GitHub credentials, restricted SSH/network exposure, proven branch protection, and auto-merge disabled until required checks are verified.

## Scheduled automation

`.github/workflows/openwiki-update.yml` runs a daily OpenWiki update and opens a PR. `.github/workflows/upstream-watch.yml` checks upstream Claude Code changes weekly and opens an issue on drift. Review these generated PRs/issues; they are discovery inputs, not evidence that a change is safe to merge without ordinary verification.

## Operations checklist

- **Packaging/release:** run package commands, inspect SKU contents, execute focused tests, and use the documented manual publishing procedure.
- **Telemetry changes:** validate Compose/config/rules and local dashboard behavior; preserve the non-blocking error path.
- **Symphony changes:** test tracker transitions, retry/reclaim behavior, isolated workspace cleanup, and authorization boundaries; use the appropriate live/cert [verification](../quality/verification.md) profile.
- **Workflow changes:** keep scheduled automation secrets in managed CI configuration; do not place credentials in repository configuration or documentation.
