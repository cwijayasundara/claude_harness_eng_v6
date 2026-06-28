# HARNESS.md — the control system, made legible

> **Agent = Model + Harness.** The model writes code; the *harness* is everything around it that makes the output trustworthy: **guides** that steer before it acts, **sensors** that detect after it acts, and a human **steering loop** that improves both over time.
>
> This file is the registry of that control system. Its machine-readable companion is [`harness-manifest.json`](harness-manifest.json) — the single source of truth for *what governs what* and *where the holes are*. The gap roadmap lives in [`docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`](docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md).
>
> Framing follows Thoughtworks/Fowler *Harness Engineering for Coding Agents* and *Maintainability Sensors for Coding Agents*.

## Why this exists

The harness already has most of the pieces a good control system needs — they were just scattered across hooks, skills, agents, and scripts, with no one place to answer *"what is my behaviour harness?"* or *"is anything ungoverned?"*. This registry is that place. Read it to:

- see every guide and sensor organised by what it governs and when it runs;
- spot coverage holes deliberately (gaps are listed, not hidden);
- know where to wire a new sensor so it joins the loop instead of becoming shelfware.

## The model

**Two control types.** A *guide* (feedforward) prevents or steers behaviour *before* the agent acts — a skill, a spec, a config, a convention. A *sensor* (feedback) observes *after* and feeds the result back for self-correction. You need both: feedback-only repeats mistakes; feedforward-only encodes untested rules.

**Sensor implementations** are **computational** (deterministic, fast, CPU — linters, type checkers, structural rules, tests), **inferential** (LLM semantic judgement — review agents), or **hybrid**.

