---
type: Runtime Control Plane
title: Harness control plane
description: "How Claude Harness Engine wires lifecycle hooks, policy gates, manifests, state, and trust boundaries into generated target projects."
resource: .claude/settings.json
tags: [architecture, controls, hooks, quality]
---

# Harness control plane

The harness is an **agent-development control plane**, not an application server. `/scaffold` installs selected runtime files into a target project; `.claude/settings.json` then attaches policy to Claude Code events, and `.claude/git-hooks/pre-commit` extends that policy to commits. The [product routes](../workflows/product-routes.md) use this runtime to coordinate development, while [verification](../quality/verification.md) tests its contracts.

## Sources of truth and configuration

`HARNESS.md` describes the control system as feedforward guides and feedback sensors across maintainability, architecture, behaviour, and traceability. `harness-manifest.json` is the machine-readable inventory behind that narrative. A control is not fully implemented merely because a script exists: its status, `wired_at` location, cadence, and scope must match real execution.

`project-manifest.json` supplies project-specific posture. In Project Zero, `architecture.enabled` is `false` because the harness plugin is not itself a layered product app; `quality.sensor_tier` remains `standard`, and agent readiness is a non-regression ratchet. Generated product projects may instead enable layer/context rules.

## Event-to-control flow

`.claude/settings.json` is the live wiring:

```text
SessionStart       → check Git-hook installation
PreToolUse Write   → pre-write policy gate
PreToolUse Bash    → shell-write and Git-safety gate
PostToolUse edit   → verification and graph-dirty receipt
Stop/SubagentStop  → review, continuation, graph/navigation refresh, run receipt
git commit         → tier-filtered pre-commit registry
```

- `pre-write-gate.js` blocks prohibited target paths, protected prompt-prefix/settings files, `.env` writes, detected secret patterns, and certain size/TDD/coverage violations before direct edit tools run.
- `pre-bash-gate.js` closes the shell-write bypass by examining write-like shell commands, protecting the same critical boundaries where command-string analysis is possible, and rejecting unsafe Git operations during parallel work.
- `verify-on-save.js` performs source-edit checks and marks navigation artifacts dirty. `graph-refresh.js` does the more expensive incremental graph, symbol, wiki, and navigation refresh at stop boundaries; graph-dependent policy therefore depends on a successful refresh.
- `review-on-stop.js`, `auto-continue-on-stop.js`, and `record-run.js` respectively provide review advisories, continuation behavior, and local/remote receipts.

The [continuation and reuse workflow](../workflows/continuation-and-reuse.md) consumes the refreshed graph and durable receipts rather than treating each Claude session as stateless.

## Commit sensors and tiers

`.claude/git-hooks/pre-commit` delegates to `.claude/hooks/lib/gate-registry.js`. The registry orders controls, runs a small docs-only phase first, exits early when no source is staged, then runs source-sensitive controls and custom sensors. It records successful outcomes through `sensor-outcomes.jsonl`, which supports loop-health and sensor-value analysis.

`minimal`, `standard`, and `strict` are selected from `HARNESS_SENSOR_TIER` or `project-manifest.json#quality.sensor_tier`. `standard` is the default product posture. Across relevant source changes it includes secret and amendment checks, test-deletion/stub/live-external guards, refactor/layer/context/ownership rules when configured, legacy discipline, sprout and acceptance-test proof, contract/type/coverage/mutation checks. `strict` adds cycle, coupling, and duplication ratchets when graph prerequisites are present. The full membership table belongs in `docs/product-skus-and-tiers.md`.

## Trust and failure boundaries

Target-project agents are deliberately prevented from rewriting their own hooks, Git hooks, settings, and other protected enforcement machinery. The trust-boundary helpers exempt this repository so the harness can develop itself; do not assume that exemption applies to a scaffolded target.

Controls do not all fail in the same way. Policy violations usually block. Some optional analysis dependencies degrade loudly or skip when unavailable, and the pre-commit dispatcher logs rather than hard-failing if its own runner crashes. When changing a control, state its actual trigger and failure behavior; do not describe report-only or unavailable-tool behavior as unconditional enforcement.

## Change checklist

1. Read `HARNESS.md`, `harness-manifest.json`, and `docs/prompting-standards.md` before adding or changing a gate, hook, agent, or skill prompt.
2. Update all three concerns: implementation/wiring, manifest truth, and scaffold delivery allowlist. `scaffold-copy.js` intentionally uses explicit profiles, so a new runtime file is not automatically shipped.
3. Preserve baseline semantics. Coverage, clone, cycle, coupling, readiness, and control-budget checks are ratchets against tracked state—not arbitrary fixed targets.
4. Run the focused hook/registry/scaffold tests and the [verification](../quality/verification.md) commands appropriate to the changed trigger.
