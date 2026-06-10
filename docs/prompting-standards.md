# Prompting Standards — authoring agents & skills

How to write the harness's prompt surfaces (`.claude/agents/*.md`, `.claude/skills/*/SKILL.md`, `.claude/commands/*`) so they get the best out of the current Claude models. Distilled from Anthropic's [prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices), [Prompting Opus 4.8](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-4-8), and [Prompting Fable 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5).

## Which model runs where (tune the prompt to its reader)

| Surface | Model | Implication for the prompt |
|---|---|---|
| `/auto` orchestrator, direct chat | **Fable 5** (session model) | Long-horizon autonomy; needs grounded-progress + don't-stop-early + reversible-action guidance. Do **not** ask it to echo its reasoning as response text (see §7). |
| `planner`, `evaluator` agents | **Opus 4.8** | Literal instruction follower; report-everything-then-filter for judging; effort matters. |
| `generator` agent | **Sonnet 4.6** | Set effort explicitly; precise, observable acceptance criteria. |

These assignments live in each agent's `model:` frontmatter — keep prompt tuning consistent with the assigned model.

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
