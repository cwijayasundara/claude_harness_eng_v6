---
type: Verification Guide
title: Harness verification model
description: "How deterministic Node tests, contract checks, live Claude end-to-end profiles, CI, and readiness ratchets validate changes to the Claude Harness Engine."
resource: docs/testing.md
tags: [quality, testing, ci, evaluation]
---

# Harness verification model

Verification is layered to prove both local harness contracts and real Claude-driven behavior. The [control plane](../architecture/control-plane.md) blocks selected policy violations at lifecycle and commit boundaries; this page explains the developer and CI evidence that tests that control plane and the [product routes](../workflows/product-routes.md).

## Default local checks

```bash
npm run lint
npm test
npm run agent-readiness
npm run agent-readiness:assert
```

`npm test` runs Node’s deterministic unit and contract tests (`test/*.test.js` plus E2E helper tests) without sweeping in costly Claude-spawning scenarios. Do not replace it with `node --test test/`; Node treats the bare directory as a module and the command does not express the intended test selection.

The test directory is organized around high-value contracts: hook behavior, Git gate ordering/tiering, skill/command wiring, scaffold profiles, packaging, graph/navigation, telemetry, state recovery, and regressions. For a local change, run the narrow test file nearest to the changed entrypoint first, then the standard suite.

## Live and certification profiles

`test/e2e/run-pack.js` is the profile-driven runner:

| Command | Scope |
| --- | --- |
| `npm run test:e2e:fast` | No live Claude or local server; contracts and safe helpers. |
| `npm run test:e2e:smoke` | Narrow smoke coverage. |
| `npm run test:e2e:live` | Live plan, semi-auto, auto, full-auto, gated, feature, brownfield, and browser-relevant routes as selected by the pack. |
| `npm run test:e2e:cert` | Certification stack, including telemetry-aware checks. |
| `npm run test:e2e:all` | Fast → live → certification. |

The runner uses watchdogs, detached process cleanup, layer-specific logs, and `test/e2e/results/e2e-pack-summary.json`. Certification can start the telemetry Compose stack. `E2E_KEEP_ARTIFACTS=1` preserves generated artifacts for debugging.

Use live/cert selectively: they cost time and model budget, and require the Claude/Docker prerequisites. Model-based evals are intentionally non-blocking in CI when their external credential is absent (for example, on forked PRs).

## CI and ratchets

The main CI workflow runs lint, deterministic tests, the agent-readiness report/assertion, and a core-SKU smoke test on PRs and mainline changes. Project Zero’s `project-manifest.json` configures readiness as a ratchet: at least five active pillars and no regression from the committed baseline. Scaffolded product projects generally use report mode instead.

This is separate from the commit-time sensor tier. `standard` retains the normal pre-commit controls; `strict` adds architecture/duplication ratchets when graph support exists. See the [control plane](../architecture/control-plane.md) for runtime triggers and `docs/product-skus-and-tiers.md` for the detailed membership table.

## Test by changed area

| Changed area | Minimum focused evidence | Escalate when |
| --- | --- | --- |
| Hook, gate, trust boundary, or sensor tier | Relevant `test/pre-*-gate*`, registry, hook-security, and manifest tests; `npm test` | Event wiring, blocking semantics, or cross-hook behavior changes. |
| Skill, command, agent prompt, or route | Route/skill consistency/wiring tests; `npm test` | It changes a public lane, approvals, autonomous progression, or PR behavior: run targeted live E2E. |
| Scaffold/profile/package | Scaffold-copy/apply/upgrade and package-SKU tests; build a relevant SKU | The copied runtime or plugin structure changes: run core smoke/E2E fast. |
| Graph, brownfield, continuation, or reuse | Graph refresh/navigation, pipeline-state, reuse-scout/decision, and route-wiring tests | It changes recovery, map correctness, or existing-code planning: run applicable live routes. |
| Telemetry/Symphony | Telemetry/unit contracts plus Compose or service checks | Pipeline metrics, Docker, tracker, or non-interactive Claude behavior changes: run certification or service-specific tests. |

Use `npm run test:e2e:fast` as the usual broad integration escalation. Use live/cert when the changed behavior depends on a real Claude invocation, browser, telemetry stack, tracker boundary, or actual generated target project.

## Quality invariants

- A green deterministic suite does not substitute for real-artifact validation. Integration/contract fixtures should round-trip the actual schema/validator rather than a hand-shaped approximation.
- Do not bypass test deletion, stub, secret, or coverage controls to force green. The [control plane](../architecture/control-plane.md) treats these as enforcement boundaries.
- Keep evaluator/reviewer independence in testable route wiring; generator self-certification is not equivalent evidence.
- For control additions, also run manifest validation and the control-budget check: new controls need replacement or explicit net-add justification.
- Treat generated E2E output and local run logs as diagnostic artifacts unless a source contract explicitly makes them deliverables.
