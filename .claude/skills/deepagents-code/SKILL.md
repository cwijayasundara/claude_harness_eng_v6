---
name: deepagents-code
description: Build long-running, production-ready agents with DeepAgents — the opinionated harness on top of LangGraph/LangChain providing filesystem access, task planning, subagent delegation, and context management out of the box. Use for long-running coding/research/multi-step tasks where you'd otherwise hand-assemble that middleware stack yourself; use langchain-code's plain create_agent instead for a simple single-tool-call loop with no need for planning or filesystem access. Triggers on "DeepAgents", "create_deep_agent", "agent harness", "long-running agent", "coding agent with filesystem", "subagent spawning".
---

# DeepAgents

Source: https://docs.langchain.com/oss/python/deepagents/overview (fetched 2026-07-06 — re-verify if this content seems stale; this is a fast-moving 2026-era product).

## What It Is, and Isn't

DeepAgents is **not** a separate orchestration engine — it's an opinionated harness layer built on top of LangChain's `create_agent` and LangGraph's runtime. Think of the stack as three layers: LangGraph (low-level execution runtime — state, checkpointing), LangChain's `create_agent` (compose exactly the primitives you need), DeepAgents' `create_deep_agent` (a pre-assembled, batteries-included harness on top of both). Reach for DeepAgents when a task needs the harness's defaults (filesystem, planning, subagents, context management); reach for plain `create_agent` (`langchain-code`) when you want to compose a narrower agent by hand instead.

## Core Architecture — Four Pillars

1. **Execution Environment**: custom tools/APIs/MCP servers, a virtual filesystem (pluggable backends — in-memory, local disk, LangGraph store, composite routing), declarative glob-based filesystem permission rules, code execution via sandboxes.
2. **Context Management**: `SKILL.md`-based progressive-disclosure skills, `AGENTS.md` persistent memory loaded at startup, automatic summarization/context offloading for long-running work, automatic prompt caching for Anthropic/Bedrock models.
3. **Delegation**: `write_todos` for structured task tracking, a `task` tool for spawning ephemeral, stateless subagents with fresh isolated context that return one final report each (not a back-and-forth dialogue).
4. **Steering**: human-in-the-loop via LangGraph interrupts, configurable per tool.

## Key API

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[custom_functions],
    system_prompt="...",
    memory=[memory_files],           # AGENTS.md-style persistent memory
    permissions=[permission_rules],  # glob-based, first-match-wins filesystem access control
    interrupt_on={"edit_file": True},
)

agent.invoke({"messages": [{"role": "user", "content": "..."}]})
```

See `references/architecture-and-api.md` for the default middleware stack, `HarnessProfile`, and every gotcha below in full detail.

## Gotchas (do not skip)

- **You cannot remove the default middleware** — only hide specific tools from a model via `HarnessProfile`'s `excluded_tools`. Removing the middleware itself is "intentionally rejected" by the framework's own design.
- **Subagents are stateless** — a spawned subagent returns exactly one final report, not a streaming dialogue. Don't design a flow expecting back-and-forth with a subagent mid-task.
- **Filesystem permission rules don't cover sandbox backends** — a sandbox allows arbitrary shell execution regardless of glob-based permission rules on the built-in filesystem tools. Add custom policy hooks if a sandbox needs additional guardrails.
- **Prompt caching is automatic for Anthropic/Bedrock** — no configuration needed; don't add manual cache-control logic on top of it.
