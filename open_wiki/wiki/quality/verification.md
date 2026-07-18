---
type: Quality System
title: Verification, ratchets, and test strategy
description: "The harness quality model: guides and sensors across planning, session, commit, integration, and drift cadences, with sensor tiers and layered automated validation."
resource: /harness-manifest.json
tags: [quality, testing, gates, sensors, review]
---

# Verification, ratchets, and test strategy

The harness defines an agent as **model plus harness**: guides steer work before it happens, sensors detect issues after it happens, and a human steering loop adjusts future work. [`harness-manifest.json`](../../harness-manifest.json) is the machine-readable registry for that model; [`HARNESS.md`](../../HARNESS.md) is its long-form control-system companion.

Verification is not a final command alone. The [control plane](../architecture/control-plane.md) provides fast session feedback, while workflow routes invoke independent tests/reviews and the pre-commit dispatcher provides a durable backstop. The resulting separation prevents an implementer from being the only judge of its own work.

## Cadences and roles

| Cadence | Question answered | Typical controls |
| --- | --- | --- |
| Planning | Is the intended work grounded, traced, and feasible? | BRD grounding, trace/vocabulary checks, plan/seam confidence, architecture/design guidance. |
| Session | Is this tool action safe and locally valid? | Pre-write scope/secrets/TDD/coverage controls, on-save lint/types/layers, token guidance. |
| Commit | Can this diff be recorded safely? | Git pre-commit registry, coverage/mutation, contracts, ownership, preservation evidence, structural ratchets. |
| Integration | Does a running product satisfy contracts and user flows? | Evaluator API checks, Playwright, accessibility, performance/SLO, regression and independent review. |
| Drift | Has quality decayed outside a current change? | Architecture/dependency/dead-code drift, flake and sensor-health reports. |

A guide can be prompt/skill policy, while a sensor is deterministic, inferential (LLM judgement), or hybrid. Their `wired_at` paths and declared statuses are validated by manifest tests, but execution still depends on real hook, skill, Git-hook, and CI wiring.

## Sensor tiers at commit time

`project-manifest.json#quality.sensor_tier` selects complexity **within** a product install; it is not an SKU selector.

- **minimal** preserves secrets and configured structural/contract basics for lower-ceremony CLI/library shapes;
- **standard** is the default product posture and retains behavior-preservation, test, coverage, mutation, ownership, and trace controls;
- **strict** adds structural ratchets such as cycle and coupling detection when graph evidence is available.

The Git pre-commit hook delegates selection to `gate-registry.js`. Optional/conditional controls may skip loudly when their prerequisites—such as architecture configuration, graph data, or a provisioned external scanner—are absent. A local `HARNESS_*_GATE=off` setting is an unreviewed escape, not the preferred policy path; the documented alternatives are fixing the issue, a reviewed expiring waiver, or changing the tier only when the project shape warrants it.

## Core verification flows

### Change preservation and traceability

Brownfield routes require a story/acceptance criteria, context pack, seam choice, coverage preflight, and red-first tests before production behavior changes. Commit-time controls then backstop that discipline with ownership, legacy/pin-down/sprout evidence, acceptance-test receipts, contract/verification-matrix checks, and test-deletion/stub/live-external protections where applicable.

The current reuse-or-justify intake extends this traceability flow: when scout confidence calls for a decision, the record names reuse/new-seam rationale, invariant impact, and budget before implementation. [Product routes](../workflows/product-routes.md) has the route-level behavior; [navigation and continuation](../workflows/navigation-and-continuation.md) explains the graph evidence it consumes.

### Independent review and runtime confirmation

The harness uses fresh-context code review rather than implementer self-review. Review tier selection can move from one reviewer to two independent adversarial reviewers for large, security-boundary, or strict work, then merges verdicts under the configured policy. Security review is boundary-gated; evaluator layers cover live API contracts, browser flows, and—in full mode—design criticism.

Pre-merge quality receipts aggregate evaluation, reviews, security, observability, performance, regression, and ownership evidence into a quality card and logical PR walkthrough. `/gate` is the human-invoked pre-merge orchestration surface, but its controls are also used by automatic lanes where specified.

### Structural and quality ratchets

Selected measures are intentionally monotonic: coverage, cycles, unstable hubs/coupling, and duplication use baselines so a project may improve but should not introduce new regressions. Mutation smoke checks whether newly changed production logic is meaningfully tested. The full control inventory distinguishes enforced sensors from report-only/advisory controls; do not describe every report as a blocking gate.

## Test strategy for this repository

| Layer | Command / location | Purpose |
| --- | --- | --- |
| Unit and wiring contracts | `npm test`; `test/*.test.js` | Fast Node tests for hook behavior, scripts, parsing, registry membership, skill composition, and artifact contracts. |
| Lint | `npm run lint` | Checks `.claude/hooks`, scripts, Git hooks, tests, and ESLint configuration. |
| Focused test | `node --test test/<name>.test.js` | Preferred while changing an individual hook/script/skill contract. |
| E2E packs | `npm run test:e2e:{fast,live,cert,all}` | Builds/scaffolds projects through workflow layers; live/cert packs may use Claude and telemetry services. |
| Model-backed evals | `npm run test:evals` | Behavioral eval runner; CI can intentionally no-op if the required provider key is absent. |

`docs/testing.md` is the operational test guide. The suite includes many source/wiring tests because routes and controls are expressed across JavaScript, JSON, skills, and generated artifacts. When a behavior depends on a textual skill instruction, add a contract that asserts its wiring in the whole skill corpus, not merely a unit test for a helper function.

## Change checklist

1. Identify the cadence and whether the behavior is a guide, sensor, or both.
2. Trace the runtime route from manifest declaration through settings/Git/skill wiring.
3. Update focused behavior tests and any relevant route/skill corpus contracts.
4. Run `npm test`; run `npm run lint` for code changes; run the targeted E2E or packaging smoke when distribution/workflow behavior changed.
5. Preserve the distinction between **machine enforcement**, **advisory reports**, and **human approval**. The routes described in [product routes](../workflows/product-routes.md) may remove human stops in autonomous modes, but must not quietly remove machine controls.
