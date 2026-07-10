## Gotchas

- **API shape divergence.** The planner and generator run concurrently and may independently invent field names. Both must read `CONTEXT.md` before naming entities — that is the primary defense. `vocabulary-check.js` (Step 1.9) and the evaluator (artifact mode) gate are the deterministic and inferential backstops that catch what slips through — never skip either.
- **Missing deployment.md.** Builder agents need to know the target environment. This file is required, not optional.
- **Mock data must match API contracts.** If a mockup shows a `user_name` field but the API contract defines `username`, the downstream evaluator will flag a mismatch.
- **No folder structure means builder agents guess.** The `folder-structure.md` and `component-map.md` are the routing instructions for the build phase. Missing or vague entries cause agents to create files in wrong locations.
- **Unready stories must not get a component map.** `needs_breakdown` stories are product-planning backlog, not implementation input.
- **Ambiguous ownership creates merge conflicts.** Each file in `component-map.md` needs one owner. When multiple stories need a shared file, mark one story as owner and list the others under `Consumes:` or `Declares additions:`.
- **Schema files must be valid JSON.** Run a syntax check on both `.schema.json` files before presenting for human review.
- **Concurrent execution requires a single message.** Both Agent tool calls must appear in the same response. Do not run them sequentially.
- **Delta mode must never regenerate `specs/design/` from scratch.** If the planner's output looks like a fresh design rather than an amendment (missing prior component-map rows, a rewritten architecture.md with no trace to the prior version), stop and re-invoke Step D3 with a stronger instruction to read the baseline first.
- **Baseline recovery is a one-time event, not a re-run.** Once `specs/design/architecture.md` exists, always use Delta Mode — recovery mode is only for the very first bootstrap of a true brownfield app.
