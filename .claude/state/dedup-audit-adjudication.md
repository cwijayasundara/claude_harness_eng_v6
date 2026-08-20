# Dedup audit adjudication — 2026-08-20

Pre-pass: `node tools/overlap-candidates.js` → 170 controls, 51 pairs, 109 residual.
Stale: first full audit (no prior marker).

**Merges this pass: 0.** Control budget stays 170.

A pair is a merge only when two controls of the **same type** (guide+guide or sensor+sensor) guard the **same invariant**. Guide+sensor of one invariant is the harness model, not overlap. A shared `wired_at` file is often a hub.

## Ranked pairs — keep (grouped)

### Shared engine (hub, not duplicate)

| Pair | Why keep |
|---|---|
| All `drift-*` × each other + `modularity-review-staleness` | One `drift-report.js`; different signals (cycles, dead-code, CVEs, canvas, hub staleness). |
| `coverage-ratchet` × `secret-scan` × `unit-tests` | Dispatcher `pre-commit`, not one invariant. |
| `eslint-ruff` × `type-check` | `verify-on-save.js` hub (lint vs types). |
| `eval-api` × `eval-playwright` | Two evaluator layers. |
| `generation-contract` × `story-bundle-check` | Same `gates-ssdd.js`; presence of a story section vs join of story+design+BRD. |
| `protected-env-file` / `security-patterns` / `test-write-lock` / `write-scope` | `pre-write-gate.js` hub; env file, secret patterns, red-test lock, write-scope. |
| `refactor-purity` × `sprint-contract` | `gate-registry.js` catalog membership, not one invariant. |
| `dep-audit` × `sast` | Same `security-scan.js`; npm/pip vs semgrep. |
| `secure-baseline-wiring` × `security-baseline` | Wiring present vs findings ratchet. |

### Gap-number bundles (one increment, many invariants)

| Pair | Why keep |
|---|---|
| `accessibility` × `api-contract-drift` × `approved-fixtures-gate` × `flake-detection` | Shared `gap_ref=G12` (hardening program), four different oracles. |
| `observability-conventions` × `runtime-slo` | G9: feedforward conventions vs scraped SLO. |

### Guide vs sensor of the same family

| Pair | Why keep |
|---|---|
| `git-safety-parallel` × `git-safety-session` | Guide (deny list) + session sensor (pre-bash). One invariant, two types. |
| `layer-config` × `layer-imports` | Defaults vs enforcement. |
| `story-bundle` × `story-bundle-check` | Artifact vs join gate. |
| `mechanical-migrate` × `canary-before-fanout` | Migrate feature vs G32 canary discipline; canary's `net_add` already names the distinction. |
| `fix-from-diagnostics` × `cyclic-dependency-prepass` | Work-queue skill vs G33 cycle-break-before-shard step. |

### Two lenses / two cadences

| Pair | Why keep |
|---|---|
| `clean-code-review` × `diff-review` | One `code-reviewer` agent; maintainability vs behaviour axis. |
| `impact-scoped-regression` × `regression-suite-full` | G16 every local iteration vs G15 unabridged merge sweep. |
| `coverage-diff` × `coverage-ratchet` | Per-diff vs stock ratchet. |
| `first-window-init` × `resume-smoke` | G13 first-window artifacts vs G14 boot-on-resume. |
| `spec-decisions-gate` × `design-decisions-gate` | Same `decision-record` spine; spec scope vs design "rules out". |
| `branch-protection-verify` × `deploy-gate-verify` | Merge ruleset vs deploy Environment. |
| `deploy-gate-verify` × `fleet-gate-retrofit` | One-gate verify vs fleet aggregate/apply. |
| `at-first-proof` × `legacy-discipline-proof` × `sprout-diff-one-symbol` | Three receipts (AT-first, coverage/pin/sprout, one-symbol sprout). |
| `biting-meta` × `sensor-value-meter` | Never-fired gates vs ranked cut list; both report-only, different inputs. |
| `bounded-context-rules` × `layer-imports` | Vertical contexts vs horizontal layers. |
| `git-safety-parallel` already covered | — |
| `nav-index-semantic` × `human-codebase` | TF-IDF index vs human homepage render. |
| `observability-static` × `perf-smell-static` | G9 static conventions vs perf-smell gate. |

## Residual (no pre-pass signal) — sampled, not overlap-free

P3 named families, read in source:

- **Planning join:** `trace-check`, `generation-contract`, `story-bundle-check`, `plan-approval`, `spec-decisions-gate`, `prd-shape-gate` — ID linkage, story section, join artifact, human sign-off, who-decided, observable postcondition. Keep all.
- **Test order:** `red-phase-record` (G41 evidence), `test-write-lock` (G42 session), `test-integrity` (G43 commit). Keep all.
- **CLI vs `hooks/lib` twins:** not duplicate controls; CLI wraps lib.
- **`story-generation-contract` vs `generation-contract`:** guide vs mechanical presence check (`net_add` on the sensor). Keep.

No residual pair met the same-type + same-invariant bar.

## Follow-up (not this pass)

If a later audit wants a smaller *count*, the only honest cuts are retiring a whole pack from the default install (P4), not collapsing guide+sensor or G15/G16.
