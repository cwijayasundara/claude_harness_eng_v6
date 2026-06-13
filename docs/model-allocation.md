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

With **Opus 4.8** as the single top-capability model, the only knob that moves a build's bill materially is **whether generation runs on Sonnet 4.6 or Opus 4.8**. Generation is ~60% of output tokens, and Opus is ~1.7× Sonnet on output — so bumping the generator from Sonnet to Opus roughly doubles the dominant bucket. Judgment roles (planner, evaluator, critics, security) are low-volume, so keeping them on Opus 4.8 costs little regardless of tier.

> Bump generation to Opus only when first-shot code quality has high enough downstream leverage to justify ~2× on the largest bucket; otherwise the detailed contracts + the ratchet gates make Sonnet generation the right default.

## The presets (`execution.model_tier`)

| Role | `cost` (A) | **`balanced` (B, default)** | `max-quality` |
|---|---|---|---|
| planner | Opus 4.8 | **Opus 4.8** | Opus 4.8 |
| generator | Sonnet 4.6 | **Sonnet 4.6** | Opus 4.8 |
| evaluator | Opus 4.8 | **Opus 4.8** | Opus 4.8 |
| design-critic | Opus 4.8 | **Opus 4.8** | Opus 4.8 |
| security-reviewer | Opus 4.8 | **Opus 4.8** | Opus 4.8 |
| codebase-explorer | Sonnet 4.6 | **Sonnet 4.6** | Sonnet 4.6 |
| *session / orchestrator* | Opus 4.8 | Opus 4.8 | Opus 4.8 |

Pins are written as **exact model IDs** in the agent frontmatter — `claude-opus-4-8`, `claude-sonnet-4-6` — not bare aliases, so they are version-pinned and unambiguous.

- **`cost` (Profile A):** Sonnet generation, Opus judgment. Lowest bill.
- **`balanced` (Profile B, shipped default):** identical pins to `cost` today (top tier is a single model, so there is no middle posture to occupy). It is retained as a distinct posture name so a project can re-tune it independently of `cost` without a code change.
- **`max-quality`:** generation bumped to Opus 4.8 (the one expensive move); codebase-explorer stays Sonnet. For the highest-stakes builds where first-shot code quality is worth ~2× on the volume bucket.

Rough relative build cost (illustrative, generation ≈ 60% of output tokens): `cost` ≈ 1.0× · `balanced` ≈ 1.0× · `max-quality` ≈ 1.6×. The generator choice dominates the bill — keeping it on Sonnet is what keeps `cost`/`balanced` affordable.

> **Note (Fable 5 removed, 2026-06):** Earlier revisions of this harness reserved a premium **Fable 5** tier for the planner and the `max-quality` judgment roles. Anthropic has disabled Fable 5, so the top-capability tier is now solely **Opus 4.8**. The consequence is that `cost` and `balanced` resolve to identical pins; the three posture *names* are kept for forward compatibility and per-project re-tuning.

## Operating it

- **Set the posture:** `execution.model_tier` in `project-manifest.json`, then `node .claude/scripts/model-tier.js <preset> --apply .claude/agents`. The scaffold does this on init (default `balanced`).
- **Session/orchestrator model** is not an agent pin — it's the operator's `/model`, `claude-opus-4-8` in every tier.
