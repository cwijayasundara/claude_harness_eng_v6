# Prompting Standards — authoring agents & skills

How to write the harness's prompt surfaces (`.claude/agents/*.md`, `.claude/skills/*/SKILL.md`, `.claude/commands/*`) so they get the best out of the current Claude models. Distilled from Anthropic's [prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices), [Prompting Opus 4.8](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-4-8), and [Prompting Fable 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5).

## Which model runs where (tune the prompt to its reader)

| Surface | Model (tier) | Implication for the prompt |
|---|---|---|
| `/auto` orchestrator, direct chat | **Opus 4.8 *or* Fable 5** (session model) | Top-capability tier — either runs the same prompt. Long-horizon autonomy; needs grounded-progress + don't-stop-early + reversible-action guidance. Do **not** ask it to echo its reasoning as response text (see §7). |
| `planner`, `evaluator`, `design-critic`, `security-reviewer` | **Opus 4.8 *or* Fable 5** (top-capability) | Literal instruction follower; report-everything-then-filter for judging; effort matters. |
| `generator`, `codebase-explorer` | **Sonnet 4.6** (cost-efficient) | Set effort explicitly; precise, observable acceptance criteria. |

The top-capability roles are **interchangeable between Opus 4.8 and Fable 5** — the prompts are written to serve both (see "Model-agnostic by construction" below). The actual model is pinned in each agent's `model:` frontmatter (and the session model for the orchestrator); that frontmatter is the *only* place a model is named — never the prompt body.

## Model-agnostic by construction

The harness targets two top-capability models (Opus 4.8 and Fable 5) for the same roles. Their prompting guidance is ~85–90% identical; where they diverge, **Fable 5 needs the stricter version of a rule that is harmless on Opus 4.8.** Two principles keep one prompt serving both:

