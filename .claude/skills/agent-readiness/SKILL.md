---
name: agent-readiness
description: Show how mature/safe this codebase is for heavy AI-agent use — a synthesis dashboard across 8 pillars, aggregating signals the harness already collects. Read-only report; aggregates state already on disk.
argument-hint: "[--root DIR]"
context: fork
---

# Agent readiness report

A read-only synthesis dashboard: how mature/safe is this codebase for heavy
AI-agent use? Loosely inspired by Factory.ai's "agent readiness" framing (8
pillars × maturity levels), adapted to what THIS harness actually tracks.
It aggregates signals the harness's own sensors and gates already produce —
it computes nothing new. Gap G21.

## Usage

```bash
# report against the current project
node .claude/scripts/agent-readiness.js

# report against a different root (e.g. a scaffolded target project)
node .claude/scripts/agent-readiness.js --root /path/to/project

# npm shortcut
npm run agent-readiness
```

Writes `specs/reviews/agent-readiness.md` (human-readable) and
`specs/reviews/agent-readiness.json` (machine-readable). Report-only —
exit 0 always, the same convention `harness-coverage.js` (gap G11) uses.
Run it on a cadence via `/schedule`, or on demand before onboarding an
agent to heavy autonomous work on a codebase.

## The 8 pillars

| Pillar | What it reads |
|---|---|
| Style & Validation | Lint/type config presence + whether the tool is actually provisioned (not just referenced) |
| Architecture Fitness | `.claude/state/cycle-baseline.txt` + `coupling-baseline.txt` (G8/G18 ratchets established?) |
| Testing | Coverage ratchet baseline, mutation-gate (G7), regression gates (G15/G16), acceptance-test artifacts (G20, informational) |
| Code Quality / Modularity Freshness | `.claude/state/modularity-review-marker.json` vs the live code-graph's unstable hubs (G19), reusing `drift.js`'s `withModularityStaleness` |
| Documentation / Navigation | Whether the living DeepWiki/code-graph is fresh (not STALE-stamped) |
| Observability | `project-manifest.json#observability.enabled` (G9) |
| Security & Governance | Whether `security-scan.js` (G3)'s enhanced tools (semgrep/gitleaks/npm+pip-audit) are actually provisioned |
| Dev Environment | `init.sh` existence and whether it matches `project-manifest.json#verification.mode` |

Each pillar reports one of `active` / `partial` / `planned` — the exact
vocabulary `harness-manifest.json#model.statuses` already defines — plus a
one-line, concrete remediation when it isn't `active`.

## Relationship to `/status`

`/status` and `/agent-readiness` both aggregate state the harness already
writes and answer different questions — they are not redundant:

- **`/status`** — *where is the current SDLC pipeline run right now?*
  Phase, group progress, health, next action. Time-scoped to an active
  `/auto`/`/build` run.
- **`/agent-readiness`** — *how mature is this codebase's control system,
  independent of any run?* A standing snapshot of which of the 8 pillars are
  wired and healthy, usable even when no pipeline is currently executing —
  including against a codebase this harness has never touched.

## When to use

- Before handing a codebase to an agent for heavy autonomous work, to see
  what's actually governed vs. still manual.
- Periodically (via `/schedule`) to watch pillar adoption drift over time,
  the same way `npm run drift` watches architecture/dependency drift.
- After `/scaffold` or `/brownfield`, to confirm the baseline controls
  (ratchets, navigation, observability) actually got established, not just
  configured.

This is a reporting surface only. It does not advance any pillar itself —
use `/code-map`, `/brownfield`, `/scaffold`, `/deploy`, `npm run cycles`,
`npm run coupling-gate`, etc. for that.
