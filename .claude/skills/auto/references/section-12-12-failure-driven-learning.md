## SECTION 12: Failure-Driven Learning

Learned rules are the harness's long-term memory. They prevent the same mistake from recurring across iterations and context windows.

### When to Extract a Rule

Extract a new rule when the same error type (by category from SECTION 6) appears **2 or more times** in `.claude/state/failures.md`. Check after every failure entry.

### Rule Format

Append to `.claude/state/learned-rules.md`:

```markdown
## Rule {N}: {descriptive title}

- **Source:** Group {group}, Story {story}, Iteration {iter}
- **Impact:** {quantified damage — e.g., "test coverage dropped 18%", "deployment failed", "3 iterations wasted"}
- **Pattern:** {what went wrong — the repeated error signature}

### Mistake
{description of what happened and why it failed}

### Anti-Pattern (Avoid This)
\`\`\`{language}
{code example showing the bad pattern — actual code from the failure}
\`\`\`

### Better Approach
\`\`\`{language}
{code example showing the correct pattern — the fix that resolved it}
\`\`\`

- **Rule:** {the concrete instruction to prevent recurrence}
- **Applied in:** {list of agents/skills that must follow this rule}
```

Include code examples whenever the mistake involves a code pattern. For non-code mistakes (e.g., wrong deployment sequence), describe the steps instead of code blocks. Always quantify impact — agents prioritize rules with higher impact.

### Injection

- Rules are injected verbatim into ALL future agent prompts: generator teammates, evaluator, design-critic, planner.
- Include the full text of every rule, not just titles or references.
- Rules are NEVER deleted. The rule set is monotonically growing — it is a ratchet on institutional knowledge.
- If `learned-rules.md` does not exist yet, create it with a header: `# Learned Rules\n\nRules extracted from failure patterns during autonomous build.\n`

---
