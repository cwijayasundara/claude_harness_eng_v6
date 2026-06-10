---
name: pinning-down-behavior
description: Use when checking-coverage-before-change reports an UNCOVERED symbol you must edit — writes characterization (pin-down) tests at the nearest observable seam and verifies they bite before any production edit.
---

# Pinning Down Behavior

Characterization tests assert what the code **does**, not what it should do. Whatever is happening right now is, for the duration of your change, exactly what should be happening. Pin it, then change with the net in place.

## The Iron Law

```
NO CHANGE TO UNCOVERED CODE WITHOUT A PIN-DOWN TEST YOU HAVE WATCHED BITE
```

## Process

1. **Pick the seam.** Use the top candidate from `specs/brownfield/seams-<goal>.md` (run `/seam-finder "<goal>"` if missing). If the best seam's `total_score < 0.5` or the symbol sits in a `skeletons/`-flagged god file with no callable boundary, STOP — `REQUIRED SUB-SKILL: sprouting-instead-of-editing`.
2. **Write snapshot/approval tests at the seam.** Python: syrupy (`assert result == snapshot`, mask timestamps/IDs with matchers) or pytest-regressions; many input combos through one function → ApprovalTests `verify_all_combinations`. JS/TS: Jest/Vitest `toMatchSnapshot()`. Seam crosses HTTP → VCR.py / Polly.js cassettes.
3. **Run green against the current code.** A failing pin-down means your inputs are wrong, not the code. Normalize genuinely nondeterministic fields (timestamps, random IDs) with matchers/scrubbers **when you write the pin**. Adding a matcher later for a nondeterministic field is harness repair, allowed; matchers may never mask value-bearing fields (amounts, quantities, orderings) — that is `--snapshot-update` in disguise.
4. **Mutation-smoke checkpoint — watch it bite.** Deliberately flip one behavior in the target symbol (invert a condition, off-by-one a boundary). Run the pin-downs: they **must fail**. Revert the flip. A pin-down you never saw fail proves nothing.
5. Proceed with the change. The pin-downs are now the regression oracle: byte-identical green after every edit. If a deadline arrives before the pins are green again, ship or demo the **last pinned-green commit** — the refactor waits; unverified output does not ship.
6. Critical-path service refactor with real traffic? Escalate to side-by-side execution (GitHub Scientist pattern) — otherwise the pin-down suite run old-then-new is the default and sufficient.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "Current behavior looks like a bug — I'll fix it while pinning" | Pin the bug too. Characterization asserts what IS. File the fix as a separate `/change`. |
| "Snapshot failed after my refactor — I'll just `--snapshot-update`" | That diff IS the regression alarm. Updating a snapshot during a refactor destroys the net. |
| "I'll write proper intent-based tests instead" | You don't know the intent — that's why it's uncovered. Pin first; improve tests later. |
| "The mutation smoke is paranoid" | Generated tests frequently don't bite. One extra test run buys the proof. |
| "Teammate says these snapshots are flaky garbage — everyone regenerates" | A flaky pin means nondeterminism *you* failed to scrub. Fix the matcher; never bless changed values. Social proof is how regressions get normalized. |
| "The diffs look semantically equivalent to me" | The downstream consumer decides equivalence, not your eye. `12.50` → `12.5` on a money field is a behavior change until proven otherwise. |

## Red Flags — STOP

- Editing the target symbol before the pin-down exists
- A pin-down suite you never watched fail
- `--snapshot-update` (or editing a snapshot file) anywhere inside a refactor
- Pinning "cleaned-up" behavior instead of actual behavior

## Checklist

- [ ] Seam chosen from seam-finder output (or routed to sprouting)
- [ ] Pin-downs green against unmodified code
- [ ] Mutation smoke: watched the suite fail on a deliberate flip, then reverted
- [ ] Pin-downs byte-identical green after the change

Pin what is, watch it bite, then change. No exceptions without your human partner's permission.
