---
name: langgraph-code
description: Build stateful, multi-actor LangGraph agents in Python — StateGraph definition, conditional routing, checkpointing/persistence, and human-in-the-loop interrupts. Use when a task needs explicit multi-step control flow, crash/interrupt recovery, or approval gates — not for a single-turn prompt or a simple tool-calling loop (use langchain-code's create_agent for that). Triggers on "LangGraph", "state graph", "stateful agent", "multi-step agent workflow", "checkpointing", "resume from crash", "human in the loop agent".
---

# LangGraph

Source: https://langchain-ai.github.io/langgraph/llms.txt (this harness's index into the official docs — fetch and re-verify against it if this content seems stale; LangGraph moves fast).

## When to Reach for LangGraph

LangGraph models an agent as an explicit state machine — nodes and edges over a typed state object — rather than a linear chain of prompts. Reach for it when the task needs: multi-step control flow with branching, durable state that survives a crash or process restart, or a point where a human must approve/edit before the agent continues. For a simpler single-agent tool-calling loop with no explicit state machine, `langchain-code`'s `create_agent` is the right level of abstraction instead — read that skill first if you're unsure LangGraph's added control is actually needed.

## Core Workflow

1. Define state as a `TypedDict` (or dataclass/Pydantic model) — see `references/graph-api.md`.
2. Add nodes (plain functions that take state, return partial updates) and edges (static or conditional) — see `references/graph-api.md`.
3. Compile the graph — **must** call `.compile()` before it's runnable.
4. If the graph needs to survive a restart, resume mid-conversation, or pause for human approval: compile with a checkpointer and always pass a `thread_id` — see `references/persistence-and-checkpointing.md`. This is opt-in, not automatic — a graph compiled without a checkpointer has no persistence at all.

## Gotchas (do not skip)

- **Checkpointing is not automatic.** You must explicitly pass a `checkpointer` to `.compile()` and a `thread_id` in every invocation's config. A graph with neither has zero crash-resume capability.
- **`InMemorySaver` does not persist across process restarts** — development-only. Use `PostgresSaver` (or another durable backend) for anything that must survive a real crash.
- **Node re-execution on resume**: when resuming from a checkpoint, LangGraph re-runs the interrupted node from its start, not from where it left off mid-function. Design node bodies to be idempotent (safe to re-run) — do not put a side effect like "send an email" directly in a node body without a guard.
- **Don't mix static and conditional edges from the same node.** If a node has both a plain `add_edge` and a `add_conditional_edges` targeting it, both paths fire — pick one routing style per node.
- **State updates overwrite by default.** If a state field should accumulate (e.g. a running message list) rather than replace, it needs an explicit reducer via `Annotated[list[X], operator.add]` (or LangGraph's `add_messages` for chat history) — without one, each node's return value replaces the field wholesale.

## Not Yet Covered Here (fetch before relying on these topics)

This skill's reference files cover graph construction and persistence/checkpointing in depth. The following official pages exist in the llms.txt index but have not yet been fetched into a reference file — fetch the relevant one before advising on these topics, don't guess: streaming (`.../langgraph/streaming`), subgraph composition (`.../langgraph/use-subgraphs`), observability/tracing (`.../langgraph/observability`), common error troubleshooting (`.../langgraph/common-errors`), and the dedicated workflows-vs-agents framing (`.../langgraph/workflows-agents`).
