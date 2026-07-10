## SECTION 9: GAN Design Loop (Frontend Groups Only, Full Mode)

Read `calibration-profile.json` for all scoring and iteration parameters. Fall back to defaults if file does not exist.

### Configuration

| Parameter | Source | Default |
|-----------|--------|---------|
| Scoring weights | `calibration-profile.json` → `scoring.weights` | DQ=1.5, O=1.5, C=0.75, F=0.75 |
| Pass threshold | `calibration-profile.json` → `scoring.threshold` | 7 |
| Per-criterion minimum | `calibration-profile.json` → `scoring.per_criterion_minimum` | 5 |
| Max iterations | `calibration-profile.json` → `iteration.max_iterations` | 10 |
| Plateau window | `calibration-profile.json` → `iteration.plateau_window` | 3 |
| Plateau delta | `calibration-profile.json` → `iteration.plateau_delta` | 0.3 |
| Pivot on plateau | `calibration-profile.json` → `iteration.pivot_after_plateau` | true |

### Loop

For each frontend page in the current group:

1. **Screenshot** — Take screenshots of the page at 1280px and 375px widths using Playwright
2. **Score** — Spawn design-critic agent with screenshots + calibration profile
3. **Check threshold** — weighted average >= threshold AND all criteria >= per_criterion_minimum
4. **If PASS** — Record score to `specs/reviews/eval-scores.json`, continue to next page
5. **If FAIL** — Send critique to generator, generator iterates on UI code

### Plateau Detection

After each iteration, check the last `plateau_window` weighted scores:
- If `max(recent) - min(recent) < plateau_delta`: scores have plateaued
- If `pivot_after_plateau` is true: instruct generator to make a fundamental change (different palette, layout, or typography) — not incremental tweaks
- If false: log warning, continue with incremental critique

### Termination

- Score meets threshold → PASS, move to next page
- `max_iterations` reached → log to `failures.md`, extract learned rule, escalate to user. Do NOT revert (ratchet gate already passed for functional checks).
- Lean mode: skips this section entirely (the design-critic does not run in Lean)

---
