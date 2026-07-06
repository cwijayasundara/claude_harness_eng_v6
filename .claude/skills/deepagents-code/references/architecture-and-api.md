# DeepAgents Architecture, Default Middleware, and API Surface

Source: https://docs.langchain.com/oss/python/deepagents/overview (fetched 2026-07-06 — re-verify if this content seems stale)

## Relationship to LangChain and LangGraph

DeepAgents is built directly on LangChain's core building blocks and uses the LangGraph runtime for durable execution. LangChain provides the primitives (`create_agent`); LangGraph provides the execution runtime (state, checkpointing); DeepAgents adds an opinionated harness layer with built-in planning/filesystem/delegation/context-management capabilities on top of both. If you need a custom agent without the harness's specific defaults, drop down to `langchain-code`'s `create_agent` or a hand-built LangGraph workflow (`langgraph-code`) instead.

## Configuration Artifacts

- **`HarnessProfile`**: controls which tools/middleware are excluded per model — e.g. hiding a tool from a specific model without removing the underlying middleware.
- **`SKILL.md` files**: domain-knowledge bundles, progressively disclosed — same mechanism this harness's own skills use.
- **`AGENTS.md` files**: persistent memory loaded at startup, carried across sessions.
- **Permission rules**: glob-based filesystem access control, first-match-wins semantics.

## Default Middleware Stack

Ships built-in (cannot be fully removed, only individual tools hidden via `HarnessProfile.excluded_tools`):

- Filesystem tools: `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `execute`.
- Subagent spawning via the `task` tool (on by default, "intentionally rejected" for removal per the framework's own design).
- Context management: automatic summarization and offloading for long-running work.
- Automatic prompt caching for Anthropic/Bedrock models — static prompt sections (system prompt, memory, skills) are cache-eligible by default, no configuration needed.

## Key API Example

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[custom_functions],
    system_prompt="...",
    memory=[memory_files],
    permissions=[permission_rules],
    interrupt_on={"edit_file": True},
)

agent.invoke({"messages": [{"role": "user", "content": "..."}]})
```

## Idiomatic Patterns and Gotchas for Senior Engineers

- **Hiding a tool ≠ removing middleware.** Use `HarnessProfile`'s `excluded_tools` to hide specific filesystem tools from a model. Do not attempt to strip the middleware itself — that path is deliberately unsupported.
- **Subagent semantics are stateless-by-design.** A `task`-tool-spawned subagent gets a fresh, isolated context and returns exactly one final report — no streaming intermediate messages back to the parent. This keeps delegated work token-efficient and isolated, but means you cannot have iterative back-and-forth with a subagent inside a single delegated task.
- **Permission rules protect the built-in filesystem tools only.** A sandbox execution backend permits arbitrary shell commands regardless of glob-based permission rules configured for `read_file`/`write_file`/etc. — if a sandbox needs additional restriction, add custom policy hooks rather than assuming the permission-rule system covers it.
- **Prompt caching needs no manual setup for Anthropic/Bedrock models** — it's automatic and covers static prompt sections (system prompt, memory, skills) by default.
- **Context flow discipline**: understand the four-part flow — input, compression (summarization), isolation (subagent contexts), long-term memory (`AGENTS.md`) — when designing an agent meant to run for a long time without exhausting its context window.
