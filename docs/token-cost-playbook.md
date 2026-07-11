# Enterprise token cost playbook

How to run the Claude Harness Engine so enterprise teams spend less **without** weakening evaluator, security, or pre-commit gates.

Principles (Lance Martin / Anthropic / Coinbase):

1. **Defaults over hard caps** — cheaper day-one posture; caps are a backstop.
2. **Structural escalation** — frontier at plan, mid-run advisor checkpoints, verify — not "call Opus when confused."
3. **Visibility** — show $ and model mix; do not hide usage.
4. **Boundary tax** — multi-agent only when ownership/volume pays for it.
5. **Cache hygiene** — stable `CLAUDE.md`, tools, and session model.

## Token Saver posture (recommended product install)

| Knob | Value | Where |
|------|--------|--------|
| `execution.model_tier` | `cost` (alias `enterprise`) | `project-manifest.json` |
| Agent pins | Sonnet gen, Haiku explorer, Opus judgment | `node .claude/scripts/model-tier.js cost --apply .claude/agents` |
| `token_governor.mode` | `advisory` default; `enforced` for org policy | `project-manifest.json#token_governor` |
| Budgets | Tier defaults (cost: 30m / 80 agents / ~$8) | `execution.budget` or `/build --budget` |
| Advisor cap | `execution.advisor_max_per_run: 3` | optional manifest field |

## Measure first

```bash
# During / after a metered run (budget-start present):
node .claude/scripts/pipeline-status.js
node .claude/scripts/cost-report.js            # human table
node .claude/scripts/cost-report.js --json     # machine
# Artifact: .claude/state/cost-report.json
```

`/status` lines:

- **Budget:** wall-clock / agents / est $ caps
- **Cost:** ~$ · source=estimate|receipts|mixed · worker% · model mix
- **Navigation / token-advisor:** context savings (not API $)

Enable Claude Code OTEL for authoritative cache hit rate (see `telemetry/CACHE_MONITORING.md`).

## Structural routing

| Lane | Posture |
|------|---------|
| Disposable mockups / research | Outside GAN (frontend-design / deep-research) |
| `/vibe` | Solo session |
| `/change` single story | Solo generator + end reviewers |
| Multi-story tiny ownership | `solo_sequential` via `team-policy.js` |
| Multi-story real fan-out | Team (Rule 2) |
| Mid-run stuck (2× FAIL) | `/advise` or Task `advisor` (capped) |

```bash
# Policy is pure JS — unit-tested heuristic
node -e "console.log(require('./.claude/scripts/team-policy').decideTeamMode({stories:[...]}))"
```

## Enforce lean context (optional)

```json
"token_governor": {
  "enabled": true,
  "mode": "enforced",
  "max_source_read_lines": 300,
  "compress_tool_output": true
}
```

Fail-open without symbol ranges. Escape: `HARNESS_TOKEN_GOVERNOR=off` or `mode: off`.

Prefer:

```bash
node .claude/scripts/run-compact.js --kind test -- npm test
```

## Cache / session hygiene (operator checklist)

- [ ] Do not edit `CLAUDE.md` mid `/auto` session
- [ ] Settle plugins / MCP before long runs
- [ ] Do not `/model`-switch the orchestrator mid-run
- [ ] Prefer wave continuity (`build-chain`) over cold restarts
- [ ] Apply model-tier stamp between sessions, not mid-wave

## Baseline protocol (claims)

1. Capture cost-report + `/status` on three routes × 3 runs: tiny `/vibe`, single `/change`, small `/auto` or lite build.
2. Change one lever (tier, team-policy, enforced governor).
3. Re-run the same suite; compare medians.

Directional targets (not CI gates): −15–25% from defaults alone; more on brownfield/long `/auto` with advisor + enforce.

## Related

- [model-allocation.md](model-allocation.md)
- [token-governor.md](token-governor.md)
- [product-skus-and-tiers.md](product-skus-and-tiers.md)
- `docs/proposals/s4-budget-caps.md`
