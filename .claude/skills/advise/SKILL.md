---
name: advise
description: Invoke the frontier advisor for a structural re-rank / unblock / design pivot. Compact brief only.
---

# /advise

Operator (or pipeline) entry for the read-only **advisor** agent (Opus judgment).

## Usage

```text
/advise "<question or brief>"
```

Or Task with `subagent_type: advisor` and a compact brief (status, last failures, options).

## Rules

1. Pass a **compact brief**, not the full transcript.
2. Cap advisor spawns per run via `execution.advisor_max_per_run` (default 3) in `project-manifest.json`.
3. Pipeline checkpoints (mandatory when conditions hold):
   - **A** — 2 consecutive evaluator FAIL on the same group → advisor re-rank before next generator attempt
   - **B** — every K stories completed in multi-group `/auto` (default K=3) → re-prioritize remaining features
4. Weak models (generator) **must not** decide to call advisor except by matching those triggers.
5. Persist result to `.claude/state/advisor-last.json` (+ append `advisor.jsonl`).

## Output

See `.claude/agents/advisor.md` for the JSON contract (`continue` | `pivot` | `stop_for_human`).
