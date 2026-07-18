---
type: Workflow Guide
title: Product and brownfield work routes
description: "How Claude Harness Engine v5 selects and conducts greenfield, brownfield, sprint, behavior-change, refactor, and artifact-only workflows while preserving human merge ownership."
resource: /.claude/skills/feature/SKILL.md
tags: [workflows, skills, brownfield, greenfield, governance]
---

# Product and brownfield work routes

The harness deliberately does not apply one process to every request. Its public surface is small—`/build`, `/feature`, `/sprint`, and `/gate`—while internal skills compose planning, implementation, evaluation, and evidence behind those entry points. The routes execute under the [lifecycle control plane](../architecture/control-plane.md) and use [graph-based context and recovery](navigation-and-continuation.md) instead of letting an agent repeatedly rediscover the repository.

## Route selection

| Request shape | Primary route | Key boundary |
| --- | --- | --- |
| New product / PRD | `/build` | Produces BRD → stories/specification → design/test plan → `/auto`; approval mode controls human stops, not machine checks. |
| Existing code feature or normal change | `/feature "<request>"` | Keeps the committed DeepWiki current, decomposes and selects a safe lane, then opens PR(s). |
| Next PRD for an existing product | `/sprint <prd-file>` | Grounds the increment against prior requirements and evolves the living design by amendment rather than regeneration. |
| One bounded behavior change | `/change` | Story- or issue-driven, test-first behavior change; routes out when scope or risk does not fit. |
| Structure-only work | `/refactor` | Must preserve observable behavior; mechanical variants require mapping and canary discipline. |
| Tiny, low-risk edit | `/vibe` | Controlled fast lane only; larger, public, security-sensitive, persistent, or ambiguous work escalates. |
| Discovery without implementation | `/brownfield` / `/code-map` | Generates and refreshes graph/wiki/navigation artifacts. |
| Disposable mockup, research, or narrative | artifact lane | Uses `frontend-design`, `/design --doc-only`, or `deep-research`; intentionally does not run SDLC ratchets. |

The small lane is an exception, not a way around quality work. `/change` uses scope and risk signals to redirect no-behavior-change work to `/refactor`, tiny work toward `/vibe`, and multi-story/new-subsystem work toward a brownfield-aware `/build`.

## Greenfield: `/build` feeds `/auto`

`/build` is the conductor for a new product. Its normal route makes requirements, stories, design, and test planning explicit before implementation; it then **dispatches to** `/auto` for the generator/evaluator loop. A plan-only result is not a completed autonomous build. `--autonomous` and `--auto` collapse human approval checkpoints, while tests, architecture checks, evaluator passes, reviews, and diff gates remain active.

For interrupted work, `/auto` relies on persisted progress/state rather than a single conversation. [Navigation and continuation](navigation-and-continuation.md) explains the in-session and cross-process recovery mechanisms.

## Existing code: `/feature` as a thin conductor

`/feature` owns the request-to-reviewed-PR flow in the main session because it must manage human gates and Git workflow. It **delegates to** `/brownfield`, `/code-map`, `/spec`, `/design`, tracker publishing, `/change`, `/auto`, and `/gate`; it should not duplicate their implementation.

Its backbone is:

1. ensure the committed DeepWiki/code graph is current;
2. decompose into a bounded story or epic/dependency groups;
3. plan a seam/layer extension and, where needed, a design delta;
4. publish tracker work;
5. implement test-first;
6. run tests, integration verification, and adaptive review;
7. open linked PRs for human merge.

Default `/feature` has three human gates; `--autonomous` has one consolidated seam-cited plan gate; `--auto` has none. Human gate collapse applies only to interactive approvals inside delegated skills. The deterministic seam-confidence check, evaluator adherence review, code-reviewer design-adherence lens, `/auto` ratchet, and `/gate` are never collapsed.

### Brownfield design and wiki lifecycle

A first run builds and commits `specs/brownfield/wiki/` and `code-graph.json`; later work checks freshness and incrementally patches touched files. Stop/subagent hooks self-heal the graph and re-render navigation during implementation, and the final regenerated wiki ships in the same PR. The pre-change wiki grounds the plan; the post-change wiki records the result.

Existing design is amended with `/design --delta` for design-touching work. The route explicitly avoids regenerating the whole design from an epic alone, because that would discard prior system decisions.

## Reuse-or-justify intake

The current committed focus is an intake control for brownfield growth. When a `/change`, `/feature`, or `/sprint` request adds or materially extends behavior, it runs:

```bash
node .claude/scripts/reuse-scout.js --graph specs/brownfield/code-graph.json --goal "<goal>"
```

For an epic/sprint, it can also pass a batch of stories to detect same-release clusters. If the scout’s `fire` result is false, the route records a net-new assumption and proceeds. If it is true, the `reuse-or-justify` skill asks only the decision questions raised by evidence: whether to extend an existing seam or justify new structure, whether a constitution invariant is affected, whether batch work should consolidate, and which performance budget applies.

The deterministic recorder writes an append-only decision before test/implementation intake. The decision is then reflected in design trace/component metadata, while later duplication and seam-oriented controls verify the outcome. This feature was introduced by the recent committed sequence culminating in `20a6b50`; it is a constraint on the brownfield routes, not a generic mandatory dialogue for every request.

## Human ownership and autonomy

The harness separates three concerns:

- **Human gates** approve requirements, decomposition, and design intent when the selected lane requires them.
- **Machine gates** independently validate code, artifacts, contracts, and regressions regardless of approval mode.
- **Merge** remains human-owned. `/pr-respond` may perform a bounded CI/review response pass, but it never enables auto-merge.

This boundary is why `settings.auto.json` needs an isolated runner even though quality gates stay on: it removes tool permission prompts, not host-level secret exposure or network risk.

## Change guidance

- Edit the route conductor only when changing orchestration. Change the delegated skill when changing a stage’s intrinsic behavior.
- Keep large skills as short entry documents with procedures in `references/`; the corpus tests inspect both.
- Route changes need wiring/contract tests in addition to implementation tests, because many guarantees live in skill text and command composition.
- For brownfield changes, run context retrieval before broad source reads and preserve the decision/trace artifacts that later quality controls consume. See [navigation and continuation](navigation-and-continuation.md) and [quality verification](../quality/verification.md).
