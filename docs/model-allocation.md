# Model allocation & cost posture

How the harness assigns Claude models to roles, and how to dial the cost/quality trade-off per project. Pins are set by `execution.model_tier` in `project-manifest.json`, applied to each agent's `model:` frontmatter by `.claude/scripts/model-tier.js`. The prompt bodies are model-agnostic (see [prompting-standards.md](prompting-standards.md) → "Model-agnostic by construction") — the model is named only here.

## Pricing (per 1M tokens, in / out)

| Model | Input | Output | Relative to Opus 4.8 |
|---|---|---|---|
| Opus 4.8 | $5 | $25 | **1× (top-capability)** |
| Sonnet 4.6 | $3 | $15 | 0.6× |
| Haiku 4.5 | $1 | $5 | 0.2× |

## Why the roles get the models they do

The harness runs a **GAN**: the generator produces, the evaluator judges. Cost follows token *volume*, and volume is wildly uneven across roles:

- **Generation is the volume bucket** — code + tests across parallel teammates, the bulk of output tokens. This is the single largest cost lever, so by default it goes on the cheapest *capable* tier (**Sonnet 4.6**, $15/M-out). The harness's detailed component-map + per-story contracts make it mechanical work Sonnet does well.
- **Evaluation is low-volume, judgment-heavy** — verdicts and structured failures, far fewer tokens than the code judged. **Opus 4.8** precision earns its rate on the gate; the deterministic grounding gates and the security-reviewer's adversarial pass backstop the rest.
- **Planning cascades** — a flawed BRD/spec/design propagates through the whole pipeline. It's low-volume, high-leverage reasoning, so it runs on the top-capability model (**Opus 4.8**).

## The cost lever: generation, not the top tier

Judgment roles (planner, evaluator, critics, security) are low-volume, so they stay on **Opus 4.8** regardless of tier. The knob that moves a build's bill is the **generator** — ~60% of output tokens — which steps **Sonnet 4.6 → Opus 4.7 → Opus 4.8** across the three tiers. The shipped default (`balanced`) runs generation on **Opus 4.7**: stronger first-shot code than Sonnet, a step below the top tier on cost.

> Drop generation to Sonnet (`cost`) when the detailed contracts + ratchet gates make first-shot quality cheap to recover; bump it to Opus 4.8 (`max-quality`) only when first-shot quality has enough downstream leverage to justify the top rate on the largest bucket.

## The presets (`execution.model_tier`)

| Role | `cost` (A) | **`balanced` (B, default)** | `max-quality` |
|---|---|---|---|
| planner | Opus 4.8 | **Opus 4.8** | Opus 4.8 |
| generator | Sonnet 4.6 | **Opus 4.7** | Opus 4.8 |
| evaluator | Opus 4.8 | **Opus 4.8** | Opus 4.8 |
| design-critic | Opus 4.8 | **Opus 4.8** | Opus 4.8 |
| security-reviewer | Opus 4.8 | **Opus 4.8** | Opus 4.8 |
| codebase-explorer | Sonnet 4.6 | **Sonnet 4.6** | Sonnet 4.6 |
| *session / orchestrator* | Opus 4.8 | Opus 4.8 | Opus 4.8 |

Pins are written as **exact model IDs** in the agent frontmatter — `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-4-6` — not bare aliases, so they are version-pinned and unambiguous.

- **`cost` (Profile A):** Sonnet 4.6 generation, Opus 4.8 judgment. Lowest bill.
- **`balanced` (Profile B, shipped default):** Opus 4.7 generation, Opus 4.8 judgment. Stronger first-shot code than Sonnet at a step below the top-tier rate — the middle posture.
- **`max-quality`:** generation bumped to Opus 4.8; codebase-explorer stays Sonnet. For the highest-stakes builds where first-shot code quality has the most downstream leverage.

Rough relative build cost (illustrative, generation ≈ 60% of output tokens): `cost` ≈ 1.0× · `balanced` ≈ 1.4× · `max-quality` ≈ 1.6×. The generator choice dominates the bill.

> **Note (Fable 5 removed, 2026-06):** Earlier revisions of this harness reserved a premium **Fable 5** tier for the planner and the `max-quality` judgment roles. Anthropic has disabled Fable 5, so judgment runs on **Opus 4.8** in every tier; the generator is the only role that varies (Sonnet 4.6 → Opus 4.7 → Opus 4.8).

## Operating it

- **Set the posture:** `execution.model_tier` in `project-manifest.json`, then `node .claude/scripts/model-tier.js <preset> --apply .claude/agents`. The scaffold does this on init (default `balanced`).
- **Session/orchestrator model** is not an agent pin — it's the operator's `/model`, `claude-opus-4-8` in every tier.
