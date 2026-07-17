# Harness Simplification — 2026-07-17

**Supersedes** `SIMPLIFICATION_PROPOSAL.md` (2026-06-10). Read that one for the detailed
per-skill/per-hook cut list; it is still broadly correct. This document exists because
that proposal **partially executed and then failed**, and the reason it failed is the
only thing worth acting on now.

---

## 1. The finding that reframes everything

The 2026-06-10 proposal audited the harness and recommended cutting the surface roughly
in half — 27→15 skills, 9→5 agents, 22→6 hooks. Some of it landed: `evaluation/`,
`lane-classify/`, `testing/`, `improve/`, `fix-issue/` were deleted; the missing
`code-reviewer` agent was created; many pipeline steps were demoted to `[Internal
pipeline stage]`.

Five weeks later the harness is not smaller. It is **nearly double**:

| Surface | 2026-06-10 | 2026-07-17 | Δ |
|---|---|---|---|
| Skills | 27 | **45** | +67% |
| Agents | 9 | **10** | +1 (4 added, 3 merged away) |
| Hook files | 22 | **69** | +214% |
| Scripts (`.claude/scripts`) | — | **122** (~17.5k LOC) | — |
| Numbered gaps in HARNESS.md | ~14 | **G1–G36** | +22 |
| Root docs | ~1,100 lines | **~1,500 lines** | — |

**A deliberate, detailed cleanup was applied, and the codebase grew through it.** That is
not a cleanup problem. It is a *rate* problem: things are added faster than they are
removed, and nothing in the system ever argues for removal.

## 2. Root cause: the harness has no ratchet on itself

The harness is built entirely around ratchets — coverage, coupling, cycles, length,
perf — that let product-code quality only move one way (better). It has **no equivalent
ratchet on its own size or control count.** The governing doctrine in `HARNESS.md` is
*"gaps are explicit; every gap gets a control"* — a purely additive rule. Every gap
analysis you ran (Fowler/SPDD, Devin-parity, Bun-parity, Cognition, Anthropic
long-running-agents) was a well-reasoned case for *adding*, each one shipped and merged,
and **not one closed gap ever retired a control.** The memory index is a graveyard of
"SHIPPED + MERGED" roadmaps.

Cleanup is a one-time subtraction against a continuous addition. It cannot win. The
2026-06-10 proposal treated complexity as a mess to tidy; it is actually a *flow* to
regulate.

## 3. Three symptoms that prove the controls aren't paying rent

These aren't opinions — they surfaced while merely *inspecting* the repo for this doc:

1. **Operator-hostile gates with negative net value.** The `token-governor` blocked
   `test -d`, `du`, and a `for` loop — read-only inspection commands — as "likely
   verbose," repeatedly. Memory already records the length gate blocking the harness's
   *own* files 3× and secret-scan flagging test URLs. A gate that fights the operator
   more often than it catches a real defect is worse than no gate.

2. **The empirical firing ledger is empty.** `biting-meta` exists to flag sensors that
   never fire — but `.claude/state/sensor-outcomes.jsonl` **does not exist**. The
   mechanism that would tell you which of your 19 catalogued gates are shelfware has
   never accumulated a single record. The capability to measure control value was built
   and then never turned on.

3. **Documented paths that point at nothing.** `harness-lite/` is a lone `README.md`
   instructing users to `--plugin-dir harness-lite/.claude` — a directory that **does not
   exist**. The advertised "lite loadout" is already broken.

Together: controls are added, then neither measured nor pruned, and some actively harm.

## 4. What to actually do — regulate the flow, then cut once

Ordered by leverage. #1 is the only durable fix; the rest are the one-time cut the
2026-06-10 proposal already scoped, plus removing negative-value items.

### P0 — Install the subtractive ratchet (the missing counter-force)

Without this, everything below grows back in a month, exactly as it just did.

- **A control budget, enforced.** Add to `HARNESS.md`'s doctrine: *a new gate/sensor/skill
  must either replace an existing one or carry a written net-add justification recorded in
  the manifest.* Make `validate-harness-manifest.js` count controls and fail if the total
  rises without a corresponding `net_add_justification` entry. This is a ratchet on the
  harness itself — the one kind it doesn't have.
- **Turn on the value meter.** Wire `recordOutcome` so `sensor-outcomes.jsonl` actually
  fills, and promote `biting-meta` from report-only to a **quarterly cut list**: any gate
  with zero fires or a false-positive-only record across N runs is proposed for deletion in
  `/retro`. Let the harness nominate its own shelfware.

### P1 — Remove negative-value and dead weight (pure upside, low risk)

- **Fix or scope-off operator-hostile gates.** Exempt the harness's own repo from
  `token-governor`, tune the length gate to ignore its own files, stop secret-scan
  matching test/fixture URLs. These have *negative* value here; removing the friction is
  all upside.
- **Delete dead top-level dirs:** `harness-lite/` (broken stub), `symphony_clone/`
  (vendored clone, unreferenced by `.claude`), `dist/`, and `telemetry/` (opt-in, off by
  default — its files are *already staged for deletion* in git status). None is
  load-bearing for the core loop.

### P2 — Execute the 2026-06-10 cut, updated for today's tree

The prior proposal's targets still hold and now have more to remove:

- **Collapse the discipline sub-tower.** 7 legacy-change micro-skills
  (`checking-coverage-before-change`, `pinning-down-behavior`, `sprouting-instead-of-editing`,
  `keeping-refactors-pure`, `writing-acceptance-tests-first`, `checking-migration-safety`,
  `upgrading-dependencies`) each with its *own* proof-gate (`legacy-discipline-proof`,
  `at-first-gate`, `coverage-preflight`, `sprout-diff`…) → one "legacy-change discipline"
  applied by the change lanes, one proof-gate. This whole tower postdates 2026-06-10.
- **Collapse gaps into capabilities.** HARNESS.md tracks G1–G36 as 36 individually-named
  controls; most users need the 4 axes, not 36 gap-ids. Keep the manifest machine-readable;
  stop growing the human-facing gap ledger — describe axes, not gap numbers.
- Finish the agent/command consolidation the prior doc scoped (§3.1–3.2 there).

### P3 — One canonical map

`design.md` (721) + `HARNESS.md` (200) + `README` (382) + committed DeepWiki +
`CODEBASE_MAP.md` overlap and must be hand-synced — and `harness-lite` already drifted.
Keep `HARNESS.md` as the registry; generate or delete the rest.

## 5. The honest trap

Every control here was added deliberately, for a real, well-argued reason. That is
*precisely* why the harness doubled: on any single addition the case to add is strong and
the case to subtract is absent. The only escape is to make subtraction a standing,
measured force rather than an occasional heroic cleanup — because the last heroic cleanup
was thorough, correct, and lost anyway.

**If only one thing is done from this document, do P0.** A third simplification proposal in
six months would itself be evidence that cutting-without-a-ratchet doesn't work.