**Principle A — Write to the stricter union.** Where the two diverge, adopt the rule that is safe on both (always Fable 5's tighter one). It costs nothing on Opus 4.8 and prevents a Fable-5-only failure. Examples already applied: never echo reasoning as text (§7), ground every progress claim, lead-with-outcome brevity, never end a turn on a promise.

**Principle B — Criterion, not nudge.** Phrase every *steerable* behavior as a condition to evaluate, never a directional push. A nudge ("delegate more" / "spawn fewer subagents") assumes a specific innate default and inverts on the model with the opposite lean. A criterion ("delegate when fanning out across independent items; work directly for single-file/sequential work") is self-correcting — both models converge to the same behavior regardless of default. The harness's subagent structure is the worked example: the generator spawns *one teammate per story per phase* and `/auto` spawns *named agents for named roles*, so neither Opus 4.8's under-delegation nor Fable 5's over-delegation default matters.

### Divergence map — write the right-hand column

| Behavior | Opus 4.8 lean | Fable 5 lean | Model-agnostic instruction to write |
|---|---|---|---|
| Subagents | spawns fewer | spawns more | Criterion: "spawn when fanning out across independent items / isolated context; work directly for single-file, sequential, context-sharing work." |
| Reasoning visibility | fine to show | **refuses** if asked to echo | Never instruct echoing reasoning; read structured `thinking` blocks instead. |
| Verbosity | narrates more | over-elaborates more at high effort | "Lead with the outcome; be selective about what you include." |
| Early stopping | rare | rare + "promise without tool call" | "Don't end a turn on a promise — issue the tool call now." |
| Effort sweet spot | xhigh for coding | high default, xhigh for hardest | "`high` floor; `xhigh` for the hardest agentic/coding work." |
| Progress claims | grounded | can fabricate on long runs | "Audit each claim against a tool result before reporting." |
| Prescriptiveness | tolerates rigid steps | rigid steps can degrade output | Prescribe only where determinism is load-bearing (the gates); elsewhere give goal + boundaries. |

### Keep the divergence in one place

The *only* legitimate per-model knobs are **`model:` (frontmatter / session model)** and **effort** (the `/effort` convention + the per-skill "ultracode tip"). Never name a model or assume a model's default in prompt prose. Swapping a top-capability role between Opus 4.8 and Fable 5 must be a one-line frontmatter change. Do **not** template prompts per-model (`{{IF FABLE}}…`) — the divergences are too small to justify it, and Anthropic designed Fable 5 to run existing Opus 4.8 prompts.

## The standards

**1. Dial back aggressive over-prompting.** Current models follow the system prompt closely and *overtrigger* on anti-laziness language written for older models. Prefer `Use X when …` over `CRITICAL: YOU MUST use X`; delete `If in doubt, use X` and `Default to using X`. Reserve emphatic phrasing for genuine invariants (a hard gate, a safety rule) — not to coax tool use. (A `NEVER` that states an architectural invariant — "`/auto` never writes code directly" — is fine; a `NEVER` nagging the model to be thorough is not.)

**2. Say *when*, not just *what*, for every tool/capability.** Opus 4.8 and Fable 5 reach for search, subagents, memory, and custom tools *conservatively*. Put the trigger condition in the tool/skill description itself — "Use this when the diff touches auth or persistence," not just "reviews security." Prescriptive "call this when…" descriptions measurably raise the should-call rate.

**3. Code review / finding tasks: report everything, filter downstream.** "Only report high-severity" or "be conservative" makes 4.8/Fable 5 investigate fully and then *silently drop* low-severity findings — recall falls. Tell the finder its job is **coverage**: report every finding with a `confidence` and `severity`, and let a separate gate/stage filter. The `security-reviewer` is the reference implementation ("you report everything — no vulnerability is too minor"; severity assigned per finding; the **gate** filters to critical/high).

**4. Calibrate effort, not verbosity, for hard work.** For coding/agentic skills, run at `xhigh`; use a minimum of `high` for intelligence-sensitive work; `low`/`medium` for routine subagents. Raising effort is the first lever for shallow reasoning or low tool use — reach for it before adding prose. At `xhigh`/`max`, set a large `max_tokens` (≥64k) so the model has room to think and act.

**5. Lead with the outcome; be selective, not terse.** Fable 5 can over-elaborate at high effort (surveying options it won't pursue, narrating each line). The fix is a brevity instruction, not fragments: *"Lead with the outcome — your first sentence answers 'what happened.' Drop details that don't change what the reader does next. Readability matters more than compression; don't use arrow-chains or invented shorthand in user-facing text."*

**6. Ground progress claims in long autonomous runs.** Instruct long-running skills to *audit each status claim against an actual tool result from the session* before reporting it. This nearly eliminates fabricated "all green" reports and is the loop-level twin of the pipeline's artifact-grounding gates. See `/auto` → "Long-run autonomy & grounded progress."

**7. Don't ask the model to reproduce its reasoning as response text.** On Fable 5 (the orchestrator), prompts that say "show your reasoning," "explain your thinking step by step in your answer," or "echo your chain of thought" can trigger the `reasoning_extraction` refusal and fall back to Opus. If you need reasoning visibility, read the structured `thinking` blocks (adaptive thinking) — don't instruct the model to transcribe them. ("Think before you answer" is fine; "print your thinking" is not.)

**8. Structure with XML tags; show examples.** Wrap distinct instruction blocks in descriptive tags (`<scope_control>`, `<investigate_before_answering>`) so the model parses them unambiguously, and prefer 3–5 `<example>`-tagged examples over abstract rules. Tell the model what to do, not what to avoid.

**9. No prefilled assistant turns.** Last-assistant-turn prefills 400 on current models. Use structured outputs (a schema), tool enums, or a system instruction ("respond directly, no preamble") instead. The deterministic gates already prefer JSON verdict files over prose — keep that pattern.

**10. Don't over-prescribe.** Skills written as rigid step-by-steps for older models can *degrade* Fable 5's output. Where a skill's value is determinism (the ratchet gates), keep the steps; where it's just micromanaging a capable model, prefer stating the goal and constraints and letting it plan. Bias new prompt text toward "goal + boundaries," not exhaustive procedure.

## Quick checklist for a new/edited prompt

- [ ] No anti-laziness `CRITICAL:/MUST/If in doubt` left in (only true invariants stay).
- [ ] Every tool/subagent has a "use this when …" trigger condition.
- [ ] Finding/review steps say "report everything with severity," gate downstream.
- [ ] Long-running steps audit progress claims against tool results.
- [ ] No "show/echo/transcribe your reasoning as text" (Fable-5 refusal risk).
- [ ] Distinct blocks in XML tags; examples where behavior is subtle.
- [ ] Effort expectation noted for agentic/coding skills (high/xhigh).
- [ ] No model named in the prompt body, and no behavior phrased as a directional nudge that assumes one model's default (criterion, not nudge) — top-capability prompts must run unchanged on Opus 4.8 *and* Fable 5.

When a new model *generation* ships (not a patch release), don't edit prompts ad hoc — run the model-generation migration ritual in `docs/adaptive-ceremony.md`, which includes auditing every prompt against this checklist and deleting rules the new generation has made redundant.
