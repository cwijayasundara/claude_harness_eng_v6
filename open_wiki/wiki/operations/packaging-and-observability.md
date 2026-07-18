---
type: Operations Guide
title: Packaging, scaffolding, telemetry, and automation
description: "How the harness is emitted as plugin SKUs, copied into target projects, observed through local receipts and optional telemetry, and checked by CI and scheduled automation."
resource: /.claude/scripts/package-sku.js
tags: [operations, packaging, scaffold, telemetry, ci]
---

# Packaging, scaffolding, telemetry, and automation

The repository is the source tree; consumers load emitted plugin trees. Packaging and scaffolding therefore determine whether the [workflow routes](../workflows/product-routes.md), [control plane](../architecture/control-plane.md), and [verification system](../quality/verification.md) are actually present in a target project.

## Install boundaries: SKUs

`npm run package:skus` invokes `package-sku.js` and produces flat Claude plugin trees under `dist/skus/`.

| SKU | Intended use | Contents |
| --- | --- | --- |
| `harness-core` | Normal product development | Lean build/feature/gate spine plus brownfield discipline. |
| `harness-full` | Teams requiring the optional surface | Core plus optional skills, framework/vertical packs, full plugin set, and telemetry templates. |
| `harness-lite` | Disposable artifacts only | Separate artifact-oriented loadout with no SDLC/GAN/quality hook surface. |

Core and full reuse `scaffold-copy.js`; core takes explicit allowlists while full copies the full `.claude` tree. Lite is emitted from its distinct `harness-lite/` source. Each output receives the root package version in its plugin metadata. `release-skus.js` builds/tars release artifacts but does not publish them itself.

SKU selection is an **installation scope**. The `sensor_tier` described in [verification](../quality/verification.md) is a **runtime policy dial** after installation; do not treat full/core/lite as synonyms for strict/standard/minimal.

## Scaffolding target projects

`/scaffold` and its scripts render/copy harness content into a target project. `scaffold-render.js` derives topology defaults and writes project configuration; `scaffold-apply.js` copies the selected profile, creates state/output locations, initializes navigation, optionally configures telemetry, and can opt into a drift workflow. `scaffold-copy.js` is the dependency boundary that ensures copied skills, scripts, hooks, and Git-hook dependencies arrive together.

Important consequences:

- A newly required core script, skill, or agent must be added to the core selection policy, not just created in `.claude/`.
- `.claude/package.json` is copied to preserve CommonJS behavior when the host project is ESM.
- Git hooks depend on nearby hook libraries; trimming files by directory appearance can create a runtime-broken emitted plugin.
- Framework packs are additive and must remain consistent between manifest derivation and copied files.

Tests such as `scaffold-copy`, `scaffold-apply`, `package-sku`, and scaffold command contracts protect these relationships. For a packaging change, run their focused tests, `npm test`, package the relevant SKU, and inspect its emitted tree.

## Telemetry and local evidence

Run observation has two paths that converge in Prometheus when telemetry is configured:

```text
Claude Code native OTLP metrics -> OTEL Collector -> Prometheus
record-run hook -> local run receipts + telemetry ledger -> telemetry-memory -> Pushgateway -> Prometheus
```

`record-run.js` records route/lane, tool use, subagent completion, stop events, and selected model/token metadata to `.claude/runs/` and a local telemetry ledger. Export requires a configured Pushgateway URL and is deliberately non-blocking; collection transport failures should not stop development. `telemetry-memory.js` aggregates/pushes bounded metrics, while pipeline gauges share the snapshot/state used by status tooling.

This local-first design **observes the workflow routes** without making them dependent on an available monitoring system. Do not add raw prompts, free-text identifiers, or unbounded path/ID labels to exported metrics.

### Telemetry caveat

Existing telemetry prose has inconsistent activation wording. Scaffold code and tests implement telemetry as an opt-in (`--telemetry` or profile setting), even though some documentation describes it as default-on. Treat code/tests as the operational source and keep `settings.json`/`settings.auto.json`—not a `.env` file alone—as the activation source for Claude Code configuration.

## CI and scheduled automation

`.github/workflows/ci.yml` runs dependency installation, lint, deterministic tests, Project-Zero readiness checks, a core-SKU packaging smoke check, and a full-history secret scan. Model-backed evals are isolated and may no-op successfully when credentials are absent. Lite/full have unit packaging coverage, but only core receives the CI emitted-artifact smoke check.

Scheduled workflows are operationally distinct from CI:

- `openwiki-update.yml` invokes OpenWiki and opens/updates a documentation PR.
- `upstream-watch.yml` tracks external snapshots and uses write-level repository automation.

These workflows carry write permissions and should be reviewed as automation/security surfaces. The OpenWiki workflow and related local changes present in this checkout were uncommitted at initialization time, so they are not documented as stable repository behavior beyond their file-level purpose.

## Operator commands

- `npm run status` — render pipeline state.
- `npm run drift` — report accumulated architectural/dependency/dead-code drift.
- `npm run agent-readiness` / `npm run agent-readiness:assert` — report/assert Project-Zero readiness against its baseline.
- `npm run retention:dry` / `npm run retention` — preview or prune run/state retention.
- `npm run package:skus` — emit all installable plugin trees.

## Change checklist

1. For SKU changes, update copy/allowlist policy and emitted-artifact tests together.
2. For scaffold changes, trace topology defaults, manifest rendering, copy behavior, and target-project state initialization.
3. For a telemetry field, update the receipt schema, aggregation/export, bounded labels, operator docs/dashboards/rules if applicable, and behavior tests.
4. Keep telemetry export failure-tolerant and scheduled automation explicitly opt-in where that is the existing policy.
5. Before a release, align versions/changelog/docs, run lint/tests/readiness assertion, emit artifacts, and verify the intended SKU excludes/includes the correct surface.
