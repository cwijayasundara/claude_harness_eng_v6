# Model allocation & cost posture

How the harness assigns Claude models to roles, and how to dial the cost/quality trade-off per project. Pins are set by `execution.model_tier` in `project-manifest.json`, applied to each agent's `model:` frontmatter by `.claude/scripts/model-tier.js`. The prompt bodies are model-agnostic (see [prompting-standards.md](prompting-standards.md) → "Model-agnostic by construction") — the model is named only here.

## Pricing (per 1M tokens, in / out)

| Model | Input | Output | Relative to Opus 4.8 |
|---|---|---|---|
| Opus 4.8 | $5 | $25 | **1× (top-capability)** |
| Sonnet 5 | $3 ($2 intro through 2026-08-31) | $15 ($10 intro) | 0.6× |
| Haiku 4.5 | $1 | $5 | 0.2× |

## Why the roles get the models they do

The harness runs a **GAN**: the generator produces, the evaluator judges. Cost follows token *volume*, and volume is wildly uneven across roles:

- **Generation is the volume bucket** — code + tests across parallel teammates, the bulk of output tokens. This is the single largest cost lever, so it runs on **Sonnet 5**: the harness's detailed component-map + per-story contracts make it mechanical work Sonnet does well, and Sonnet 5 specifically now reaches near-Opus quality on coding and agentic work (see the model's migration notes) — a stronger first-shot than the Sonnet 4.6 generation used to give at the same price tier.
- **Evaluation is low-volume, judgment-heavy** — verdicts and structured failures, far fewer tokens than the code judged. **Opus 4.8** precision earns its rate on the gate; the deterministic grounding gates and the security-reviewer's adversarial pass backstop the rest.
- **Planning cascades** — a flawed BRD/spec/design propagates through the whole pipeline. It's low-volume, high-leverage reasoning, so it runs on the top-capability model (**Opus 4.8**).

## The cost lever: generation, not the top tier

Judgment roles (planner, evaluator, critics, security) are low-volume, so they stay on **Opus 4.8** regardless of tier. The knob that moves a build's bill is the **generator** — ~60% of output tokens.

> **Note (2026-07): the three-step ladder collapsed to two.** Earlier revisions of this harness stepped generation Sonnet 4.6 → Opus 4.7 → Opus 4.8 across the `cost` / `balanced` / `max-quality` presets. Both Opus 4.7 and Sonnet 4.6 are now retired in favor of Opus 4.8 and Sonnet 5 respectively, and Sonnet 5's coding/agentic quality now covers the ground Opus 4.7 used to (see `shared/model-migration.md` → Migrating to Claude Sonnet 5 in the `claude-api` skill). There is no longer a distinct middle tier: `cost` and `balanced` both pin the generator to Sonnet 5. `max-quality` still bumps generation to Opus 4.8 for the highest-stakes builds.

## The presets (`execution.model_tier`)

| Role | `cost` (A) | **`balanced` (B, default)** | `max-quality` |
|---|---|---|---|
| planner | Opus 4.8 | **Opus 4.8** | Opus 4.8 |
| generator | Sonnet 5 | **Sonnet 5** | Opus 4.8 |
| evaluator | Opus 4.8 | **Opus 4.8** | Opus 4.8 |
| design-critic | Opus 4.8 | **Opus 4.8** | Opus 4.8 |
| security-reviewer | Opus 4.8 | **Opus 4.8** | Opus 4.8 |
| codebase-explorer | Sonnet 5 | **Sonnet 5** | Sonnet 5 |
| *session / orchestrator* | Opus 4.8 | Opus 4.8 | Opus 4.8 |

Pins are written as **exact model IDs** in the agent frontmatter — `claude-opus-4-8`, `claude-sonnet-5` — not bare aliases, so they are version-pinned and unambiguous.

- **`cost` (Profile A):** Sonnet 5 generation, Opus 4.8 judgment. Lowest bill; identical generator pin to `balanced`.
- **`balanced` (Profile B, shipped default):** Sonnet 5 generation, Opus 4.8 judgment. The retired Opus 4.7 middle posture is gone — Sonnet 5 now delivers what it used to at Sonnet pricing.
- **`max-quality`:** generation bumped to Opus 4.8; codebase-explorer stays Sonnet 5. For the highest-stakes builds where first-shot code quality has the most downstream leverage.

Rough relative build cost (illustrative, generation ≈ 60% of output tokens): `cost` / `balanced` ≈ 1.0× (identical generator pin) · `max-quality` ≈ 1.6×.

> **Note (Fable 5 removed, 2026-06):** Earlier revisions of this harness reserved a premium **Fable 5** tier for the planner and the `max-quality` judgment roles. Anthropic has disabled Fable 5, so judgment runs on **Opus 4.8** in every tier; the generator is the only role that varies (Sonnet 5 → Opus 4.8).

## Operating it

- **Set the posture:** `execution.model_tier` in `project-manifest.json`, then `node .claude/scripts/model-tier.js <preset> --apply .claude/agents`. The scaffold does this on init (default `balanced`).
- **Session/orchestrator model** is not an agent pin — it's the operator's `/model`, `claude-opus-4-8` in every tier.
