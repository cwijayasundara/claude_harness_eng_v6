---
type: Runtime Architecture
title: Claude Code lifecycle control plane
description: "How Claude Harness Engine v5 uses Claude Code hooks, shared hook libraries, manifests, and Git gates to steer and verify agent actions across a session."
resource: /.claude/settings.json
tags: [architecture, hooks, controls, security, claude-code]
---

# Claude Code lifecycle control plane

The harness implements a **control plane around native Claude Code actions**, rather than replacing them. Its declarative model in [`harness-manifest.json`](../../harness-manifest.json) distinguishes feedforward *guides* from feedback *sensors* across maintainability, architecture, behaviour, and traceability. Native event routing in [`.claude/settings.json`](../../.claude/settings.json) makes that model operational.

This control plane **enables the workflow routes** in [product routes](../workflows/product-routes.md): a route supplies process intent, but tool hooks and Git gates constrain the actual reads, writes, commands, and commits. It also **maintains the navigation loop** in [navigation and continuation](../workflows/navigation-and-continuation.md) after source changes.

## Lifecycle wiring

| Claude Code event | Main handler(s) | Runtime purpose |
| --- | --- | --- |
| Session start | `check-git-hooks.js` | Report whether commit-time protection is installed. |
| Prompt submission | `artifact-guard.js`, `record-run.js` | Prevent SDLC commands in artifact-only contexts and record route/lane activity. |
| Before subagent dispatch | `concurrency-gate.js`, `record-run.js` | Enforce bounded parallelism and record agent work. |
| Before `Write` / `Edit` / `MultiEdit` | `pre-write-gate.js` | Reject unsafe or policy-breaking source mutations before persistence. |
| Before `Read` / `Bash` | `token-advisor.js` | Advise—or when configured, block—unguided expensive context use. |
| Before `Bash` | `pre-bash-gate.js` | Apply the shell-write safety subset and Git safety constraints. |
| After file writes | `verify-on-save.js` | Check configured source rules and mark graph artifacts dirty. |
| Session/subagent stop | `review-on-stop.js`, `auto-continue-on-stop.js`, `graph-refresh.js`, `record-run.js` | Surface learning, resume eligible work, refresh derived navigation, and record telemetry. |

The configuration names `Task` for subagent hooks. The concurrency implementation and tests also recognize `Agent` as a compatibility path, so edits must preserve both the configured and observed tool-event behavior.

## Write-time safety boundary

`pre-write-gate.js` simulates the proposed content before disk mutation. It applies project/symlink scope controls, harness trust-boundary protection, prompt-cache-prefix protection, protected environment-file policy, inserted-content secret scanning, configured security rules, ratcheted file/function length limits, test-first requirements, and coverage preflight for mapped legacy symbols.

The pre-Bash gate is intentionally narrower: shell commands may write files, but arbitrary shell content cannot receive the same reliable content-level analysis. It protects scope, harness boundaries, cache-prefix files, protected environment files, and destructive parallel Git operations. Source changes should therefore prefer native edit tools, which receive the complete pre-write policy.

`verify-on-save.js` performs the persisted-artifact half: layer/bounded-context checks and provisioned lint/type checks, then appends changed indexed paths to `.claude/state/graph-dirty.jsonl`. That dirty signal **triggers** the graph refresh described in [navigation and continuation](../workflows/navigation-and-continuation.md).

### Safety properties to retain

- Controls should be **fail-visible**: an unavailable optional tool should degrade loudly or log a reason, not silently claim success.
- Hooks use bounded input parsing and shared utilities in `.claude/hooks/lib/`; do not reimplement scope/path behavior in a single hook.
- The unattended `settings.auto.json` profile only removes interactive permission prompts. It does not disable these deterministic hooks or Git gates, and should run inside an isolation boundary rather than on a secret-bearing host.

## State and control configuration

[`project-manifest.json`](../../project-manifest.json) is the repository’s Project-Zero policy configuration: it selects a CLI/library topology, standard sensor tier, balanced model tier, token governor enforcement, review thresholds, and readiness ratchet. Target projects receive comparable configuration through the scaffold path documented in [packaging and observability](../operations/packaging-and-observability.md).

The manifest registry is a **documentation and consistency anchor**, not a standalone dispatcher. It points at real files through `wired_at`, and tests validate active/partial entries. A change that adds a control normally has to update:

1. the hook, command/skill, or Git registry that executes it;
2. the manifest entry and applicable cadence/tier declaration;
3. focused behavior/wiring tests; and
4. route documentation if the control changes how work proceeds.

## Commit boundary

The session control plane is complemented by `.claude/git-hooks/pre-commit`, which delegates to `.claude/hooks/lib/gate-registry.js`. This is a durable backstop for changes created outside an interactive hook-enabled session. Gate selection follows the sensor tier and may include secret scanning, ownership/trace controls, test-deletion protection, coverage/mutation checks, contract checks, and—in strict mode—structural ratchets.

The complete tier model and validation strategy live in [quality verification](../quality/verification.md). Together, hooks provide fast feedback while Git gates ensure that bypassing a session-time recommendation does not become a merge path.

## Change checklist

When modifying the control plane:

- Start with `.claude/settings.json` to see whether a new hook is actually invoked.
- Read the corresponding `test/<control>.test.js` and wiring contract before editing implementation.
- Preserve fail-open/fail-visible semantics deliberately; do not accidentally turn unavailable optional tooling into a silent pass or a permanent blocker.
- Update the manifest only when its operational claims change, then run manifest validation and focused tests.
- Run `npm test` plus relevant hook, pre-commit, or security tests. For user-facing behavior shifts, also inspect [product routes](../workflows/product-routes.md).
