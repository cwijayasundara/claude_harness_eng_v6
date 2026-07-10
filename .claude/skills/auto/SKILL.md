---
name: auto
description: Autonomous build loop with Karpathy ratcheting, GAN evaluator, and session chaining. Iterates story groups until all features pass or stopping criteria met.
argument-hint: "[--mode full|lean] [--group GROUP_ID]"
context: fork
---

# Auto Skill

Autonomous build loop implementing Karpathy's ratcheting pattern with GAN-style generator-evaluator separation, agent teams for parallel execution, sprint contracts for verifiable done-criteria, self-healing with failure-driven learning, and session chaining for multi-context-window builds.

> **Ultracode tip:** Leave ultracode **off** here (`/effort high` or lower). This loop already orchestrates its own agent teams and generator↔evaluator fan-out against sprint contracts; ultracode's auto-workflows would double-orchestrate, fight the contracts, and burn tokens. Do the divergent thinking earlier (`/brownfield`, `/design`, `/spec`) with ultracode on, then turn it off before running `/auto`.

---

## Progressive loading (Phase 4)

This skill is an **orchestrator index**. Load only the section file for the step you are executing — do not read every reference up front.

| When | Read |
|---|---|
| SECTION 1: Usage, Prerequisites, and Agent Delegation | `references/section-1-1-usage-prerequisites-and-agent-delegation.md` |
| SECTION 2: Context Recovery (Step 1 of Every Iteration) | `references/section-2-2-context-recovery-step-1-of-every-iteration.md` |
| SECTION 3: Sprint Contract Negotiation (Steps 2-3) | `references/section-3-3-sprint-contract-negotiation-steps-2-3.md` |
| SECTION 4: Agent Team Execution (Step 4) | `references/section-4-4-agent-team-execution-step-4.md` |
| SECTION 4B: Cross-Group Parallelism | `references/section-4B-4b-cross-group-parallelism.md` |
| SECTION 5: Ratchet Gate (Step 5) | `references/section-5-5-ratchet-gate-step-5.md` |
| SECTION 6: PASS/FAIL Handling (Steps 6-7) | `references/section-6-6-pass-fail-handling-steps-6-7.md` |
| SECTION 7: App Lifecycle Management | `references/section-7-7-app-lifecycle-management.md` |
| SECTION 8: Architecture Amendment Detection | `references/section-8-8-architecture-amendment-detection.md` |
| SECTION 9: GAN Design Loop (Frontend Groups Only, Full Mode) | `references/section-9-9-gan-design-loop-frontend-groups-only-full-mode.md` |
| SECTION 10: Session Chaining | `references/section-10-10-session-chaining.md` |
| SECTION 11: Stopping Criteria | `references/section-11-11-stopping-criteria.md` |
| SECTION 12: Failure-Driven Learning | `references/section-12-12-failure-driven-learning.md` |
| SECTION 13: Gotchas | `references/section-13-13-gotchas.md` |

### How to use

1. Parse flags and confirm prerequisites from **SECTION 1** (`references/section-1-1-usage-prerequisites-and-agent-delegation.md`).
2. Each iteration: SECTION 2 → 3 → 4/(4B) → 5 → 6 → … as needed.
3. On stop/budget/done: SECTION 10–12.
4. Wiring contract tests scan this file **and** `references/*.md` as one corpus.

### Load-bearing gate names (always visible here for harness integrity)

Gate 4 / pre-merge must continue to invoke: `cycle-gate.js`, `coupling-gate.js`, `mutation-gate.js` / mutation-smoke, `regression-gate.js`, `contract-accessibility-default.js` as specified in the section files. Full procedure lives in the references.

