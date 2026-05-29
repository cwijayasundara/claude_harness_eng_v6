---
name: lane-classify
description: Classify an incoming change request into the right harness lane (vibe / fix-issue / improve / refactor / lite / build), write the result to .claude/state/current-lane, and explain the decision. Use proactively before any non-trivial code change so the commit-trailer git hook can segment downstream metrics correctly.
argument-hint: "[change-description]"
context: same
---

# Lane Classifier

This skill exists for **measurement correctness**, not gatekeeping. Every commit produced by the harness should carry a `Harness-Lane:` trailer so downstream productivity dashboards (greenfield vs. brownfield vs. review-displaced) can segment work accurately. The classifier writes a single file: `.claude/state/current-lane`. The `prepare-commit-msg` git hook reads it.

If the lane is already correct in `.claude/state/current-lane`, this skill is a no-op.

---

## When to invoke

Run **before** the first edit on any new request, and **whenever the lane shifts mid-session** (e.g., a `/vibe` turned into a real refactor — re-classify and update the marker).

You do not need to invoke this for purely read-only investigation.

---

## Decision table

| Signal | Lane | Notes |
|---|---|---|
| 1–3 files, <150 changed LOC, no public API change, no auth/security | `vibe` | Typos, copy, null guards, docs, small bug/guard fixes (threshold matches the `vibe` skill) |
| GitHub issue reference, bug reproduction available | `fix-issue` | Standard issue workflow |
| New user-visible behavior, touches 1–3 modules, requires tests | `improve` | The default feature lane |
| Quality / structural change, no behavior change, may touch many files | `refactor` | Renames, layer reorgs, dead-code removal |
| Greenfield **new small** project (≤5 stories, single module), no existing code | `lite` | Compressed greenfield lane; skips full BRD/spec/design ceremony |
| Greenfield **large/substantial**, multi-story, needs full spec + design | `build` | Full SDLC pipeline |

Escalation rule (from CLAUDE.md): touches >3 source files OR new workflow OR public API change OR migration OR auth/security/privacy work OR ambiguous requirements → escalate to `improve` or `build`. Do **not** use `vibe` for these even if they "feel small."

---

## Procedure

1. Read the request and the brownfield risk map (`specs/brownfield/risk-map.md`) if present.
2. Pick a lane using the decision table. Resolve ambiguity by escalating, never by downgrading.
3. Write the lane name (lowercase, no newline noise) to `.claude/state/current-lane`. Create the directory if it does not exist.
4. Also write `.claude/state/current-mode` if a `/auto` mode is active (full / lean / solo / turbo).
5. Report a one-line decision: `lane=X · reason=Y · blast_radius_estimate=Z`.

That is the entire skill. Do not change code from inside this skill.

---

## Why this exists

Without a written lane marker, the commit-trailer hook cannot tag commits, and the productivity dashboard cannot tell `/vibe` work apart from `/refactor` work — making the brownfield yield numbers uninterpretable. One small file, written deliberately, unlocks every downstream segmentation chart.

The lane trailer feeds the harness telemetry/Grafana dashboards that segment lane correctness and commit-trailer coverage.
