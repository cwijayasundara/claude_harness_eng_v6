# create_agent — API, Tools, Middleware, Structured Output

Source: https://docs.langchain.com/oss/python/langchain/agents (fetched 2026-07-06 — re-verify if this content seems stale)

## Core API

```python
from langchain.agents import create_agent

agent = create_agent(
    model="provider:model_id",       # e.g. "anthropic:claude-sonnet-4-6"
    tools=[...],
    system_prompt="...",
    response_format=SomeSchema,      # optional — see Structured Output below
    middleware=[...],                # optional — see Middleware below
    checkpointer=...,                # optional — see Invocation & Conversation State below
    context_schema=...,              # optional dataclass for per-invocation request-scoped data
    name="agent_name",               # optional, useful for multi-agent hierarchies
)
```

`model` accepts a `"provider:model_id"` string or an already-initialized model instance (see `references/models.md`).

## Attaching Tools

```python
from langchain.tools import tool

@tool
def search(query: str) -> str:
    """Search for information."""
    return f"Results for: {query}"

agent = create_agent(model="...", tools=[search])
```

The agent parses each tool's docstring and type hints to build its schema — write clear docstrings, this directly affects tool-selection quality, not just documentation.

## System Prompt

A string or `SystemMessage`, static at creation time. It shapes reasoning but does **not** enforce hard rules — for deterministic policy enforcement (PII redaction, content filters), implement guardrail middleware instead of relying on prompt wording.

## Middleware — the Extensibility Primitive

Middleware composes freely, one concern per instance, across six categories: execution environment (filesystem/tools/sandboxes), context management (summarization/memory/prompt caching), planning & delegation (todo lists/subagents), fault tolerance (retries), guardrails (PII/content policy, deterministic), and steering (human-in-the-loop approval).

```python
agent = create_agent(
    model="...",
    tools=[search],
    middleware=[
        ModelRetryMiddleware(max_retries=3),
        PIIMiddleware("email"),
        HumanInTheLoopMiddleware(interrupt_on={"write_file": True}),
    ],
)
```

**Middleware order matters** — each middleware sees the output of whatever ran before it in the list.

## Structured Output

```python
class Answer(BaseModel):
    summary: str
    confidence: float

result = agent.invoke({"messages": [{"role": "user", "content": "Summarize AI trends"}]}, config=config)
validated_output = result["structured_response"]  # an Answer instance, already validated
```

## Invocation & Conversation State

```python
config = {"configurable": {"thread_id": str(uuid7())}}
result = agent.invoke({"messages": [{"role": "user", "content": "Question?"}]}, config=config)
# Reuse the same thread_id for follow-up turns — history persists automatically, ONLY if a checkpointer was configured.
```

`thread_id` (in `config`) scopes the conversation; a separate `context` argument carries per-invocation metadata (user id, feature flags) that is not conversation state. Both are commonly passed together but serve different purposes — don't conflate them.

## Gotchas

- **Checkpointer is not automatic** — without one, `thread_id` reuse does nothing; history is discarded between invocations regardless of whether you pass the same `thread_id`. Locally use `InMemorySaver()`.
- **Streaming vs. blocking**: `invoke()` blocks until the entire run (including all tool calls) completes. For real-time UX during long multi-tool-call runs, use `stream_events(version="v3")` instead.
- **`deepagents-code`'s `create_deep_agent`** pre-assembles filesystem access, summarization, subagents, and prompt caching on top of this same `create_agent` foundation — reach for it instead of hand-assembling that middleware stack yourself when the task calls for it.
