# Model allocation & cost posture

How the harness assigns Claude models to roles, and how to dial the cost/quality trade-off per project. Pins are set by `execution.model_tier` in `project-manifest.json`, applied to each agent's `model:` frontmatter by `.claude/scripts/model-tier.js`. The prompt bodies are model-agnostic (see [prompting-standards.md](prompting-standards.md) → "Model-agnostic by construction") — the model is named only here.

Enterprise spend guidance: [token-cost-playbook.md](token-cost-playbook.md).

## Pricing (per 1M tokens, in / out)

| Model | Input | Output | Relative to Opus 4.8 |
|---|---|---|---|
| Opus 4.8 | $5 | $25 | **1× (top-capability)** |
| Sonnet 5 | $3 ($2 intro through 2026-08-31) | $15 ($10 intro) | 0.6× |
| Haiku 4.5 | $1 | $5 | 0.2× |

> Note: `budget-state.js` uses approximate per-token seeds for receipts; authoritative billing may differ. Prefer OTEL + cost-report for measured runs.

## Why the roles get the models they do

The harness runs a **GAN**: the generator produces, the evaluator judges. Cost follows token *volume*, and volume is uneven across roles:

- **Generation is the volume bucket** — code + tests. Runs on **Sonnet 5** unless `max-quality`.
- **Exploration is high-volume brownfield read** — on **`cost` / `enterprise`**, **Haiku 4.5**; on `balanced`+, Sonnet 5.
- **Judgment is low-volume** — planner, evaluator, reviewers, **advisor**: **Opus 4.8** on every tier.
- **Session / orchestrator** — recommend **Opus 4.8** even on cost (conductor reliability); not an agent pin (`/model`).

## The presets (`execution.model_tier`)

| Role | `cost` / `enterprise` | **`balanced` (monorepo dogfood)** | `max-quality` |
|---|---|---|---|
| planner | Opus 4.8 | Opus 4.8 | Opus 4.8 |
| generator | Sonnet 5 | Sonnet 5 | Opus 4.8 |
| evaluator | Opus 4.8 | Opus 4.8 | Opus 4.8 |
| design-critic | Opus 4.8 | Opus 4.8 | Opus 4.8 |
| security-reviewer | Opus 4.8 | Opus 4.8 | Opus 4.8 |
| code-reviewer | Opus 4.8 | Opus 4.8 | Opus 4.8 |
| modularity-reviewer | Opus 4.8 | Opus 4.8 | Opus 4.8 |
| advisor | Opus 4.8 | Opus 4.8 | Opus 4.8 |
| codebase-explorer | **Haiku 4.5** | Sonnet 5 | Sonnet 5 |
| *session / orchestrator* | Opus 4.8 | Opus 4.8 | Opus 4.8 |

- **`cost` / `enterprise`:** Product scaffold default (Token Saver). Sonnet generation, Haiku exploration, Opus judgment. `enterprise` is an alias of `cost`.
- **`balanced`:** This monorepo's dogfood default. Same generator as cost; Sonnet explorer.
- **`max-quality`:** Generator bumped to Opus 4.8.

Pins are exact model IDs: `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`.

> **Fable 5:** Removed as a live pin. `MODEL_PRICE` reserves `claude-fable-5` for a future advisor-only pin if product re-enables it — do not stamp agents with it today.

## Operating it

- **Set the posture:** `execution.model_tier` in `project-manifest.json`, then:
  ```bash
  node .claude/scripts/model-tier.js <cost|balanced|max-quality|enterprise> --apply .claude/agents
  ```
- Scaffold product apps (`web-app` / `api-service`) default to **`cost`**. Override via profile `modelTier` or the monorepo keep `balanced`.
- **Overrides are allowed** (defaults > denials). Log tier changes; do not swap the orchestrator model mid-session (cache rule).
