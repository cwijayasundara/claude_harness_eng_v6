# Persistence, Checkpointing, and Human-in-the-Loop

Source: https://docs.langchain.com/oss/python/langgraph/persistence (fetched 2026-07-06 — re-verify if this content seems stale)

## What Checkpointers Do

A checkpointer persists a thread's graph state as checkpoints, enabling: conversation continuity across separate invocations, human-in-the-loop workflows (pause, inspect, resume), time travel (replay from an earlier checkpoint), and fault tolerance (resume after a crash).

## In-Memory (Development Only)

```python
from langgraph.checkpoint.memory import InMemorySaver

checkpointer = InMemorySaver()
graph = builder.compile(checkpointer=checkpointer)
```

**`InMemorySaver` does not persist between process restarts** — RAM-only, fine for local development and tests, never for anything that must survive a real crash.

## Durable, Database-Backed

```python
from langgraph.checkpoint.postgres import PostgresSaver

checkpointer = PostgresSaver.from_conn_string("postgresql://...")
checkpointer.setup()  # creates the required tables/indexes — run once
graph = builder.compile(checkpointer=checkpointer)
```

SQLite has an equivalent saver for lighter-weight durable deployments.

## `thread_id` Is Required for Persistence to Do Anything

```python
result = graph.invoke(
    {"messages": [{"role": "user", "content": "Hi, my name is Bob."}]},
    {"configurable": {"thread_id": "thread-1"}},
)
```

Every invocation must pass a `thread_id` in `config`. The same `thread_id` on a later call resumes from that thread's last checkpoint automatically — this is the entire mechanism, there is no separate "resume" API to call.

**Gotcha — `PostgresSaver` thread IDs are capped at 255 characters.** For long/generated identifiers, hash or truncate:

```python
import uuid
config = {"configurable": {"thread_id": str(uuid.uuid4())[:255]}}
```

## Crash Recovery

After a crash, simply re-invoke the graph with the same `thread_id` — it resumes from the last checkpoint automatically. There is no explicit "recover" call; recovery is just a normal invocation with a matching `thread_id`.

## Storage Gotchas

- **Unbounded checkpoint growth**: long-running threads accumulate checkpoints indefinitely, increasing storage and read latency over time. Plan a retention/pruning policy for production use — this is not handled automatically.
- **Subgraph checkpoint isolation**: a parent graph does not automatically see a child (sub)graph's state updates, because each subgraph gets its own checkpoint namespace. Use LangGraph's separate `Store` layer (not the per-thread checkpointer) for state that must cross that boundary.

## Human-in-the-Loop (ties directly to persistence — do not treat as a separate mechanism)

A checkpointer is the prerequisite for human-in-the-loop workflows: pausing a graph mid-execution for human review requires the state to be durably saved at that pause point so the graph can later resume exactly where it left off, potentially in a different process. Configure a checkpointer (as above) before relying on any pause/approve/resume flow — without one, "pausing for approval" has nothing to resume from.
