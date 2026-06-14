# Native Claude Code Command Integration — Proposal

**Status:** Draft proposal (analysis artifact — not product code, no SDLC pipeline)
**Date:** 2026-06-14
**Question:** Where does the harness duplicate Claude Code's out-of-the-box commands, and how do we leverage native commands to make the harness a solid software engineer?

---

## 1. The core distinction

Three tiers of command surface exist in this environment:

1. **Native Claude Code built-ins** (no plugin prefix): `/loop`, `/schedule`, `/verify`, `/run`,
   `/code-review` (incl. `ultra` cloud, `--comment`, `--fix`), `/simplify`, `/security-review`,
   `/review` (PR), `/init`, `/fewer-permission-prompts`, `/update-config`, plus plan mode
   (`EnterPlanMode`/`ExitPlanMode`), `AskUserQuestion`, background tasks (`TaskCreate`),
   and git worktrees (`EnterWorktree`).
2. **Plugin skills** (prefixed): `superpowers:*`, `pr-review-toolkit:*`, `code-review:*`,
   `ralph-loop:*`, `frontend-design`, `sourcegraph`, etc.
3. **Harness skills** (this repo, no prefix, loaded via `--plugin-dir`): `/auto`, `/brd`, `/spec`,
   `/design`, `/build`, `/brownfield`, `/code-map`, `/seam-finder`, `/change`, `/refactor`,
   `/vibe`, `/evaluate`, `/review`, `/test`, `/deploy`, `/implement`, `/clarify`, …

The harness **reimplements several native capabilities internally** (review, security scan, app
launch, simplify) rather than calling them. That is the duplication to address.

---

## 2. Duplication map

| Native built-in | Harness equivalent | Verdict | Notes |
|---|---|---|---|
| `/code-review` | `diff-reviewer` (Gate 8) + `clean-code-reviewer` + `/review` | Heavy overlap | Native is single-shot/advisory; harness adds GAN separation + **blocking** `diff-review-verdict.json` + ratchet |
| `/security-review` | `security-reviewer` agent + `/review` | Heavy overlap | Harness adds blocking `security-verdict.json` |
| `/simplify` | `clean-code-reviewer` + `code-simplifier` | Overlap | Native does mechanical cleanups + `--fix`; harness reviewer judges structure (SOLID) |
| `/review` (PR) | `/review` (eval + security, local) | **Name collision** | Different scope, same name → user confusion |
| `/verify` | `/evaluate` Layer 2 (Playwright) | Overlap | Both run the app and observe behavior |
| `/run` | `/evaluate` app-launch logic | Overlap | Native launches/drives the app |
| `/loop` | `/auto` ratchet loop | Conceptual overlap | Different semantics — see §4 boundary |
| `/init` | `/scaffold` Step 5 (CLAUDE.md gen) | Partial overlap | Scaffold does far more; CLAUDE.md gen is the shared slice |
| plan mode + `AskUserQuestion` | `/clarify` + phase 1–3 human gates | Overlap | Native plan mode is the canonical approval gate |

**Key insight:** the harness's bespoke reviewers are *not* redundant. They add what native lacks —
GAN separation (the writer never grades its own work), **blocking** verdicts, and the **ratchet**
(gates only tighten). The fix is not "rip out and replace." It is: **stop hand-rolling the atomic
operations; delegate to native where equivalent; keep the GAN/ratchet discipline as the layer on top.**

---

## 3. Genuine gaps — native commands the harness should use and doesn't

| Native capability | Gap today | Opportunity |
|---|---|---|
| `/schedule` (cron routines) | Only GitHub Actions; nothing Claude-native recurring | Nightly ratchet re-run on `main`, scheduled `features.json` re-eval, upstream-watch as a routine |
| `/loop` (self-paced/interval) | `/auto` is one long session with bespoke session-chaining | Pace `/auto` group-by-group across context windows via `/loop` |
| `TaskCreate` background tasks | Long gates block the session | Run evaluator/security gates as background tasks; surface on completion |
| git worktrees (`EnterWorktree`) | Up to 5 parallel teammates share one tree → conflict risk | Isolate each parallel teammate in a worktree |
| plan mode (`ExitPlanMode`) | Phase 1–3 gates are prose "human gates" | Make `/spec` and `/design` approval a real plan-mode gate |
| `sourcegraph` plugin | `/code-map` is the only navigation primitive | Optional richer brownfield navigation |

---

## 4. Command-boundary clarifications (document these)

- **`/auto` vs `/loop`** — `/auto` is the *ratcheting build loop* (contracts, gates, self-heal).
  `/loop` is a *generic interval/self-paced runner*. Use `/loop` to **schedule** repeated `/auto`
  invocations across context windows; don't confuse it for the build loop itself.
- **`/scaffold` vs `/init`** — `/scaffold` bootstraps the entire harness (`.claude/`, manifest,
  agents, hooks). `/init` only authors CLAUDE.md. Scaffold may *call* `/init` for the CLAUDE.md slice.
