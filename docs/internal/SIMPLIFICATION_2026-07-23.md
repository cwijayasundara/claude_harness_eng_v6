# Harness simplification — 2026-07-23

Successor to `SIMPLIFICATION_PROPOSAL.md` (2026-06-10) and `HARNESS_SIMPLIFICATION_2026-07-17.md`.
Grounded in a fresh read-only audit (hooks / scripts / skills+agents surveys) plus the now-live
evidence base: `check-partition.js`, the v6 partition (`.claude/config/packs.json`), and the bite
ledger (`.claude/state/sensor-outcomes.jsonl`, 843 outcomes / 33 sensors at time of writing).

## The reframe

The harness is not a monolith anymore — it is an **under-finished modular one**. The v6 partition
already defines a 48-unit **kernel** (5 skills: `change`, `code-gen`, `gate`, `refactor`, `vibe`;
3 agents: `code-reviewer`, `implementer`, `security-reviewer`; plus the commit gate). The other
~238 units live in 8 opt-in packs. Total surface is large (286 units); the *always-on* surface is
small.

So "simplify" is three problems, in priority order:

1. **The packs don't cleanly separate yet** — so no user can install the small version.
2. **There is genuine, safely-removable bulk** — smaller than it looks.
3. **Accretion has no automatic subtractive force that can _decide_** — why every past cleanup lost.

## Evidence highlights

- Kernel = 17% of units. Profiles: `kernel` ⊂ `core` ⊂ `brownfield` ⊂ `full`.
- `check-partition.js` still reports **15 profile-breaking edges**: a composed `core` install ships
  telemetry/verification units that hard-`require` brownfield-pack code at module top-level →
  observed crash `Cannot find module '../hooks/lib/drift'`.
- Bite ledger: only **5 controls have ever blocked** anything (`length-caps`,
  `legacy-discipline-proof`, `test-deletion-guard`, `secret-scan-write`, `tdd-test-first`). 26
  "never blocked" are mostly *preventive* gates — and the value meter admits it cannot tell a
  working deterrent from shelfware.
- Bulk: 147 scripts, 78 hook files (11 wired entry-points + 67 libs, 0 hard orphans), 402 test
  files, and a 3.4 MB `docs/` tree ~80% historical plans + a 1.2 MB pptx.
- Layers are individually tight: **0 true orphan scripts, 0 orphan hook libs.** The removable
  islands are the never-executed A/B experiment (`ab-run.js` + `ab-report.js`, ~600 lines) and
  `replay-telemetry.js`.

## The three priorities being worked (this increment)

### P1 — Close the 15 profile-breaking edges → ship kernel-only/core as real installs

This is *the* simplification: it makes the modularization already paid for deliver a smaller
bootable install. Established pattern (proven by commit `d76d8eb`): guard the top-level `require`
in a `try/catch`, null-check call sites to reach the module's existing pack-absent degradation, and
grow `CORE_MODULES_THAT_MUST_LOAD` in `tools/pack-install-smoke.test.js`. Prose-skill edges that are
conditional steps become `accepted_edges` (like `/refactor → code-map`), not code changes. Target:
edges → 0, then flip profile-closure to `--strict`.

Worklist by cluster:

- **drift cluster** (→ `lib:drift`, breaks core; guard): `lib:coupling-gate`,
  `script:record-modularity-review`, `script:drift-report`.
- **impact-scope cluster** (→ `lib`+`script:impact-scope`, breaks core, 6 edges; guard):
  `lib:legacy-discipline-relatedness`, `script:at-first-gate`, `script:local-regression-gate`.
- **modularity** (breaks core; `skill:design` is PROSE, conditional Step D3.5 → **accepted-edge**):
  `skill:design → agent:modularity-reviewer`, `skill:design → script:modularity-pack`.
- **scaffold** (breaks core+brownfield; `scaffold-apply` runs from the FULL SOURCE tree, not a
  composed install → judge accepted-edge vs guard): `script:scaffold-apply` →
  `lib:security-baseline`, `script:scaffold-security-baseline`, `script:navigation-refresh`.
- **dist** (breaks brownfield; `nav-bench` is a `nav-query` subcommand → guard):
  `script:nav-query → script:nav-bench`.

Each fix needs a caller-guards-first check to avoid vacuous-green (a lazy `require` inside a fn
fixes the crash but not the checker — must use `try/catch` or `packRun` so the edge drops).

### P2 — Tier-1 quick wins (no capability loss)

- **Unwire `graph-refresh.js` from `SubagentStop`** — the script already `return`s before any work
  on that event; the wiring just spawns a no-op Node process per teammate per turn.
  *(Note: this edits `.claude/settings.json`, which the prefix-cache gate blocks mid-session — an
  inter-session change requiring `HARNESS_PREFIX_EDIT=1`.)*
- **Delete/archive** the never-executed A/B island (`ab-run.js`, `ab-report.js`) and
  `replay-telemetry.js` (~800 lines incl. tests).
- **8 legacy-discipline `SKILL.md` → 1 routing skill** — they form one decision tree; each section
  still names its own backing gate script. **Gates untouched.** (51 → 44 skills.)
- **3 provisioning skills → 1 `provision` skill with modes** — `fleet-retrofit` already wraps
  `provision-protection` + `provision-environments`; scripts are pre-factored (`*-core.js`). Only
  the SKILL.md surface is triplicated. (44 → 42 skills.)
- (Lower priority, not this increment) single `gate.js <name>` dispatcher for the ~19 gate npm
  scripts; fold 4 `record-*` verdict writers → 1; merge `env-diff`/`ruleset-diff`; split
  `context-pack.js` (855 lines) and `scaffold-render.js`.

### P3 — Canary tests for preventive gates → make the value meter decisive

The `control-budget` ratchet stops *net* growth, but the removal half is blind: the meter cannot
distinguish a preventive gate that is a working deterrent (blocks 0 because nothing bad reached it)
from shelfware (blocks 0 because it is inert). Give each preventive gate a **synthetic canary** — a
known-bad input the gate must catch — so "never blocked in anger" splits into *proven-live* (canary
bites) vs *provably-dead* (canary passes through). Only then can a quarantine sweep cut with
evidence. This is the durable fix; without it the harness re-accretes regardless of this trim.

## Guardrails — do NOT "simplify" these

- The 5 reviewer agents (`code-reviewer`, `security-reviewer`, `modularity-reviewer`,
  `design-critic`, evaluator artifact mode) — fresh-context isolation is load-bearing (CLAUDE.md
  principle #5).
- The 7 legacy-change discipline *gates* — distinct proofs (only the *docs* merge in P2).
- The framework code cards (`fastapi-code`, `react-code`, …) — distinct frameworks, `domain` pack,
  not kernel tax.

## Historical bulk (deferred, needs owner sign-off)

`docs/superpowers/plans` (42) + `docs/superpowers/specs` (39) are historical implementation plans
(disposable artifacts); `docs/internal/*.pptx` is 1.2 MB of binary. Candidate for an archive branch
/ out-of-git. ~13 files reference `docs/superpowers` (the directory *convention*, not specific
plans) — verify before moving.
