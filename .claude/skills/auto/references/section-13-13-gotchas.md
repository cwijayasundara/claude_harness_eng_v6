## SECTION 13: Gotchas

- **Not reading `program.md` each iteration:** Constraints can change mid-run (e.g., a human updates program.md while /auto is running). Always re-read at the start of every iteration.
- **Retrying the same approach after failure:** The self-healing loop must classify the failure and apply a DIFFERENT fix strategy. If attempt 1 failed with a type error fix, attempt 2 must try a different approach (e.g., restructure the function signature, not just change the annotation).
- **Reverting too eagerly:** Self-heal first (3 attempts). Only revert after the 3rd failure. Premature revert wastes working code.
- **Reverting too broadly:** `git checkout -- .` reverts everything. After the 3rd failure, only the current group's files should be reverted. Use the file ownership list from `component-map.md` to scope the revert: `git checkout -- {file1} {file2} ...`
- **Ignoring failure log patterns:** Check `failures.md` for recurring patterns BEFORE spawning the generator. If the same error has appeared before, inject the relevant learned rule into the generator prompt proactively.
- **Autonomous drift:** Every code change must trace to a story in the current group. If the generator introduces code that does not map to any acceptance criterion, reject it. No speculative features.
- **No human check-in:** Cap at 50 total iterations. After 50 iterations, stop and present a status report regardless of completion state. Long autonomous runs without human oversight risk compounding errors.
- **Not injecting learned rules:** Every agent prompt must include the full text of all learned rules. This is the most common cause of repeated failures. If you spawn an agent without learned rules, you are guaranteeing a preventable regression.