- **harness `/review` vs native `/review`** — collision. Rename harness `/review` → `/gate`
  (or `/quality-gate`): it is the pre-merge evaluator+security gate, not a GitHub PR review.

---

## 5. Recommendation — phased

**Identity:** *The harness owns orchestration, ratcheting, and GAN separation. Native commands own
the atomic operations (review a diff, run the app, simplify, schedule).* Re-implementing atomic
operations is maintenance you don't need and drifts from upstream (you already run `upstream-watch`
because upstream moves).

### Phase 1 — Zero-behavior-change (do first)
1. **Rename harness `/review` → `/gate`** to kill the native collision. Update README + skill dir.
2. **Document boundaries** (§4) in README command reference.

### Phase 2 — Selective delegation (low risk) — **DONE 2026-06-14**
3. ~~`/evaluate` uses native `/run` + `/verify` as the app-launch/smoke layer.~~ **Rejected after
   investigation.** Two reasons: (a) the `evaluator` is a *forked subagent* with tools
   `Read/Write/Glob/Grep/Bash` + Playwright and **no Skill tool** — it cannot invoke `/run`/`/verify`;
   (b) the evaluator is already *more* rigorous than native `/verify` (stack-specific
   `verify-python.md`/`verify-react.md`, three-layer weighted scoring, latency-regression ratchet,
   axe-core a11y gate) — delegating would downgrade it. The correct relationship is documentation,
   already shipped in Phase 1: the README boundary table points users to `/run`/`/verify` as the
   lightweight human-driven *complement* to the rigorous `/evaluate`.
4. **Done.** `/refactor` Step 6 now invokes native **`/simplify`** as its mechanical-cleanup engine,
   fenced by the behavior-preservation gates (green precondition, diff-scoped, re-verify, pure-refactor
   commit). This is *additive* — `clean-code-reviewer` only reports; `/simplify` applies. The reviewer
   (now Step 7) is reserved for structural / SOLID judgment native `/simplify` does not do. Not wired
   into `/change` or `/implement`, whose diffs are behavioral (new code) and where a mechanical pass is
   riskier and less cleanly scoped — revisit only if a concrete need appears.

### Phase 3 — Wrap, don't replace (keep the guarantees)
5. `security-reviewer` runtime *calls* native **`/security-review`** as its scan engine, then applies
   the GAN wrapper (blocking `security-verdict.json` + ratchet). Same for `diff-reviewer` ↔
   `/code-review`. The blocking-verdict + ratchet behavior stays bespoke; the scanning is delegated.

### Phase 4 — Fill gaps — **REVISED after investigation 2026-06-14**

On inspection, two of the three proposed "gaps" turned out to be forced fits or duplicates of
deliberate existing mechanisms. Only one shipped, reframed.

6. **Shipped, reframed as a documented optional power-up (not wired in).** A Claude-native
   `/schedule` cron on the *harness repo* would only duplicate its GitHub Actions (CI on push/PR +
   weekly upstream-watch). The real gap is for **projects scaffolded with the harness**: post-merge
   drift on `main` (dependency rot, external-API shift, runtime flake) that merge-time CI can't see.
   README "Scheduled quality runs" documents a `/schedule` routine that re-runs `/gate` + `/evaluate`
   on `main` — composing commands the scaffold already provides, no new harness machinery.
7. ~~Plan mode (`ExitPlanMode`) as the phase 1–3 gates.~~ **Rejected.** Plan mode *blocks file
   writes*, but `/brd`, `/spec`, and `/design` all write artifacts — they cannot run inside it.
   `/build` already has working `[HUMAN APPROVAL]` gates. The only correct native primitive here is
   `AskUserQuestion` for a structured gate, a marginal UX upgrade not worth churning the central
   `/build` skill for. Left as a possible future polish.
8. ~~Worktree isolation for parallel `/auto` teammates.~~ **Rejected.** The harness already solves
   parallel-write safety deliberately: teammates spawn with disjoint **owned files** (logged to
   `iteration-log.md`), partitioned by a component-map micro-DAG, and Phase-1 teammates commit
   **shared typed interface contracts** that Phase-2 teammates depend on. Separate worktrees would
   hide those committed contracts from sibling teammates — breaking the mechanism that makes the
   teams work. Worktrees fight this design rather than helping it.

**Net outcome of the whole effort:** the genuine duplication (the `/review` name) and the genuine
leverage opportunity (`/simplify` in `/refactor`) are resolved. The remaining "gaps" were already
covered by deliberate harness mechanisms. The harness's identity holds: **it owns orchestration,
ratcheting, and the GAN writer/grader separation; native commands own the atomic operations.**

---

## 6. What NOT to change

- Keep blocking verdicts and the ratchet bespoke — native commands are advisory and single-shot.
- Keep the GAN separation (evaluator never grades its own work) — native `/code-review` has no
  writer/grader split.
- Keep `/brd → /spec → /design → /auto` and the brownfield lanes — these are orchestration the
  native surface has no equivalent for. (Native `feature-dev` plugin is a thin alternative, not a
  replacement for the ratcheted pipeline.)