**Four axes of quality** (the article's three, plus one we add):

| Axis | Governs |
|---|---|
| **Maintainability** | Internal quality — keep the code easy and low-risk to change. |
| **Architecture** | Structural fitness — layering, module boundaries, performance budgets. |
| **Behaviour** | Functional correctness, verified against a *running* system. |
| **Traceability** | *(harness extension)* Deterministic grounding of every artifact against its upstream. The articles' examples rely on human review here; we hard-block it. |

## Cadence — keep quality left

Sensors are spread across the lifecycle by cost and speed. Earlier is cheaper.

```
planning ──► session ──► commit ──► integration ──► drift
(grounding) (inner loop) (pre-commit  (running app:     (repeatedly,
            on every     / gate)      evaluator / CI)   outside the
            write)                                      change cycle)
```

- **planning** — grounding/trace gates before code exists.
- **session** — fast computational sensors on every write (`verify-on-save`, `pre-write-gate`); self-correction inside one agent loop.
- **commit** — `git pre-commit` + the on-demand `/gate`; the expensive inferential reviews run here, boundary-gated.
- **integration** — the GAN evaluator runs the app: API · Playwright · vision · security · perf.
- **drift** — recurring checks *outside* the change lifecycle that catch accumulated decay. The architecture / dead-code / dependency-CVE signals are live via `drift-report.js` (`npm run drift`; wire to `/schedule` or CI); two more (design-vs-code, runtime SLO) remain blocked on G4/G9.

## The matrix — guides × sensors, by axis

Status: ✅ active · 🟡 partial (limited/opt-in/report-only) · ⛔ planned (gap id).

### Maintainability

| | Guides (feedforward) | Sensors (feedback) |
|---|---|---|
| | `code-gen` skill (10 principles) · `clarify` | ✅ ruff/eslint (session+commit) · ✅ mypy/tsc · ✅ length caps (30-line fn / 300-line file) · ✅ coverage ratchet + per-diff coverage · ✅ `clean-code-reviewer` (inferential) · ✅ coupling/dead-code report *(report-only)* · ✅ **drift: dead-code accumulation** (`drift-report.js`) · 🟡 `mutation-smoke` **not a ratchet gate (G7)** · ⛔ inferential modularity review (G6) |

### Architecture

| | Guides | Sensors |
|---|---|---|
| | `architecture.md` · `project-manifest.json#architecture` (layer config) | ✅ layered-import check (every write) — *horizontal only* · ✅ API schema validation · ✅ perf ratchet (p95) · ✅ **drift: new cycles / unstable hubs** (`drift-report.js`) · 🟡 cycle detection *(reported at change-time, not enforced)* · ⛔ vertical bounded-context rules (G8) · ⛔ API contract-drift `oasdiff` gate (G12) · ⛔ observability conventions in generated app (G9) |

### Behaviour

| | Guides | Sensors |
|---|---|---|
| | BRD/spec/design + acceptance criteria + sprint contracts · legacy-preservation skills · ⛔ REASONS Canvas living artifact (G4) | ✅ unit tests · ✅ evaluator Layer 1 API · ✅ evaluator Layer 2 Playwright · ✅ evaluator Layer 3 vision · ✅ `diff-reviewer` (correctness) · ✅ `security-reviewer` (OWASP) · ✅ secret scan (baseline regex, pre-write + commit; gitleaks tier at /gate) · ✅ SAST (semgrep, /gate) · ✅ dep-audit (npm/pip, /gate) · ✅ **drift: new dependency CVEs** (`drift-report.js`) · 🟡 axe/WCAG *(opt-in only, G12)* |

### Traceability *(harness extension — a strength)*

| | Guides | Sensors |
|---|---|---|
| | FRD/PRD as immutable baseline | ✅ `grounding-check` (BRD vs FRD, hard block) · ✅ `trace-check` (spec vs BRD; test vs AC+obligation) · ✅ `constraints-extract` · ✅ `plan-confidence` · ✅ `seam-confidence` |

> This row is **ahead of the source material**: the deterministic FRD→BRD→spec→test grounding chain has no equivalent in the SPDD example, which leans on human review. Keep it; the SPDD idea to *add* is the living, code-synced design artifact (G4), not its traceability.

## Steering loop (the human layer)

The harness improves itself between runs: `.claude/program.md` (the steering input that biases `/auto`), `.claude/state/learned-rules.md` (failure-derived rules, injected into future prompts, never deleted), and `review-on-stop.js` (surfaces session learnings as suggested `CLAUDE.md` edits — applied *between* sessions, never mid-run, to preserve the prompt cache).

## The current holes (so they're not invisible)

The point of a registry is that gaps are explicit. Open items, by priority (full detail in the gap analysis):

- **G1** *(this file)* — make the harness legible. ✅ done by `HARNESS.md` + `harness-manifest.json`.
- ~~**G2 (P0)** — no continuous **drift** sensors.~~ ✅ **done** — `drift-report.js` diffs architecture (cycles/hubs), dead-code (orphans), and dependency CVEs against a committed snapshot, flagging only *new* regressions; exit 1 on drift for cron/CI/`/schedule`. (Design-vs-code and runtime-SLO drift remain blocked on G4/G9.)
- ~~**G3 (P0)** — no computational security sensors.~~ ✅ **done** — baseline secrets enforced at pre-write + commit; gitleaks/semgrep/npm+pip-audit wired into `/gate` via `security-scan.js`, degrading loudly when a tool is unprovisioned.
- **G4 (P1)** — no SPDD-style living, code-synced design artifact (REASONS Canvas + `sync`).
- **G5 (P1)** — sensor messages are generic, not per-rule LLM-optimised ("positive prompt injection").
- **G6 (P1)** — no inferential modularity review on top of the coupling report.
- **G7 (P1)** — `mutation-smoke` exists but isn't a `/auto` ratchet gate, so "tests pass" doesn't yet imply "tests bite."
- **G8–G12 (P2)** — vertical boundary rules, app observability, harness templates per topology, a harness-coverage metric, and behaviour extras (default a11y, contract-drift, flake detection).

## How to extend the harness

When you add a guide or sensor, register it here so it joins the loop instead of rotting:

1. **Build the control** — a hook check, a script, a skill, or a reviewer agent.
2. **Wire it to a cadence** — session (a `verify-on-save`/`pre-write-gate` check), commit (`git-hooks/pre-commit` or `/gate`), integration (the evaluator), or drift (a scheduled job).
3. **Register it** — add an entry to `harness-manifest.json` (`guides[]` or `sensors[]`) with a real `wired_at` path, its `axis`, `cadence`, `type`, and `status`. If it closes a gap, set the `gap_ref`.
4. **Make the signal LLM-legible** — emit a message that tells the agent how to self-correct, not just that it failed (the highest-leverage sensor technique; see G5).
5. **Update the matrix above** so the human view stays in sync with the manifest.

> Keep `harness-manifest.json` honest: every `active`/`partial` entry must point at a file that exists. A drift between this registry and reality is itself a harness failure.
