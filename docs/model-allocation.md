# Model allocation & cost posture

How the harness assigns Claude models to roles, and how to dial the cost/quality trade-off per project. Pins are set by `execution.model_tier` in `project-manifest.json`, applied to each agent's `model:` frontmatter by `.claude/scripts/model-tier.js`. The prompt bodies are model-agnostic (see [prompting-standards.md](prompting-standards.md) → "Model-agnostic by construction") — the model is named only here.

## Pricing (per 1M tokens, in / out)

| Model | Input | Output | Relative to Opus 4.8 |
|---|---|---|---|
| Fable 5 | $10 | $50 | **2×** |
| Opus 4.8 | $5 | $25 | 1× |
| Sonnet 4.6 | $3 | $15 | 0.6× |
| Haiku 4.5 | $1 | $5 | 0.2× |

## Why the roles get the models they do

The harness runs a **GAN**: the generator produces, the evaluator judges. Cost follows token *volume*, and volume is wildly uneven across roles:

- **Generation is the volume bucket** — code + tests across parallel teammates, the bulk of output tokens. This goes on the cheapest *capable* tier (**Sonnet 4.6**, $15/M-out). It's the single largest cost lever; the harness's detailed component-map + per-story contracts make it mechanical work Sonnet does well.
- **Evaluation is low-volume, judgment-heavy** — verdicts and structured failures, far fewer tokens than the code judged. **Opus 4.8** precision earns its rate on the gate; the deterministic grounding gates and the security-reviewer's adversarial pass backstop the rest.
- **Planning cascades** — a flawed BRD/spec/design propagates through the whole pipeline. It's low-volume, high-leverage reasoning: the one place the Fable 5 premium reliably pays for itself.

## Where Fable 5 earns its 2× — and where it must not go

**Spend the premium** where first-shot quality has high downstream leverage *and* low token volume: the **planner** (BRD/spec/design), and — operator's call — the `/auto` **orchestrator** on long unattended runs, where Fable 5's long-horizon coherence reduces total iterations and thus *Sonnet generation* spend (the big bucket), often netting cheaper overall.

**Never spend it on:**
- **Generator** — the volume bucket; Fable is ~3.3× Sonnet on output. This alone ~doubles a build's bill.
- **Evaluator** (except `max-quality`) — Opus 4.8 + the deterministic gates already cover the critical paths; Fable's extra recall isn't worth 2× on the gate.
- **Security-reviewer — *hard rule, every tier*.** Fable 5 runs cyber safety classifiers that can **refuse offensive-security framing** (exploit/vuln reasoning) and fall back to Opus anyway — you'd pay Fable rates for a refusal + retry. `model-tier.js` enforces this: `security-reviewer` is never Fable.

## The decision rule

> Spend Fable 5's 2× premium on a phase only when **(downstream rework avoided) × P(Fable prevents it) > (2× premium on that phase's tokens)**.

True for low-volume, high-leverage reasoning (planning, long-horizon orchestration). False for high-volume execution (generation) and adequately-backstopped verification.

## The presets (`execution.model_tier`)

| Role | `cost` (A) | **`balanced` (B, default)** | `max-quality` |
|---|---|---|---|
| planner | Opus 4.8 | **Fable 5** | Fable 5 |
| generator | Sonnet 4.6 | **Sonnet 4.6** | Opus 4.8 |
| evaluator | Opus 4.8 | **Opus 4.8** | Fable 5 |
| design-critic | Opus 4.8 | **Opus 4.8** | Fable 5 |
| security-reviewer | Opus 4.8 | **Opus 4.8** | Opus 4.8 *(never Fable 5)* |
| codebase-explorer | Sonnet 4.6 | **Sonnet 4.6** | Sonnet 4.6 |
| *session / orchestrator* | Opus 4.8 | Opus 4.8 *(Fable 5 for long `/auto`)* | Fable 5 |

Pins are written as **exact model IDs** in the agent frontmatter — `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-4-6` — not bare aliases, so they are version-pinned and unambiguous.

- **`cost` (Profile A):** screws fully tightened — zero Fable. Lowest bill; relies on Opus 4.8 planning being good enough.
- **`balanced` (Profile B, shipped default):** Fable 5 only on the planner — the cascade-preventing, low-volume phase — and cost-conscious everywhere else. Buys first-shot planning quality cheaply without touching the volume bucket or the gate.
- **`max-quality`:** Fable on the judgment roles and a fresh-eyes evaluator; generator bumped one notch to Opus (not Fable — volume guard); security stays Opus. For the highest-stakes builds where rework is expensive.

Rough relative build cost (illustrative, generation ≈ 60% of output tokens): `cost` ≈ 1.0× · `balanced` ≈ 1.1× · `max-quality` ≈ 1.5×. The generator choice dominates the bill — keeping it off Fable is what keeps all three affordable.

## Operating it

- **Set the posture:** `execution.model_tier` in `project-manifest.json`, then `node .claude/scripts/model-tier.js <preset> --apply .claude/agents`. The scaffold does this on init (default `balanced`).
- **Session/orchestrator model** is not an agent pin — it's the operator's `/model` (`claude-opus-4-8` for cost; `claude-fable-5` for `/brd`·`/spec`·`/design` on genuinely hard briefs, then back to Opus 4.8 before execution, and optionally for long unattended `/auto` runs).
